//! The trade keeper: watches open paper snipes and sells them by their exit plan.
//!
//! An exit plan is up to three take profit targets (each sells a share of the
//! position at a chosen gain), a stop loss, and the developer exit guard.
//!
//! There is one engine and two places a trade's state can live:
//!
//! * **In the browser.** The web app sends its open snipes with every sync and
//!   keeps the state that comes back. Trades are managed only while the app
//!   is open somewhere.
//! * **In the keeper's store** (PostgreSQL, or memory on a long running
//!   server). The keeper then goes on checking the trades on a schedule with
//!   nobody online, and hands over the sales it made at the next sync.
//!
//! The browser's paper account stays the ledger in both cases. The keeper
//! decides what to sell and at what price, and the app books it.

use std::{
    collections::{HashMap, HashSet},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};

use axum::{
    extract::State,
    http::{header, HeaderMap},
    Json,
};
use ring::rand::SecureRandom;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::PgPool;

use crate::{
    error::{AppError, Result},
    launchpad, origin_ok,
    sniper::{self, chain_info, token_id, valid_address_for},
    AppState,
};

// ── Limits and thresholds ────────────────────────────────────────────────────

pub const MAX_TAKE_PROFITS: u8 = 3;
/// Open snipes one browser may hand to the keeper.
const MAX_POSITIONS_PER_OWNER: usize = 12;
/// Open snipes the store holds across everyone. Beyond it, new ones are
/// managed from the browser only.
const MAX_OPEN_POSITIONS: i64 = 5_000;
/// Trades looked at per background check, least recently checked first.
const TICK_BATCH: i64 = 60;
/// Shortest pause between two background checks.
const TICK_GAP_MS: i64 = 15_000;
/// How often one token's developer wallet is looked at.
const DEV_CHECK_EVERY_MS: i64 = 45_000;
/// Trades whose owner has not synced for this long are dropped.
const STALE_AFTER_MS: i64 = 30 * 24 * 3600 * 1000;

/// The guard sells when the developer's share of supply has fallen this far since entry.
pub const DEV_SOLD_TRIGGER_PCT: f64 = 25.0;
/// The guard sells when this much liquidity has left the pool beyond what the price explains.
pub const LIQUIDITY_REMOVED_TRIGGER_PCT: f64 = 30.0;
/// A developer holding below this share of supply is too small to read.
const MIN_DEV_HOLDING_PCT: f64 = 0.5;
/// Pools thinner than this are too noisy to watch for withdrawals.
const MIN_GUARD_LIQUIDITY_USD: f64 = 1_000.0;

// ── Types ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TakeProfit {
    /// 1, 2 or 3. Identifies the target so a hit is remembered when the plan is edited.
    pub level: u8,
    /// Gain on the entry price that triggers the sale, in percent.
    pub gain_pct: f64,
    /// Share of the position to sell, in percent of its size when the ladder started.
    pub sell_pct: f64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExitPlan {
    #[serde(default)]
    pub take_profits: Vec<TakeProfit>,
    #[serde(default)]
    pub stop_loss_pct: Option<f64>,
    /// Sell everything when the developer is seen leaving.
    #[serde(default)]
    pub dev_exit: bool,
}

fn in_range(v: f64, max: f64) -> Option<f64> {
    (v.is_finite() && v > 0.0 && v <= max).then_some(v)
}

impl ExitPlan {
    /// The plan with anything unusable dropped: unknown levels, repeats, and
    /// numbers that are not positive and finite.
    pub fn sanitized(&self) -> ExitPlan {
        let mut levels: Vec<TakeProfit> = Vec::new();
        for tp in &self.take_profits {
            if !(1..=MAX_TAKE_PROFITS).contains(&tp.level)
                || levels.iter().any(|l| l.level == tp.level)
            {
                continue;
            }
            let (Some(gain_pct), Some(sell_pct)) = (
                in_range(tp.gain_pct, 1_000_000.0),
                in_range(tp.sell_pct, 100.0),
            ) else {
                continue;
            };
            levels.push(TakeProfit {
                level: tp.level,
                gain_pct,
                sell_pct,
            });
        }
        levels.sort_by_key(|l| l.level);
        ExitPlan {
            take_profits: levels,
            stop_loss_pct: self.stop_loss_pct.and_then(|v| in_range(v, 100.0)),
            dev_exit: self.dev_exit,
        }
    }
}

/// What the developer exit guard has seen for one trade.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Guard {
    /// The developer's share of supply when the trade was opened, in percent.
    pub dev_base_pct: Option<f64>,
    pub dev_now_pct: Option<f64>,
    /// Unix milliseconds of the last look at the developer wallet.
    pub dev_checked_at: Option<i64>,
    /// How much of that share is gone, in percent of the share at entry.
    pub dev_sold_pct: Option<f64>,
    /// The pool the liquidity mark belongs to.
    pub pool: Option<String>,
    pub liq_ref_usd: Option<f64>,
    pub liq_ref_price: Option<f64>,
    /// Liquidity withdrawn since the mark, beyond what the price move explains.
    pub liq_removed_pct: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Reading {
    pub price_usd: f64,
    #[serde(default)]
    pub liquidity_usd: Option<f64>,
    pub at: i64,
}

/// One open snipe as the keeper tracks it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Position {
    /// `chain:address`, the same id the web app keys the position by.
    pub key: String,
    pub chain: String,
    pub address: String,
    pub symbol: String,
    /// Average cost per token, fees included.
    pub entry_price: f64,
    /// Tokens still held.
    pub qty: f64,
    /// The size the take profit shares refer to.
    pub basis_qty: f64,
    #[serde(default)]
    pub plan: ExitPlan,
    /// Take profit levels already sold.
    #[serde(default)]
    pub tp_done: Vec<u8>,
    #[serde(default)]
    pub guard: Guard,
    #[serde(default)]
    pub last: Option<Reading>,
    pub opened_at: i64,
    /// The rule that sold the last of it, once the keeper has closed the trade.
    #[serde(default)]
    pub closed: Option<String>,
}

impl Position {
    fn open(&self) -> bool {
        self.closed.is_none() && self.qty > 0.0
    }

    /// The same position without its latest market reading, for telling real
    /// changes from a price tick.
    fn without_reading(&self) -> Position {
        let mut p = self.clone();
        p.last = None;
        p
    }
}

/// A sale the keeper decided on. The web app books it against the paper account.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Execution {
    pub id: String,
    pub key: String,
    /// `tp1`, `tp2`, `tp3`, `stop_loss` or `dev_exit`.
    pub rule: String,
    /// Short label for the trade history.
    pub note: String,
    /// One sentence on why it fired.
    pub detail: String,
    pub qty: f64,
    pub price_usd: f64,
    pub at: i64,
}

/// What the market looked like for one token in this round.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Signals {
    pub price_usd: Option<f64>,
    pub liquidity_usd: Option<f64>,
    pub pool: Option<String>,
    /// `Some` when the developer wallet was read this round. The inner value
    /// is `None` when the provider does not know the developer.
    pub dev_holding_pct: Option<Option<f64>>,
}

// ── The engine (pure, unit tested) ───────────────────────────────────────────

/// Tracks how much liquidity has left the pool.
///
/// In a constant product pool the value locked moves with the square root of
/// the price, so a falling price alone explains part of any drop. What falls
/// beyond that was withdrawn. A rising price is never held against the pool,
/// which keeps concentrated liquidity pools from raising false alarms.
fn update_liquidity_guard(g: &mut Guard, price: f64, liquidity: Option<f64>, pool: Option<&str>) {
    let (Some(liq), Some(pool)) = (liquidity, pool.filter(|p| !p.is_empty())) else {
        g.liq_removed_pct = None;
        return;
    };
    let same_pool = g.pool.as_deref() == Some(pool);
    match (same_pool, g.liq_ref_usd, g.liq_ref_price) {
        (true, Some(ref_liq), Some(ref_price))
            if ref_liq >= MIN_GUARD_LIQUIDITY_USD && ref_price > 0.0 =>
        {
            let expected = ref_liq * (price / ref_price).min(1.0).sqrt();
            if liq >= expected {
                // Liquidity was added or the price rose: measure from this higher mark.
                g.liq_ref_usd = Some(liq);
                g.liq_ref_price = Some(price);
                g.liq_removed_pct = Some(0.0);
            } else {
                g.liq_removed_pct = Some(((1.0 - liq / expected) * 100.0).clamp(0.0, 100.0));
            }
        }
        _ => {
            // First sight of this pool, or the token moved to a new one (as
            // it does when it graduates from a bonding curve).
            g.pool = Some(pool.chars().take(120).collect());
            let usable = liq >= MIN_GUARD_LIQUIDITY_USD;
            g.liq_ref_usd = usable.then_some(liq);
            g.liq_ref_price = usable.then_some(price);
            g.liq_removed_pct = None;
        }
    }
}

/// Why the developer exit guard would sell now, if it would.
fn dev_exit_reason(g: &Guard) -> Option<String> {
    if let (Some(sold), Some(base), Some(now)) = (g.dev_sold_pct, g.dev_base_pct, g.dev_now_pct) {
        if sold >= DEV_SOLD_TRIGGER_PCT {
            return Some(format!(
                "The developer's share of supply fell from {base:.1}% to {now:.1}%."
            ));
        }
    }
    match g.liq_removed_pct {
        Some(removed) if removed >= LIQUIDITY_REMOVED_TRIGGER_PCT => Some(format!(
            "About {removed:.0}% of the pool's liquidity was withdrawn."
        )),
        _ => None,
    }
}

/// Applies one round of market signals to a trade and returns the sales that
/// follow from its exit plan. A full exit (guard or stop loss) comes before
/// any take profit.
pub fn evaluate(
    p: &mut Position,
    s: &Signals,
    now_ms: i64,
    new_id: &mut dyn FnMut() -> String,
) -> Vec<Execution> {
    // The developer's holding is recorded even when no price is known.
    if let Some(reading) = s.dev_holding_pct {
        p.guard.dev_checked_at = Some(now_ms);
        if let Some(v) = reading.filter(|v| v.is_finite() && (0.0..=100.0).contains(v)) {
            p.guard.dev_now_pct = Some(v);
            if p.guard.dev_base_pct.is_none() {
                p.guard.dev_base_pct = Some(v);
            }
        }
    }
    p.guard.dev_sold_pct = match (p.guard.dev_base_pct, p.guard.dev_now_pct) {
        (Some(base), Some(now)) if base >= MIN_DEV_HOLDING_PCT => {
            Some(((base - now) / base * 100.0).clamp(0.0, 100.0))
        }
        _ => None,
    };

    let Some(price) = s.price_usd.filter(|v| v.is_finite() && *v > 0.0) else {
        return vec![];
    };
    let liquidity = s.liquidity_usd.filter(|v| v.is_finite() && *v >= 0.0);
    p.last = Some(Reading {
        price_usd: price,
        liquidity_usd: liquidity,
        at: now_ms,
    });
    update_liquidity_guard(&mut p.guard, price, liquidity, s.pool.as_deref());

    if !p.open() || p.entry_price <= 0.0 {
        return vec![];
    }
    let gain_pct = (price / p.entry_price - 1.0) * 100.0;
    let mut out = Vec::new();

    let guard_reason = p.plan.dev_exit.then(|| dev_exit_reason(&p.guard)).flatten();
    let full_exit = match (guard_reason, p.plan.stop_loss_pct) {
        (Some(detail), _) => Some(("dev_exit", "Developer exit guard", detail)),
        (None, Some(stop)) if gain_pct <= -stop => Some((
            "stop_loss",
            "Stop loss hit",
            format!(
                "Price was down {:.0}%, your stop loss was {stop:.0}%.",
                -gain_pct
            ),
        )),
        _ => None,
    };
    if let Some((rule, note, detail)) = full_exit {
        out.push(Execution {
            id: new_id(),
            key: p.key.clone(),
            rule: rule.to_string(),
            note: note.to_string(),
            detail,
            qty: p.qty,
            price_usd: price,
            at: now_ms,
        });
        p.qty = 0.0;
        p.closed = Some(rule.to_string());
        return out;
    }

    let mut due: Vec<TakeProfit> = p
        .plan
        .take_profits
        .iter()
        .filter(|l| !p.tp_done.contains(&l.level) && gain_pct >= l.gain_pct)
        .cloned()
        .collect();
    due.sort_by(|a, b| a.gain_pct.total_cmp(&b.gain_pct));
    for level in due {
        if p.qty <= 0.0 {
            break;
        }
        p.tp_done.push(level.level);
        let mut qty = (p.basis_qty * level.sell_pct / 100.0).min(p.qty);
        // Never leave dust behind.
        if p.qty - qty <= p.basis_qty * 1e-6 {
            qty = p.qty;
        }
        if qty <= 0.0 {
            continue;
        }
        let rule = format!("tp{}", level.level);
        out.push(Execution {
            id: new_id(),
            key: p.key.clone(),
            rule: rule.clone(),
            note: format!("Take profit {} hit", level.level),
            detail: format!(
                "Price was up {gain_pct:.0}%, your target was {:.0}%.",
                level.gain_pct
            ),
            qty,
            price_usd: price,
            at: now_ms,
        });
        p.qty -= qty;
        if p.qty <= 0.0 {
            p.qty = 0.0;
            p.closed = Some(rule);
        }
    }
    p.tp_done.sort_unstable();
    out
}

/// A position as the web app reports it, already validated.
#[derive(Debug, Clone, PartialEq)]
pub struct Reported {
    pub key: String,
    pub chain: String,
    pub address: String,
    pub symbol: String,
    pub qty: f64,
    pub entry_price: f64,
    pub plan: ExitPlan,
    pub dev_holding_pct: Option<f64>,
    pub opened_at: Option<i64>,
    /// The state the app got back from an earlier sync, if it kept one.
    pub echo: Option<Position>,
}

/// Brings the keeper's view of a trade in line with what the app reports.
///
/// The app owns the quantity, the entry price and the plan. The keeper owns
/// the progress through the ladder and the guard's marks. While sales are
/// waiting to be booked the app's quantity is out of date, so it is ignored.
pub fn reconcile(base: Option<Position>, r: &Reported, has_pending: bool, now_ms: i64) -> Position {
    let fresh = || Position {
        key: r.key.clone(),
        chain: r.chain.clone(),
        address: r.address.clone(),
        symbol: r.symbol.clone(),
        entry_price: r.entry_price,
        qty: r.qty,
        basis_qty: r.qty,
        plan: r.plan.clone(),
        tp_done: vec![],
        guard: Guard {
            dev_base_pct: r.dev_holding_pct,
            dev_now_pct: r.dev_holding_pct,
            ..Guard::default()
        },
        last: None,
        opened_at: r.opened_at.unwrap_or(now_ms),
        closed: None,
    };
    let Some(mut p) = base else {
        return fresh();
    };
    p.plan = r.plan.clone();
    p.symbol = r.symbol.clone();
    if has_pending {
        return p;
    }
    if p.closed.is_some() {
        // The keeper sold it all earlier and the app holds the token again: a new trade.
        return fresh();
    }
    if r.qty > p.qty * (1.0 + 1e-6) {
        // More was bought, so the ladder starts over on the larger position.
        p.basis_qty = r.qty;
        p.tp_done.clear();
    }
    p.qty = r.qty;
    p.entry_price = r.entry_price;
    if p.basis_qty < p.qty {
        p.basis_qty = p.qty;
    }
    p
}

// ── Input validation ─────────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientPosition {
    key: String,
    #[serde(default)]
    symbol: String,
    qty: f64,
    entry_price: f64,
    #[serde(default)]
    plan: ExitPlan,
    #[serde(default)]
    dev_holding_pct: Option<f64>,
    #[serde(default)]
    opened_at: Option<i64>,
    /// Whatever the keeper returned for this position last time. Untrusted.
    #[serde(default)]
    state: Option<Value>,
}

fn clean_text(raw: &str, max: usize) -> String {
    raw.chars()
        .filter(|c| !c.is_control())
        .take(max)
        .collect::<String>()
        .trim()
        .to_string()
}

fn pct(v: Option<f64>) -> Option<f64> {
    v.filter(|v| v.is_finite() && (0.0..=100.0).contains(v))
}

fn amount(v: Option<f64>, max: f64) -> Option<f64> {
    v.filter(|v| v.is_finite() && *v >= 0.0 && *v <= max)
}

/// A state the app echoed back, with every field checked. `None` when it does
/// not describe this position.
fn clean_echo(raw: Option<&Value>, key: &str, chain: &str, address: &str) -> Option<Position> {
    let mut p: Position = serde_json::from_value(raw?.clone()).ok()?;
    if p.key != key {
        return None;
    }
    p.chain = chain.to_string();
    p.address = address.to_string();
    p.symbol = clean_text(&p.symbol, 24);
    p.entry_price = in_range(p.entry_price, 1e12)?;
    p.qty = amount(Some(p.qty), 1e30)?;
    p.basis_qty = in_range(p.basis_qty, 1e30)?;
    p.plan = p.plan.sanitized();
    p.tp_done.retain(|l| (1..=MAX_TAKE_PROFITS).contains(l));
    p.tp_done.sort_unstable();
    p.tp_done.dedup();
    p.guard = Guard {
        dev_base_pct: pct(p.guard.dev_base_pct),
        dev_now_pct: pct(p.guard.dev_now_pct),
        dev_checked_at: p.guard.dev_checked_at.filter(|t| *t > 0),
        dev_sold_pct: pct(p.guard.dev_sold_pct),
        pool: p
            .guard
            .pool
            .as_deref()
            .map(|s| clean_text(s, 120))
            .filter(|s| !s.is_empty()),
        liq_ref_usd: amount(p.guard.liq_ref_usd, 1e15),
        liq_ref_price: amount(p.guard.liq_ref_price, 1e12),
        liq_removed_pct: pct(p.guard.liq_removed_pct),
    };
    p.last = p.last.filter(|r| {
        r.price_usd.is_finite() && r.price_usd > 0.0 && r.liquidity_usd.is_none_or(f64::is_finite)
    });
    p.closed = p
        .closed
        .as_deref()
        .map(|s| clean_text(s, 24))
        .filter(|s| !s.is_empty());
    Some(p)
}

fn clean_position(c: &ClientPosition) -> Result<Reported> {
    let bad = |what: &str| AppError::BadRequest(format!("invalid position: {what}"));
    let (chain, address) = c.key.split_once(':').ok_or_else(|| bad("key"))?;
    if chain_info(chain).is_none()
        || !valid_address_for(chain, address)
        || token_id(chain, address) != c.key
    {
        return Err(bad("key"));
    }
    let symbol = clean_text(&c.symbol, 24);
    Ok(Reported {
        key: c.key.clone(),
        chain: chain.to_string(),
        address: address.to_string(),
        symbol: if symbol.is_empty() {
            "?".into()
        } else {
            symbol
        },
        qty: in_range(c.qty, 1e30).ok_or_else(|| bad("quantity"))?,
        entry_price: in_range(c.entry_price, 1e12).ok_or_else(|| bad("entry price"))?,
        plan: c.plan.sanitized(),
        dev_holding_pct: pct(c.dev_holding_pct),
        opened_at: c.opened_at.filter(|t| *t > 0),
        echo: clean_echo(c.state.as_ref(), &c.key, chain, address),
    })
}

// ── Store ────────────────────────────────────────────────────────────────────

/// A stored position and the version it was read at. Writes name the version
/// they expect, so two writers can never both win.
#[derive(Debug, Clone)]
pub struct Row {
    pub owner: String,
    pub position: Position,
    pub version: i64,
}

type StoreResult<T> = std::result::Result<T, String>;

struct MemRow {
    position: Position,
    version: i64,
    checked_at: i64,
    synced_at: i64,
}

#[derive(Default)]
struct MemoryInner {
    rows: HashMap<(String, String), MemRow>,
    executions: Vec<(String, Execution)>,
    next_tick_at: i64,
    last_tick_at: i64,
}

/// Keeps trades in memory. Used by a long running server with no database:
/// trades are managed with nobody online, until the process restarts.
#[derive(Default)]
pub struct MemoryStore(Mutex<MemoryInner>);

impl MemoryStore {
    fn inner(&self) -> std::sync::MutexGuard<'_, MemoryInner> {
        self.0.lock().unwrap_or_else(|e| e.into_inner())
    }
}

pub struct PgStore {
    pool: PgPool,
    ready: tokio::sync::OnceCell<()>,
}

const MIGRATIONS: &[&str] = &[
    "CREATE TABLE IF NOT EXISTS keeper_positions (
        owner      TEXT    NOT NULL,
        key        TEXT    NOT NULL,
        body       TEXT    NOT NULL,
        version    BIGINT  NOT NULL DEFAULT 1,
        open       BOOLEAN NOT NULL DEFAULT TRUE,
        checked_at BIGINT  NOT NULL DEFAULT 0,
        synced_at  BIGINT  NOT NULL,
        PRIMARY KEY (owner, key)
    )",
    "CREATE INDEX IF NOT EXISTS keeper_positions_due ON keeper_positions (checked_at) WHERE open",
    "CREATE TABLE IF NOT EXISTS keeper_executions (
        id         TEXT   PRIMARY KEY,
        owner      TEXT   NOT NULL,
        key        TEXT   NOT NULL,
        body       TEXT   NOT NULL,
        created_at BIGINT NOT NULL
    )",
    "CREATE INDEX IF NOT EXISTS keeper_executions_owner ON keeper_executions (owner)",
    "CREATE TABLE IF NOT EXISTS keeper_meta (
        id           INT    PRIMARY KEY,
        next_tick_at BIGINT NOT NULL DEFAULT 0,
        last_tick_at BIGINT NOT NULL DEFAULT 0
    )",
    "INSERT INTO keeper_meta (id) VALUES (1) ON CONFLICT (id) DO NOTHING",
];

impl PgStore {
    /// The pool, once the keeper's tables are known to exist.
    async fn pool(&self) -> StoreResult<&PgPool> {
        self.ready
            .get_or_try_init(|| async {
                for statement in MIGRATIONS {
                    sqlx::query(statement)
                        .execute(&self.pool)
                        .await
                        .map_err(|e| e.to_string())?;
                }
                Ok::<_, String>(())
            })
            .await?;
        Ok(&self.pool)
    }
}

fn decode<T: serde::de::DeserializeOwned>(body: &str) -> Option<T> {
    serde_json::from_str(body).ok()
}

fn encode<T: Serialize>(value: &T) -> StoreResult<String> {
    serde_json::to_string(value).map_err(|e| e.to_string())
}

pub enum Store {
    Memory(MemoryStore),
    Pg(PgStore),
}

impl Store {
    /// True when the store survives a restart.
    pub fn durable(&self) -> bool {
        matches!(self, Store::Pg(_))
    }

    /// One owner's positions and the sales waiting to be booked, oldest first.
    async fn load_owner(&self, owner: &str) -> StoreResult<(Vec<Row>, Vec<Execution>)> {
        match self {
            Store::Memory(m) => {
                let inner = m.inner();
                let rows = inner
                    .rows
                    .iter()
                    .filter(|((o, _), _)| o == owner)
                    .map(|(_, r)| Row {
                        owner: owner.to_string(),
                        position: r.position.clone(),
                        version: r.version,
                    })
                    .collect();
                let pending = inner
                    .executions
                    .iter()
                    .filter(|(o, _)| o == owner)
                    .map(|(_, e)| e.clone())
                    .collect();
                Ok((rows, pending))
            }
            Store::Pg(pg) => {
                let pool = pg.pool().await?;
                let rows: Vec<(String, i64)> =
                    sqlx::query_as("SELECT body, version FROM keeper_positions WHERE owner = $1")
                        .bind(owner)
                        .fetch_all(pool)
                        .await
                        .map_err(|e| e.to_string())?;
                let pending: Vec<(String,)> = sqlx::query_as(
                    "SELECT body FROM keeper_executions WHERE owner = $1 ORDER BY created_at, id",
                )
                .bind(owner)
                .fetch_all(pool)
                .await
                .map_err(|e| e.to_string())?;
                Ok((
                    rows.into_iter()
                        .filter_map(|(body, version)| {
                            Some(Row {
                                owner: owner.to_string(),
                                position: decode(&body)?,
                                version,
                            })
                        })
                        .collect(),
                    pending
                        .into_iter()
                        .filter_map(|(body,)| decode(&body))
                        .collect(),
                ))
            }
        }
    }

    /// Forgets sales the app has booked.
    async fn ack(&self, owner: &str, ids: &[String]) -> StoreResult<()> {
        match self {
            Store::Memory(m) => {
                m.inner()
                    .executions
                    .retain(|(o, e)| o != owner || !ids.contains(&e.id));
                Ok(())
            }
            Store::Pg(pg) => {
                sqlx::query("DELETE FROM keeper_executions WHERE owner = $1 AND id = ANY($2)")
                    .bind(owner)
                    .bind(ids)
                    .execute(pg.pool().await?)
                    .await
                    .map(|_| ())
                    .map_err(|e| e.to_string())
            }
        }
    }

    /// Writes a position together with the sales that came out of it. With
    /// `expected` set the write only lands if the stored version still
    /// matches. Without it the position must be new. Returns whether it landed.
    async fn write(
        &self,
        owner: &str,
        position: &Position,
        expected: Option<i64>,
        executions: &[Execution],
        now_ms: i64,
    ) -> StoreResult<bool> {
        match self {
            Store::Memory(m) => {
                let mut inner = m.inner();
                let id = (owner.to_string(), position.key.clone());
                match (inner.rows.get_mut(&id), expected) {
                    (Some(row), Some(version)) if row.version == version => {
                        row.position = position.clone();
                        row.version += 1;
                    }
                    (None, None) => {
                        inner.rows.insert(
                            id,
                            MemRow {
                                position: position.clone(),
                                version: 1,
                                checked_at: 0,
                                synced_at: now_ms,
                            },
                        );
                    }
                    _ => return Ok(false),
                }
                for e in executions {
                    inner.executions.push((owner.to_string(), e.clone()));
                }
                Ok(true)
            }
            Store::Pg(pg) => {
                let pool = pg.pool().await?;
                let body = encode(position)?;
                let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
                let landed = match expected {
                    Some(version) => sqlx::query(
                        "UPDATE keeper_positions SET body = $3, open = $4, version = version + 1
                         WHERE owner = $1 AND key = $2 AND version = $5",
                    )
                    .bind(owner)
                    .bind(&position.key)
                    .bind(&body)
                    .bind(position.open())
                    .bind(version),
                    None => sqlx::query(
                        "INSERT INTO keeper_positions (owner, key, body, open, synced_at)
                         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (owner, key) DO NOTHING",
                    )
                    .bind(owner)
                    .bind(&position.key)
                    .bind(&body)
                    .bind(position.open())
                    .bind(now_ms),
                }
                .execute(&mut *tx)
                .await
                .map_err(|e| e.to_string())?
                .rows_affected()
                    == 1;
                if !landed {
                    return Ok(false);
                }
                for e in executions {
                    sqlx::query(
                        "INSERT INTO keeper_executions (id, owner, key, body, created_at)
                         VALUES ($1, $2, $3, $4, $5)",
                    )
                    .bind(&e.id)
                    .bind(owner)
                    .bind(&e.key)
                    .bind(encode(e)?)
                    .bind(e.at)
                    .execute(&mut *tx)
                    .await
                    .map_err(|e| e.to_string())?;
                }
                tx.commit().await.map_err(|e| e.to_string())?;
                Ok(true)
            }
        }
    }

    async fn remove(&self, owner: &str, keys: &[String]) -> StoreResult<()> {
        match self {
            Store::Memory(m) => {
                m.inner()
                    .rows
                    .retain(|(o, k), _| o != owner || !keys.contains(k));
                Ok(())
            }
            Store::Pg(pg) => {
                sqlx::query("DELETE FROM keeper_positions WHERE owner = $1 AND key = ANY($2)")
                    .bind(owner)
                    .bind(keys)
                    .execute(pg.pool().await?)
                    .await
                    .map(|_| ())
                    .map_err(|e| e.to_string())
            }
        }
    }

    /// Records that the owner's app checked in.
    async fn touch(&self, owner: &str, now_ms: i64) -> StoreResult<()> {
        match self {
            Store::Memory(m) => {
                for ((o, _), row) in m.inner().rows.iter_mut() {
                    if o == owner {
                        row.synced_at = now_ms;
                    }
                }
                Ok(())
            }
            Store::Pg(pg) => {
                sqlx::query("UPDATE keeper_positions SET synced_at = $2 WHERE owner = $1")
                    .bind(owner)
                    .bind(now_ms)
                    .execute(pg.pool().await?)
                    .await
                    .map(|_| ())
                    .map_err(|e| e.to_string())
            }
        }
    }

    /// Open positions across everyone, and when the last background check ran.
    async fn stats(&self) -> StoreResult<(i64, i64)> {
        match self {
            Store::Memory(m) => {
                let inner = m.inner();
                let open = inner.rows.values().filter(|r| r.position.open()).count();
                Ok((open as i64, inner.last_tick_at))
            }
            Store::Pg(pg) => sqlx::query_as(
                "SELECT (SELECT count(*) FROM keeper_positions WHERE open),
                        COALESCE((SELECT last_tick_at FROM keeper_meta WHERE id = 1), 0)",
            )
            .fetch_one(pg.pool().await?)
            .await
            .map_err(|e| e.to_string()),
        }
    }

    /// Takes the turn for a background check. Only one caller gets it per gap.
    async fn claim_tick(&self, now_ms: i64, gap_ms: i64) -> StoreResult<bool> {
        match self {
            Store::Memory(m) => {
                let mut inner = m.inner();
                if inner.next_tick_at > now_ms {
                    return Ok(false);
                }
                inner.next_tick_at = now_ms + gap_ms;
                inner.last_tick_at = now_ms;
                Ok(true)
            }
            Store::Pg(pg) => sqlx::query(
                "UPDATE keeper_meta SET next_tick_at = $1 + $2, last_tick_at = $1
                 WHERE id = 1 AND next_tick_at <= $1",
            )
            .bind(now_ms)
            .bind(gap_ms)
            .execute(pg.pool().await?)
            .await
            .map(|r| r.rows_affected() == 1)
            .map_err(|e| e.to_string()),
        }
    }

    /// Open positions, least recently checked first.
    async fn due(&self, limit: i64) -> StoreResult<Vec<Row>> {
        match self {
            Store::Memory(m) => {
                let inner = m.inner();
                let mut rows: Vec<(&(String, String), &MemRow)> = inner
                    .rows
                    .iter()
                    .filter(|(_, r)| r.position.open())
                    .collect();
                rows.sort_by_key(|(_, r)| r.checked_at);
                Ok(rows
                    .into_iter()
                    .take(limit as usize)
                    .map(|((owner, _), r)| Row {
                        owner: owner.clone(),
                        position: r.position.clone(),
                        version: r.version,
                    })
                    .collect())
            }
            Store::Pg(pg) => {
                let rows: Vec<(String, String, i64)> = sqlx::query_as(
                    "SELECT owner, body, version FROM keeper_positions WHERE open
                     ORDER BY checked_at ASC LIMIT $1",
                )
                .bind(limit)
                .fetch_all(pg.pool().await?)
                .await
                .map_err(|e| e.to_string())?;
                Ok(rows
                    .into_iter()
                    .filter_map(|(owner, body, version)| {
                        Some(Row {
                            owner,
                            position: decode(&body)?,
                            version,
                        })
                    })
                    .collect())
            }
        }
    }

    /// Moves the checked positions to the back of the queue.
    async fn mark_checked(&self, rows: &[Row], now_ms: i64) -> StoreResult<()> {
        match self {
            Store::Memory(m) => {
                let mut inner = m.inner();
                for row in rows {
                    let id = (row.owner.clone(), row.position.key.clone());
                    if let Some(r) = inner.rows.get_mut(&id) {
                        r.checked_at = now_ms;
                    }
                }
                Ok(())
            }
            Store::Pg(pg) => {
                let owners: Vec<String> = rows.iter().map(|r| r.owner.clone()).collect();
                let keys: Vec<String> = rows.iter().map(|r| r.position.key.clone()).collect();
                sqlx::query(
                    "UPDATE keeper_positions p SET checked_at = $1
                     FROM unnest($2::text[], $3::text[]) AS t(owner, key)
                     WHERE p.owner = t.owner AND p.key = t.key",
                )
                .bind(now_ms)
                .bind(owners)
                .bind(keys)
                .execute(pg.pool().await?)
                .await
                .map(|_| ())
                .map_err(|e| e.to_string())
            }
        }
    }

    /// Drops what nobody has come back for.
    async fn expire(&self, before_ms: i64) -> StoreResult<()> {
        match self {
            Store::Memory(m) => {
                let mut inner = m.inner();
                inner.rows.retain(|_, r| r.synced_at >= before_ms);
                inner.executions.retain(|(_, e)| e.at >= before_ms);
                Ok(())
            }
            Store::Pg(pg) => {
                let pool = pg.pool().await?;
                for statement in [
                    "DELETE FROM keeper_positions WHERE synced_at < $1",
                    "DELETE FROM keeper_executions WHERE created_at < $1",
                ] {
                    sqlx::query(statement)
                        .bind(before_ms)
                        .execute(pool)
                        .await
                        .map_err(|e| e.to_string())?;
                }
                Ok(())
            }
        }
    }
}

// ── Keeper ───────────────────────────────────────────────────────────────────

pub struct Keeper {
    /// `None` when trades can only be managed from the browser: a serverless
    /// deployment with no database has nowhere to keep them between requests.
    store: Option<Store>,
    rng: ring::rand::SystemRandom,
    counter: AtomicU64,
    /// Keeps two background checks from overlapping inside one process.
    ticking: tokio::sync::Mutex<()>,
}

impl Keeper {
    pub fn new(db: Option<PgPool>, on_demand: bool) -> Self {
        let store = match db {
            Some(pool) => Some(Store::Pg(PgStore {
                pool,
                ready: tokio::sync::OnceCell::new(),
            })),
            None if !on_demand => Some(Store::Memory(MemoryStore::default())),
            None => None,
        };
        Self {
            store,
            rng: ring::rand::SystemRandom::new(),
            counter: AtomicU64::new(0),
            ticking: tokio::sync::Mutex::new(()),
        }
    }

    /// True when trades are managed with nobody online.
    pub fn offline(&self) -> bool {
        self.store.is_some()
    }

    pub fn durable(&self) -> bool {
        self.store.as_ref().is_some_and(Store::durable)
    }

    fn new_id(&self) -> String {
        let mut bytes = [0u8; 16];
        if self.rng.fill(&mut bytes).is_err() {
            // The system generator has no reason to fail. Stay unique if it does.
            let n = self.counter.fetch_add(1, Ordering::Relaxed);
            bytes[..8].copy_from_slice(&n.to_be_bytes());
            bytes[8..].copy_from_slice(&(now_ms() as u64).to_be_bytes());
        }
        hex(&bytes)
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn bearer(headers: &HeaderMap) -> Option<&str> {
    headers
        .get(header::AUTHORIZATION)?
        .to_str()
        .ok()?
        .strip_prefix("Bearer ")
        .map(str::trim)
}

/// The store only ever sees a hash of the browser's key, so a leaked table
/// cannot be used to read or change anyone's trades.
fn owner_id(device_key: &str) -> Option<String> {
    let ok = (32..=128).contains(&device_key.len())
        && device_key
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
    ok.then(|| {
        let digest = ring::digest::digest(
            &ring::digest::SHA256,
            format!("arctos-keeper-v1:{device_key}").as_bytes(),
        );
        hex(digest.as_ref())
    })
}

/// Compares two secrets without leaking where they differ: both are hashed
/// first, and the digests are compared in full.
fn same_secret(a: &str, b: &str) -> bool {
    let digest = |v: &str| ring::digest::digest(&ring::digest::SHA256, v.as_bytes());
    let (a, b) = (digest(a), digest(b));
    a.as_ref()
        .iter()
        .zip(b.as_ref())
        .fold(0u8, |acc, (x, y)| acc | (x ^ y))
        == 0
}

/// Fetches this round's market signals for a set of positions. At most
/// `dev_budget` developer wallets are read, the longest unchecked first,
/// because the provider only allows a slow trickle of those calls.
async fn gather(
    state: &Arc<AppState>,
    positions: &[&Position],
    dev_budget: usize,
    now_ms: i64,
) -> HashMap<String, Signals> {
    let mut out: HashMap<String, Signals> = HashMap::new();
    let mut by_chain: HashMap<&str, Vec<String>> = HashMap::new();
    for p in positions {
        by_chain
            .entry(p.chain.as_str())
            .or_default()
            .push(p.address.clone());
    }
    for (chain, mut addresses) in by_chain {
        addresses.sort();
        addresses.dedup();
        for chunk in addresses.chunks(30) {
            match sniper::market_for(state, chain, chunk.to_vec()).await {
                Ok(tokens) => {
                    for t in tokens {
                        out.insert(
                            t.id,
                            Signals {
                                price_usd: Some(t.price_usd),
                                liquidity_usd: Some(t.liquidity_usd),
                                pool: Some(t.pair_address).filter(|a| !a.is_empty()),
                                dev_holding_pct: None,
                            },
                        );
                    }
                }
                Err(e) => tracing::warn!("keeper could not price {chain} tokens: {e}"),
            }
        }
    }

    let mut wanted: Vec<&Position> = positions
        .iter()
        .copied()
        .filter(|p| {
            p.plan.dev_exit
                && p.open()
                && p.guard
                    .dev_checked_at
                    .is_none_or(|at| now_ms - at >= DEV_CHECK_EVERY_MS)
        })
        .collect();
    wanted.sort_by_key(|p| p.guard.dev_checked_at.unwrap_or(0));
    let mut seen = HashSet::new();
    wanted.retain(|p| seen.insert(p.key.as_str()));
    for p in wanted.into_iter().take(dev_budget) {
        let Some(chain) = chain_info(&p.chain) else {
            continue;
        };
        let Some(intel) = launchpad::fresh_intel(state, &chain, &p.address).await else {
            // Rate limited or unreachable. Try again on a later round.
            break;
        };
        out.entry(p.key.clone()).or_default().dev_holding_pct = Some(intel.developer_holding_pct);
    }
    out
}

// ── HTTP ─────────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncRequest {
    #[serde(default)]
    positions: Vec<ClientPosition>,
    /// Ids of sales the app has booked since the last sync.
    #[serde(default)]
    ack: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PositionView {
    #[serde(flatten)]
    position: Position,
    /// True when the keeper holds this trade and checks it with nobody online.
    offline: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResponse {
    /// `offline`: the keeper goes on checking with the app closed.
    /// `page`: trades are managed only while the app is open.
    mode: &'static str,
    /// False when the keeper's store is memory, which a restart clears.
    durable: bool,
    /// Unix milliseconds of the last check that ran with nobody online.
    last_background_check: Option<i64>,
    positions: Vec<PositionView>,
    executions: Vec<Execution>,
    /// Positions the keeper could not take on, with the reason. The rest are unaffected.
    rejected: Vec<Rejected>,
    checked_at: i64,
}

#[derive(Serialize)]
pub struct Rejected {
    key: String,
    reason: String,
}

fn unavailable(e: String) -> AppError {
    tracing::error!("keeper store failed: {e}");
    AppError::Unavailable("Trade management is not available right now.".into())
}

/// The web app reports its open snipes and gets back their state and any
/// sales to book. Called every few seconds while the app is open.
pub async fn sync(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<SyncRequest>,
) -> Result<Json<SyncResponse>> {
    if !origin_ok(&state.config, &headers) {
        return Err(AppError::Forbidden("Origin is not allowed.".into()));
    }
    // One bad position must not leave the others unmanaged, so each is judged on its own.
    let mut reported: Vec<Reported> = Vec::with_capacity(req.positions.len().min(16));
    let mut rejected: Vec<Rejected> = Vec::new();
    for c in req.positions.iter().take(64) {
        let reason = match clean_position(c) {
            Ok(r) if reported.iter().any(|x| x.key == r.key) => "It was sent twice.".to_string(),
            Ok(_) if reported.len() >= MAX_POSITIONS_PER_OWNER => {
                format!("At most {MAX_POSITIONS_PER_OWNER} open snipes can be managed at once.")
            }
            Ok(r) => {
                reported.push(r);
                continue;
            }
            Err(_) => "The keeper does not recognise this token.".to_string(),
        };
        rejected.push(Rejected {
            key: clean_text(&c.key, 120),
            reason,
        });
    }
    let ack: Vec<String> = req
        .ack
        .into_iter()
        .filter(|id| id.len() <= 64 && id.bytes().all(|b| b.is_ascii_hexdigit()))
        .take(200)
        .collect();

    let now = now_ms();
    let keeper = &state.keeper;
    let owner = bearer(&headers).and_then(owner_id);
    let held = keeper.store.as_ref().zip(owner.as_deref());

    // Positions the store holds for this owner, and ones managed from the browser.
    let mut managed: Vec<Row> = Vec::new();
    let mut waiting: Vec<Row> = Vec::new();
    let mut ephemeral: Vec<Position> = Vec::new();
    let mut executions: Vec<Execution> = Vec::new();
    let mut last_background_check = None;

    if let Some((store, owner)) = held {
        if !ack.is_empty() {
            store.ack(owner, &ack).await.map_err(unavailable)?;
        }
        let (rows, pending) = store.load_owner(owner).await.map_err(unavailable)?;
        let pending_keys: HashSet<String> = pending.iter().map(|e| e.key.clone()).collect();
        executions = pending;
        let mut stored: HashMap<String, Row> = rows
            .into_iter()
            .map(|r| (r.position.key.clone(), r))
            .collect();
        let mut room: Option<i64> = None;
        for r in &reported {
            match stored.remove(&r.key) {
                Some(row) => {
                    let next = reconcile(
                        Some(row.position.clone()),
                        r,
                        pending_keys.contains(&r.key),
                        now,
                    );
                    if next == row.position {
                        managed.push(row);
                    } else if store
                        .write(owner, &next, Some(row.version), &[], now)
                        .await
                        .map_err(unavailable)?
                    {
                        managed.push(Row {
                            owner: row.owner,
                            position: next,
                            version: row.version + 1,
                        });
                    } else {
                        // A background check changed it in the same moment. Show
                        // what was read and let the next sync settle it.
                        waiting.push(row);
                    }
                }
                None => {
                    let next = reconcile(r.echo.clone(), r, false, now);
                    if room.is_none() {
                        let (open, last_tick) = store.stats().await.map_err(unavailable)?;
                        room = Some(MAX_OPEN_POSITIONS - open);
                        last_background_check = Some(last_tick).filter(|t| *t > 0);
                    }
                    let has_room = room.is_some_and(|n| n > 0);
                    if has_room
                        && store
                            .write(owner, &next, None, &[], now)
                            .await
                            .map_err(unavailable)?
                    {
                        room = room.map(|n| n - 1);
                        managed.push(Row {
                            owner: owner.to_string(),
                            position: next,
                            version: 1,
                        });
                    } else {
                        ephemeral.push(next);
                    }
                }
            }
        }
        // What the app no longer holds was sold by hand, or the paper account
        // was reset. Trades with unbooked sales stay until the app has them.
        let (keep, gone): (Vec<Row>, Vec<Row>) = stored
            .into_values()
            .partition(|r| pending_keys.contains(&r.position.key));
        waiting.extend(keep);
        if !gone.is_empty() {
            let keys: Vec<String> = gone.into_iter().map(|r| r.position.key).collect();
            store.remove(owner, &keys).await.map_err(unavailable)?;
        }
        store.touch(owner, now).await.map_err(unavailable)?;
        if last_background_check.is_none() {
            let (_, last_tick) = store.stats().await.map_err(unavailable)?;
            last_background_check = Some(last_tick).filter(|t| *t > 0);
        }
    } else {
        ephemeral = reported
            .iter()
            .map(|r| reconcile(r.echo.clone(), r, false, now))
            .collect();
    }

    let signals = {
        let all: Vec<&Position> = managed
            .iter()
            .map(|r| &r.position)
            .chain(ephemeral.iter())
            .filter(|p| p.open())
            .collect();
        // One developer check per sync keeps the answer quick.
        gather(&state, &all, 1, now).await
    };
    let mut new_id = || keeper.new_id();
    if let Some((store, owner)) = held {
        for row in &mut managed {
            let Some(s) = signals.get(&row.position.key) else {
                continue;
            };
            let before = row.position.clone();
            let sold = evaluate(&mut row.position, s, now, &mut new_id);
            if sold.is_empty() && row.position.without_reading() == before.without_reading() {
                continue;
            }
            if store
                .write(owner, &row.position, Some(row.version), &sold, now)
                .await
                .map_err(unavailable)?
            {
                row.version += 1;
                executions.extend(sold);
            } else {
                row.position = before;
            }
        }
    }
    for p in &mut ephemeral {
        if let Some(s) = signals.get(&p.key) {
            executions.extend(evaluate(p, s, now, &mut new_id));
        }
    }

    let positions = managed
        .into_iter()
        .chain(waiting)
        .map(|r| PositionView {
            position: r.position,
            offline: true,
        })
        .chain(ephemeral.into_iter().map(|position| PositionView {
            position,
            offline: false,
        }))
        .collect();
    Ok(Json(SyncResponse {
        mode: if held.is_some() { "offline" } else { "page" },
        durable: held.is_some() && keeper.durable(),
        last_background_check,
        positions,
        executions,
        rejected,
        checked_at: now,
    }))
}

#[derive(Debug, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TickReport {
    /// False when this deployment has nowhere to keep trades between requests.
    pub offline: bool,
    /// False when another check ran moments ago, so this one stood down.
    pub ran: bool,
    /// Open snipes the keeper holds across everyone.
    pub open: i64,
    pub checked: usize,
    pub sold: usize,
}

/// One background check: looks at the open trades that have waited longest
/// and sells what their exit plans call for.
pub async fn run_tick(state: &Arc<AppState>) -> TickReport {
    let keeper = &state.keeper;
    let Some(store) = &keeper.store else {
        return TickReport::default();
    };
    let mut report = TickReport {
        offline: true,
        ..TickReport::default()
    };
    let Ok(_running) = keeper.ticking.try_lock() else {
        return report;
    };
    let now = now_ms();
    let outcome: StoreResult<()> = async {
        report.open = store.stats().await?.0;
        if report.open == 0 || !store.claim_tick(now, TICK_GAP_MS).await? {
            return Ok(());
        }
        report.ran = true;
        let mut rows = store.due(TICK_BATCH).await?;
        // A keyed provider allowance leaves room for more developer checks.
        let dev_budget = if state.config.coingecko_api_key.is_some() {
            8
        } else {
            5
        };
        let signals = {
            let positions: Vec<&Position> = rows.iter().map(|r| &r.position).collect();
            gather(state, &positions, dev_budget, now).await
        };
        let mut new_id = || keeper.new_id();
        for row in &mut rows {
            let Some(s) = signals.get(&row.position.key) else {
                continue;
            };
            report.checked += 1;
            let before = row.position.without_reading();
            let sold = evaluate(&mut row.position, s, now, &mut new_id);
            if sold.is_empty() && row.position.without_reading() == before {
                continue;
            }
            // A write that does not land means the owner's app got there first.
            if store
                .write(&row.owner, &row.position, Some(row.version), &sold, now)
                .await?
            {
                report.sold += sold.len();
            }
        }
        store.mark_checked(&rows, now).await?;
        store.expire(now - STALE_AFTER_MS).await
    }
    .await;
    if let Err(e) = outcome {
        tracing::error!("keeper background check failed: {e}");
    }
    report
}

/// The entry point for whatever schedules the background check: a cron job,
/// or the server's own loop. Safe to call often, it stands down when a check
/// ran moments ago.
pub async fn tick(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<TickReport>> {
    if let Some(secret) = &state.config.cron_secret {
        let given = bearer(&headers).unwrap_or_default();
        if !same_secret(given, secret) {
            return Err(AppError::Forbidden("Not allowed.".into()));
        }
    }
    Ok(Json(run_tick(&state).await))
}

/// A long running server checks on its own. A serverless deployment relies on
/// a scheduler calling [`tick`].
pub fn spawn_loop(state: Arc<AppState>) {
    if !state.keeper.offline() {
        return;
    }
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(20)).await;
            run_tick(&state).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: &str = "solana:So11111111111111111111111111111111111111112";

    fn plan() -> ExitPlan {
        ExitPlan {
            take_profits: vec![
                TakeProfit {
                    level: 1,
                    gain_pct: 80.0,
                    sell_pct: 60.0,
                },
                TakeProfit {
                    level: 2,
                    gain_pct: 400.0,
                    sell_pct: 20.0,
                },
                TakeProfit {
                    level: 3,
                    gain_pct: 1000.0,
                    sell_pct: 20.0,
                },
            ],
            stop_loss_pct: Some(20.0),
            dev_exit: true,
        }
    }

    fn reported(qty: f64) -> Reported {
        Reported {
            key: KEY.into(),
            chain: "solana".into(),
            address: "So11111111111111111111111111111111111111112".into(),
            symbol: "TEST".into(),
            qty,
            entry_price: 1.0,
            plan: plan(),
            dev_holding_pct: Some(8.0),
            opened_at: Some(1),
            echo: None,
        }
    }

    fn position() -> Position {
        reconcile(None, &reported(1000.0), false, 1)
    }

    fn at(price: f64) -> Signals {
        Signals {
            price_usd: Some(price),
            liquidity_usd: Some(50_000.0),
            pool: Some("pool-a".into()),
            dev_holding_pct: None,
        }
    }

    fn run(p: &mut Position, s: &Signals) -> Vec<Execution> {
        let mut n = 0;
        evaluate(p, s, 10, &mut || {
            n += 1;
            format!("id{n}")
        })
    }

    #[test]
    fn the_ladder_sells_each_share_once_as_the_price_climbs() {
        let mut p = position();
        assert!(run(&mut p, &at(1.5)).is_empty(), "below the first target");

        let sold = run(&mut p, &at(1.85));
        assert_eq!(sold.len(), 1);
        assert_eq!(
            (sold[0].rule.as_str(), sold[0].qty, sold[0].price_usd),
            ("tp1", 600.0, 1.85)
        );
        assert_eq!(sold[0].note, "Take profit 1 hit");
        assert_eq!((p.qty, p.tp_done.clone()), (400.0, vec![1]));
        assert!(
            run(&mut p, &at(2.5)).is_empty(),
            "a target never fires twice"
        );

        let sold = run(&mut p, &at(5.2));
        assert_eq!((sold[0].rule.as_str(), sold[0].qty), ("tp2", 200.0));
        let sold = run(&mut p, &at(11.5));
        assert_eq!((sold[0].rule.as_str(), sold[0].qty), ("tp3", 200.0));
        assert_eq!(p.qty, 0.0);
        assert_eq!(
            p.closed.as_deref(),
            Some("tp3"),
            "the last share closes the trade"
        );
        assert!(run(&mut p, &at(50.0)).is_empty());
    }

    #[test]
    fn a_jump_past_several_targets_sells_them_all_at_the_price_seen() {
        let mut p = position();
        let sold = run(&mut p, &at(6.0));
        assert_eq!(
            sold.iter().map(|e| e.rule.as_str()).collect::<Vec<_>>(),
            ["tp1", "tp2"]
        );
        assert!(sold.iter().all(|e| e.price_usd == 6.0));
        assert_eq!(p.qty, 200.0);
    }

    #[test]
    fn a_single_target_can_sell_part_and_let_the_rest_ride() {
        let mut p = position();
        p.plan.take_profits.truncate(1);
        let sold = run(&mut p, &at(2.0));
        assert_eq!(sold[0].qty, 600.0);
        assert!(p.open(), "the other 40 percent stays open");
        assert!(run(&mut p, &at(40.0)).is_empty());
        let sold = run(&mut p, &at(0.7));
        assert_eq!(
            (sold[0].rule.as_str(), sold[0].qty),
            ("stop_loss", 400.0),
            "and the stop loss still covers it"
        );
    }

    #[test]
    fn shares_that_add_up_to_more_than_everything_stop_at_what_is_held() {
        let mut p = position();
        p.plan.take_profits = vec![
            TakeProfit {
                level: 1,
                gain_pct: 50.0,
                sell_pct: 70.0,
            },
            TakeProfit {
                level: 2,
                gain_pct: 100.0,
                sell_pct: 70.0,
            },
        ];
        let sold = run(&mut p, &at(3.0));
        assert_eq!(
            sold.iter().map(|e| e.qty).collect::<Vec<_>>(),
            [700.0, 300.0]
        );
        assert_eq!(p.qty, 0.0);
    }

    #[test]
    fn the_stop_loss_sells_everything() {
        let mut p = position();
        assert!(run(&mut p, &at(0.85)).is_empty());
        let sold = run(&mut p, &at(0.79));
        assert_eq!((sold[0].rule.as_str(), sold[0].qty), ("stop_loss", 1000.0));
        assert_eq!(p.closed.as_deref(), Some("stop_loss"));
        p = position();
        p.plan.stop_loss_pct = None;
        assert!(run(&mut p, &at(0.1)).is_empty(), "no stop loss, no sale");
    }

    #[test]
    fn the_guard_sells_when_the_developer_unloads() {
        let mut p = position();
        let mut s = at(1.3);
        s.dev_holding_pct = Some(Some(7.0));
        assert!(run(&mut p, &s).is_empty(), "a small sale is not an exit");
        assert_eq!(p.guard.dev_sold_pct.map(f64::round), Some(13.0));

        s.dev_holding_pct = Some(Some(5.0));
        let sold = run(&mut p, &s);
        assert_eq!((sold[0].rule.as_str(), sold[0].qty), ("dev_exit", 1000.0));
        assert_eq!(
            sold[0].detail,
            "The developer's share of supply fell from 8.0% to 5.0%."
        );
        assert_eq!(p.closed.as_deref(), Some("dev_exit"));
    }

    #[test]
    fn the_guard_only_acts_when_it_is_switched_on() {
        let mut p = position();
        p.plan.dev_exit = false;
        let mut s = at(1.3);
        s.dev_holding_pct = Some(Some(0.0));
        assert!(run(&mut p, &s).is_empty());
        assert_eq!(
            p.guard.dev_sold_pct,
            Some(100.0),
            "it still keeps watch for the display"
        );
    }

    #[test]
    fn the_guard_takes_its_first_reading_as_the_mark_when_none_came_with_the_trade() {
        let mut r = reported(1000.0);
        r.dev_holding_pct = None;
        let mut p = reconcile(None, &r, false, 1);
        let mut s = at(1.0);
        s.dev_holding_pct = Some(Some(10.0));
        run(&mut p, &s);
        assert_eq!(p.guard.dev_base_pct, Some(10.0));
        assert_eq!(p.guard.dev_checked_at, Some(10));
        // A developer the provider does not know is marked as looked at, not as sold out.
        let mut q = reconcile(None, &r, false, 1);
        s.dev_holding_pct = Some(None);
        assert!(run(&mut q, &s).is_empty());
        assert_eq!(
            (q.guard.dev_checked_at, q.guard.dev_sold_pct),
            (Some(10), None)
        );
    }

    #[test]
    fn a_tiny_developer_holding_is_too_small_to_read() {
        let mut r = reported(1000.0);
        r.dev_holding_pct = Some(0.2);
        let mut p = reconcile(None, &r, false, 1);
        let mut s = at(1.0);
        s.dev_holding_pct = Some(Some(0.0));
        assert!(run(&mut p, &s).is_empty());
    }

    #[test]
    fn the_guard_sells_when_liquidity_is_pulled() {
        let mut p = position();
        run(&mut p, &at(1.0));
        assert_eq!(p.guard.liq_ref_usd, Some(50_000.0));

        let mut s = at(1.0);
        s.liquidity_usd = Some(40_000.0);
        assert!(
            run(&mut p, &s).is_empty(),
            "20 percent gone is below the trigger"
        );
        assert_eq!(p.guard.liq_removed_pct.map(f64::round), Some(20.0));

        s.liquidity_usd = Some(30_000.0);
        let sold = run(&mut p, &s);
        assert_eq!(sold[0].rule, "dev_exit");
        assert_eq!(
            sold[0].detail,
            "About 40% of the pool's liquidity was withdrawn."
        );
    }

    #[test]
    fn a_falling_price_alone_is_not_a_withdrawal() {
        let mut p = position();
        p.plan.stop_loss_pct = None;
        run(&mut p, &at(1.0));
        // Price halves: a constant product pool is then worth about 71 percent of before.
        let mut s = at(0.5);
        s.liquidity_usd = Some(35_400.0);
        assert!(run(&mut p, &s).is_empty());
        assert!(p.guard.liq_removed_pct.unwrap() < 1.0);
    }

    #[test]
    fn a_rising_price_raises_the_liquidity_mark_instead_of_raising_an_alarm() {
        let mut p = position();
        p.plan.take_profits.clear();
        run(&mut p, &at(1.0));
        // Concentrated liquidity: the price quadruples and the pool barely grows.
        let mut s = at(4.0);
        s.liquidity_usd = Some(55_000.0);
        assert!(run(&mut p, &s).is_empty());
        assert_eq!(
            (p.guard.liq_ref_usd, p.guard.liq_ref_price),
            (Some(55_000.0), Some(4.0))
        );
    }

    #[test]
    fn a_new_pool_resets_the_liquidity_mark() {
        let mut p = position();
        run(&mut p, &at(1.0));
        // The token graduates to a new, smaller pool.
        let mut s = at(1.0);
        s.pool = Some("pool-b".into());
        s.liquidity_usd = Some(9_000.0);
        assert!(run(&mut p, &s).is_empty());
        assert_eq!(
            (p.guard.pool.as_deref(), p.guard.liq_ref_usd),
            (Some("pool-b"), Some(9_000.0))
        );
        // A bonding curve reports no liquidity, so there is nothing to watch.
        s.pool = Some("curve".into());
        s.liquidity_usd = Some(0.0);
        assert!(run(&mut p, &s).is_empty());
        assert_eq!(p.guard.liq_ref_usd, None);
    }

    #[test]
    fn nothing_is_sold_without_a_price() {
        let mut p = position();
        assert!(run(&mut p, &Signals::default()).is_empty());
        assert_eq!(
            (p.qty, p.last.clone(), p.closed.clone()),
            (1000.0, None, None)
        );
    }

    #[test]
    fn the_guard_outranks_a_take_profit() {
        let mut p = position();
        let mut s = at(3.0);
        s.dev_holding_pct = Some(Some(1.0));
        let sold = run(&mut p, &s);
        assert_eq!(sold.len(), 1);
        assert_eq!((sold[0].rule.as_str(), sold[0].qty), ("dev_exit", 1000.0));
    }

    #[test]
    fn reconcile_follows_the_app_for_size_and_plan() {
        let mut p = position();
        run(&mut p, &at(1.9));
        assert_eq!(p.qty, 400.0);

        // The app has booked the sale and reports the smaller position.
        let same = reconcile(Some(p.clone()), &reported(400.0), false, 2);
        assert_eq!(
            (same.qty, same.basis_qty, same.tp_done.clone()),
            (400.0, 1000.0, vec![1])
        );

        // Part was sold by hand.
        let less = reconcile(Some(p.clone()), &reported(100.0), false, 2);
        assert_eq!((less.qty, less.tp_done.clone()), (100.0, vec![1]));

        // More was bought: the ladder starts over on the new size.
        let more = reconcile(Some(p.clone()), &reported(900.0), false, 2);
        assert_eq!(
            (more.qty, more.basis_qty, more.tp_done.len()),
            (900.0, 900.0, 0)
        );
        assert_eq!(
            more.guard.dev_base_pct,
            Some(8.0),
            "the developer mark is kept"
        );

        // The plan is always the latest one.
        let mut edited = reported(400.0);
        edited.plan.stop_loss_pct = Some(5.0);
        assert_eq!(
            reconcile(Some(p.clone()), &edited, false, 2)
                .plan
                .stop_loss_pct,
            Some(5.0)
        );
    }

    #[test]
    fn reconcile_ignores_the_apps_size_while_sales_wait_to_be_booked() {
        let mut p = position();
        run(&mut p, &at(1.9));
        let kept = reconcile(Some(p.clone()), &reported(1000.0), true, 2);
        assert_eq!((kept.qty, kept.tp_done.clone()), (400.0, vec![1]));
    }

    #[test]
    fn a_token_bought_again_after_the_keeper_sold_it_is_a_new_trade() {
        let mut p = position();
        run(&mut p, &at(0.5));
        assert!(p.closed.is_some());
        let again = reconcile(Some(p), &reported(250.0), false, 99);
        assert_eq!(
            (again.qty, again.basis_qty, again.closed.clone()),
            (250.0, 250.0, None)
        );
        assert!(again.tp_done.is_empty());
    }

    #[test]
    fn plans_are_cleaned_before_use() {
        let raw = ExitPlan {
            take_profits: vec![
                TakeProfit {
                    level: 2,
                    gain_pct: 400.0,
                    sell_pct: 20.0,
                },
                TakeProfit {
                    level: 1,
                    gain_pct: 80.0,
                    sell_pct: 60.0,
                },
                TakeProfit {
                    level: 1,
                    gain_pct: 5.0,
                    sell_pct: 5.0,
                },
                TakeProfit {
                    level: 4,
                    gain_pct: 10.0,
                    sell_pct: 10.0,
                },
                TakeProfit {
                    level: 3,
                    gain_pct: f64::NAN,
                    sell_pct: 10.0,
                },
                TakeProfit {
                    level: 3,
                    gain_pct: 10.0,
                    sell_pct: 150.0,
                },
            ],
            stop_loss_pct: Some(-3.0),
            dev_exit: true,
        };
        let clean = raw.sanitized();
        assert_eq!(
            clean
                .take_profits
                .iter()
                .map(|l| (l.level, l.gain_pct))
                .collect::<Vec<_>>(),
            [(1, 80.0), (2, 400.0)]
        );
        assert_eq!(clean.stop_loss_pct, None);
    }

    fn client(key: &str, qty: f64) -> ClientPosition {
        ClientPosition {
            key: key.into(),
            symbol: "  TE\u{7}ST  ".into(),
            qty,
            entry_price: 1.0,
            plan: plan(),
            dev_holding_pct: Some(250.0),
            opened_at: Some(5),
            state: None,
        }
    }

    #[test]
    fn positions_from_the_app_are_validated() {
        let ok = clean_position(&client(KEY, 10.0)).unwrap();
        assert_eq!((ok.chain.as_str(), ok.symbol.as_str()), ("solana", "TEST"));
        assert_eq!(ok.dev_holding_pct, None, "an impossible share is dropped");

        for key in ["nochain", "moon:abc", "solana:not an address", "solana:"] {
            assert!(clean_position(&client(key, 10.0)).is_err(), "{key}");
        }
        // EVM ids are lower case, the way the service hands them out.
        let evm = "base:0xAbCdEf0123456789abcdef0123456789ABCDEF01";
        assert!(clean_position(&client(evm, 10.0)).is_err());
        assert!(clean_position(&client(&evm.to_ascii_lowercase(), 10.0)).is_ok());
        for qty in [0.0, -1.0, f64::NAN, f64::INFINITY] {
            assert!(clean_position(&client(KEY, qty)).is_err());
        }
    }

    #[test]
    fn an_echoed_state_is_checked_field_by_field() {
        let mut p = position();
        run(&mut p, &at(1.9));
        let mut c = client(KEY, 400.0);
        c.state = Some(serde_json::to_value(&p).unwrap());
        let echo = clean_position(&c).unwrap().echo.unwrap();
        assert_eq!(echo, p);

        // A state for another token, or one that is not a state at all, is ignored.
        let mut other = serde_json::to_value(&p).unwrap();
        other["key"] = "solana:Other".into();
        c.state = Some(other);
        assert!(clean_position(&c).unwrap().echo.is_none());
        c.state = Some(serde_json::json!({"key": KEY, "qty": "lots"}));
        assert!(clean_position(&c).unwrap().echo.is_none());

        // Nonsense inside an otherwise valid state is stripped.
        let mut odd = serde_json::to_value(&p).unwrap();
        odd["tpDone"] = serde_json::json!([1, 1, 9]);
        odd["guard"]["devBasePct"] = serde_json::json!(900);
        odd["guard"]["pool"] = serde_json::json!("x".repeat(500));
        c.state = Some(odd);
        let echo = clean_position(&c).unwrap().echo.unwrap();
        assert_eq!(echo.tp_done, vec![1]);
        assert_eq!(echo.guard.dev_base_pct, None);
        assert_eq!(echo.guard.pool.unwrap().len(), 120);
    }

    #[test]
    fn device_keys_are_hashed_and_weak_ones_refused() {
        let key = "k".repeat(43);
        let id = owner_id(&key).unwrap();
        assert_eq!(id.len(), 64);
        assert_ne!(id, key);
        assert_eq!(owner_id(&key), Some(id), "stable for the same key");
        assert!(owner_id("short").is_none());
        assert!(owner_id(&"k".repeat(200)).is_none());
        assert!(owner_id(&format!("{} drop table", "k".repeat(30))).is_none());
    }

    #[tokio::test]
    async fn the_memory_store_refuses_a_write_from_a_stale_read() {
        let store = Store::Memory(MemoryStore::default());
        let p = position();
        assert!(store.write("me", &p, None, &[], 1).await.unwrap());
        assert!(
            !store.write("me", &p, None, &[], 1).await.unwrap(),
            "a position is only created once"
        );
        let (rows, _) = store.load_owner("me").await.unwrap();
        let mut next = rows[0].position.clone();
        let sold = run(&mut next, &at(1.9));
        assert!(store.write("me", &next, Some(1), &sold, 2).await.unwrap());
        assert!(
            !store.write("me", &next, Some(1), &sold, 2).await.unwrap(),
            "the same read cannot be written twice"
        );
        let (rows, pending) = store.load_owner("me").await.unwrap();
        assert_eq!((rows[0].version, pending.len()), (2, 1));
        assert!(store.load_owner("you").await.unwrap().0.is_empty());

        store.ack("you", &[pending[0].id.clone()]).await.unwrap();
        assert_eq!(
            store.load_owner("me").await.unwrap().1.len(),
            1,
            "only the owner can book a sale"
        );
        store.ack("me", &[pending[0].id.clone()]).await.unwrap();
        assert!(store.load_owner("me").await.unwrap().1.is_empty());

        assert!(store.claim_tick(100, 50).await.unwrap());
        assert!(!store.claim_tick(120, 50).await.unwrap());
        assert!(store.claim_tick(150, 50).await.unwrap());
        store.expire(10).await.unwrap();
        assert!(
            store.load_owner("me").await.unwrap().0.is_empty(),
            "stale trades are dropped"
        );
    }
}
