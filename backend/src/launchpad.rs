//! Launchpad intelligence for the sniper.
//!
//! For a chain and a launchpad it builds a ranked feed of tokens. Each token
//! gets a transparent "snipe score" made of five parts, all from live data:
//!
//! * **Demand**: real buy and sell counts and unique buyers and sellers.
//! * **Developer**: the launch wallet, how much it still holds, and its track
//!   record (how many of its earlier launches graduated or stayed liquid).
//! * **Safety**: mint and freeze authority, honeypot flags, taxes, holder spread.
//! * **Liquidity** and **Momentum**: pool depth, age, price action and bonding
//!   curve progress.
//!
//! Sources: GeckoTerminal (pools, launchpad progress, developer wallet, holders)
//! and GoPlus (contract risk). Nothing here is invented. A token that has not
//! been checked yet says so and is never treated as safe.
//!
//! A score ranks candidates. It is not a promise of profit: most new tokens
//! lose value, and no selection rule can guarantee a win rate.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex, RwLock},
    time::{Duration, Instant},
};

use axum::{
    extract::{Query, State},
    Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{
    error::{AppError, Result},
    records,
    sniper::{
        chain_info, num, safe_http_url, security_for, token_id, valid_address_for, ChainInfo,
        ChainKind, Security, CHAINS,
    },
    upstream::{KeyedCache, UpstreamError},
    AppState,
};

/// Extra provider calls allowed each time a feed is rebuilt, on top of the one
/// that lists the pools. GeckoTerminal's public tier allows about ten calls a
/// minute and wants them about three seconds apart, so the budget is one: either a refresh of launchpad progress or a
/// full check of one token. Checks are cached, so coverage grows with each
/// rebuild. With a CoinGecko API key the same data comes from a tier with a
/// larger, dedicated allowance and the budget is three.
const EXTRA_CALLS_PUBLIC: usize = 1;
const EXTRA_CALLS_KEYED: usize = 3;
/// After the provider says "too many requests", extra lookups pause this long.
const RATE_LIMIT_PAUSE: Duration = Duration::from_secs(20);
/// A token whose check failed is not retried for this long, so one bad token
/// cannot hold up the checks of every other token.
const FAILED_CHECK_RETRY: Duration = Duration::from_secs(300);
const MAX_FEED_TOKENS: usize = 40;

// ── Launchpad registry ───────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
pub struct Launchpad {
    /// Exchange id on GeckoTerminal.
    pub id: &'static str,
    pub name: &'static str,
    /// True when tokens here trade against a bonding curve until they graduate.
    /// A curve has no ordinary liquidity pool, so pool depth means something else.
    pub curve: bool,
}

const fn curve(id: &'static str, name: &'static str) -> Launchpad {
    Launchpad {
        id,
        name,
        curve: true,
    }
}

const fn market(id: &'static str, name: &'static str) -> Launchpad {
    Launchpad {
        id,
        name,
        curve: false,
    }
}

/// Launchpads per chain. Ids were read from the GeckoTerminal exchange lists.
pub fn launchpads_for(chain: &str) -> &'static [Launchpad] {
    const SOLANA: &[Launchpad] = &[
        curve("pump-fun", "Pump.fun"),
        market("pumpswap", "PumpSwap"),
        curve("letsbonk-fun", "LetsBonk"),
        curve("raydium-launchlab", "Raydium LaunchLab"),
        curve("meteora-dbc", "Meteora DBC"),
        curve("moonshot", "Moonshot"),
        curve("moonit", "Moonit"),
        curve("boop-fun", "Boop.fun"),
        curve("bags-fm", "Bags"),
        market("heaven", "Heaven"),
        curve("virtuals-solana", "Virtuals"),
        market("clanker-solana", "Clanker"),
        curve("daos-fun", "Daos.fun"),
        curve("token-mill", "Token Mill"),
        market("zora", "Zora"),
    ];
    const BSC: &[Launchpad] = &[
        curve("four-meme", "Four.meme"),
        curve("tiktokfun", "TikTokFun"),
    ];
    const BASE: &[Launchpad] = &[
        curve("virtuals-base", "Virtuals"),
        market("virtuals-unicorn-base", "Virtuals Unicorn"),
        market("bankr", "Bankr"),
        market("o1-launchpad", "o1 Launchpad"),
        curve("mint-club-base", "Mint Club"),
        market("memebox-base", "Memebox"),
    ];
    const AVALANCHE: &[Launchpad] = &[market("arena-dex", "The Arena")];
    const NEAR: &[Launchpad] = &[market("rhea-finance", "Rhea Finance")];
    const ROBINHOOD: &[Launchpad] = &[
        market("hoodit", "Hoodit"),
        market("clanker-robinhood", "Clanker"),
        curve("virtuals-robinhood", "Virtuals"),
        market("bankr-robinhood", "Bankr"),
        market("o1-launchpad-robinhood", "o1 Launchpad"),
        market("easya-kickstart-robinhood", "EasyA Kickstart"),
        curve("mint-club-robinhood", "Mint Club"),
        market("pons-v2", "Pons"),
    ];
    match chain {
        "solana" => SOLANA,
        "bsc" => BSC,
        "base" => BASE,
        "avalanche" => AVALANCHE,
        "near" => NEAR,
        "robinhood" => ROBINHOOD,
        _ => &[],
    }
}

fn launchpad_of(chain: &str, dex: &str) -> Option<&'static Launchpad> {
    launchpads_for(chain).iter().find(|l| l.id == dex)
}

fn launchpad_name(chain: &str, dex: &str) -> Option<&'static str> {
    launchpad_of(chain, dex).map(|l| l.name)
}

/// True while a token still trades against its launchpad's bonding curve.
pub fn on_curve(chain: &str, dex: &str, graduation: Option<Graduation>) -> bool {
    match graduation {
        Some(g) => !g.completed && launchpad_of(chain, dex).is_none_or(|l| l.curve),
        None => launchpad_of(chain, dex).is_some_and(|l| l.curve),
    }
}

// ── Types ────────────────────────────────────────────────────────────────────

/// Buys and sells in one time window.
#[derive(Debug, Clone, Copy, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Flow {
    pub buys: u64,
    pub sells: u64,
    pub buyers: u64,
    pub sellers: u64,
}

impl Flow {
    pub fn trades(&self) -> u64 {
        self.buys + self.sells
    }
    /// Share of trades that were buys, 0 to 1. `None` with no trades.
    pub fn buy_ratio(&self) -> Option<f64> {
        (self.trades() > 0).then(|| self.buys as f64 / self.trades() as f64)
    }
}

/// One pool as read from the feed, before any checks.
#[derive(Debug, Clone, PartialEq)]
pub struct Pool {
    pub address: String,
    pub symbol: String,
    pub name: String,
    pub pool_address: String,
    pub dex: String,
    pub price_usd: f64,
    pub liquidity_usd: f64,
    pub market_cap_usd: f64,
    pub volume_1h_usd: f64,
    pub volume_24h_usd: f64,
    pub change_5m: Option<f64>,
    pub change_1h: Option<f64>,
    pub change_24h: Option<f64>,
    pub m5: Flow,
    pub h1: Flow,
    pub h24: Flow,
    pub created_at: Option<i64>,
    pub image_url: Option<String>,
    /// True while the token trades against a bonding curve. Set after parsing.
    pub on_curve: bool,
}

/// Bonding curve progress on a launchpad.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Graduation {
    /// 0 to 100.
    pub percent: f64,
    pub completed: bool,
}

/// Everything learned from a full check of one token. Stored as JSON in
/// `arctos.token_checks`, so a field added later must have a default.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Intel {
    pub developer: Option<String>,
    pub developer_holding_pct: Option<f64>,
    pub holders: Option<u64>,
    pub top10_pct: Option<f64>,
    pub mint_authority: Option<bool>,
    pub freeze_authority: Option<bool>,
    pub honeypot: Option<bool>,
    pub has_socials: bool,
    pub graduation: Option<Graduation>,
}

// ── Developer index ──────────────────────────────────────────────────────────

/// One launch by a developer wallet, as last observed.
#[derive(Debug, Clone, PartialEq)]
pub struct DevLaunch {
    pub token: String,
    pub graduated: bool,
    /// Still trading against its bonding curve when last seen.
    pub on_curve: bool,
    pub liquidity_usd: f64,
    pub market_cap_usd: f64,
    pub buy_ratio: Option<f64>,
    pub seen_at: i64,
}

impl DevLaunch {
    /// A launch counts as a success when it graduated from its bonding curve,
    /// or when it holds real liquidity and value on an open exchange.
    pub fn succeeded(&self) -> bool {
        self.graduated
            || (!self.on_curve
                && self.liquidity_usd >= 10_000.0
                && self.market_cap_usd >= 100_000.0)
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DevStats {
    /// Earlier launches by this wallet that the service has observed.
    pub launches_seen: u32,
    pub successes: u32,
    /// 0 to 100. `None` until there are at least two earlier launches.
    pub success_rate: Option<f64>,
    /// Average share of buys across those launches, 0 to 100.
    pub avg_buy_ratio: Option<f64>,
}

/// Remembers which wallet launched which token and how each launch did, so a
/// developer can be judged on their record. It is built from the service's
/// own observations and grows while the service runs.
#[derive(Default)]
pub struct DevIndex {
    map: RwLock<HashMap<String, Vec<DevLaunch>>>,
}

const MAX_DEVS: usize = 20_000;
const MAX_LAUNCHES_PER_DEV: usize = 200;

impl DevIndex {
    fn key(chain: &str, developer: &str) -> String {
        format!("{chain}:{developer}")
    }

    pub fn record(&self, chain: &str, developer: &str, launch: DevLaunch) {
        let mut map = self.map.write().unwrap_or_else(|e| e.into_inner());
        if map.len() >= MAX_DEVS && !map.contains_key(&Self::key(chain, developer)) {
            return;
        }
        let launches = map.entry(Self::key(chain, developer)).or_default();
        if let Some(existing) = launches.iter_mut().find(|l| l.token == launch.token) {
            // Graduation is permanent. Everything else follows the latest look,
            // so an older record read back from the database never wins.
            let graduated = existing.graduated || launch.graduated;
            if launch.seen_at >= existing.seen_at {
                *existing = launch;
            }
            existing.graduated = graduated;
        } else if launches.len() < MAX_LAUNCHES_PER_DEV {
            launches.push(launch);
        }
    }

    /// The developer's record, leaving out the token being judged.
    pub fn stats(&self, chain: &str, developer: &str, exclude_token: &str) -> DevStats {
        let map = self.map.read().unwrap_or_else(|e| e.into_inner());
        let others: Vec<&DevLaunch> = map
            .get(&Self::key(chain, developer))
            .map(|v| v.iter().filter(|l| l.token != exclude_token).collect())
            .unwrap_or_default();
        let launches_seen = others.len() as u32;
        let successes = others.iter().filter(|l| l.succeeded()).count() as u32;
        let ratios: Vec<f64> = others.iter().filter_map(|l| l.buy_ratio).collect();
        DevStats {
            launches_seen,
            successes,
            success_rate: (launches_seen >= 2)
                .then(|| round1(successes as f64 / launches_seen as f64 * 100.0)),
            avg_buy_ratio: (!ratios.is_empty())
                .then(|| round1(ratios.iter().sum::<f64>() / ratios.len() as f64 * 100.0)),
        }
    }

    pub fn developers(&self) -> usize {
        self.map.read().unwrap_or_else(|e| e.into_inner()).len()
    }
}

// ── Store ────────────────────────────────────────────────────────────────────

pub struct LaunchpadStore {
    feeds: KeyedCache<FeedResponse>,
    /// The pools behind each feed, kept briefly so a feed can be scored again
    /// after checks without the list changing underneath it.
    pools: KeyedCache<Vec<Pool>>,
    /// Developers on record in the database, counted at most once a minute.
    dev_count: KeyedCache<i64>,
    intel: KeyedCache<Intel>,
    graduations: KeyedCache<HashMap<String, Graduation>>,
    pub devs: DevIndex,
    /// Set when the provider answers "too many requests".
    paused_until: Mutex<Option<Instant>>,
    /// When the next call to the provider may start.
    next_call: tokio::sync::Mutex<Instant>,
    /// Tokens whose check failed recently.
    failed_checks: Mutex<HashMap<String, Instant>>,
}

impl LaunchpadStore {
    pub fn new() -> Self {
        Self {
            feeds: KeyedCache::new(Duration::from_secs(20), Duration::from_secs(300)),
            pools: KeyedCache::new(Duration::from_secs(90), Duration::from_secs(90)),
            dev_count: KeyedCache::new(Duration::from_secs(60), Duration::from_secs(600)),
            graduations: KeyedCache::new(Duration::from_secs(120), Duration::from_secs(900)),
            paused_until: Mutex::new(None),
            next_call: tokio::sync::Mutex::new(Instant::now()),
            failed_checks: Mutex::new(HashMap::new()),
            // A token's developer and authorities do not change from minute to minute.
            intel: KeyedCache::new(Duration::from_secs(600), Duration::from_secs(3600)),
            devs: DevIndex::default(),
        }
    }
}

impl LaunchpadStore {
    fn paused(&self) -> bool {
        self.paused_until
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .is_some_and(|until| Instant::now() < until)
    }

    /// Waits for this caller's turn to call the provider.
    async fn turn(&self, spacing: Duration) {
        let mut next = self.next_call.lock().await;
        let now = Instant::now();
        if *next > now {
            tokio::time::sleep(*next - now).await;
        }
        *next = Instant::now() + spacing;
    }

    /// Takes a turn only if one is free within `max_wait`. Callers that answer a
    /// person, and must not queue behind others, use this instead of [`Self::turn`].
    async fn turn_soon(&self, spacing: Duration, max_wait: Duration) -> bool {
        let Ok(mut next) = self.next_call.try_lock() else {
            return false;
        };
        let wait = next.saturating_duration_since(Instant::now());
        if wait > max_wait {
            return false;
        }
        tokio::time::sleep(wait).await;
        *next = Instant::now() + spacing;
        true
    }

    fn check_failed_recently(&self, key: &str) -> bool {
        self.failed_checks
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(key)
            .is_some_and(|at| at.elapsed() < FAILED_CHECK_RETRY)
    }

    fn note_failed_check(&self, key: &str) {
        let mut failed = self.failed_checks.lock().unwrap_or_else(|e| e.into_inner());
        if failed.len() > 5000 {
            failed.clear();
        }
        failed.insert(key.to_string(), Instant::now());
    }

    fn pause(&self) {
        *self.paused_until.lock().unwrap_or_else(|e| e.into_inner()) =
            Some(Instant::now() + RATE_LIMIT_PAUSE);
    }
}

impl Default for LaunchpadStore {
    fn default() -> Self {
        Self::new()
    }
}

// ── Parsing (pure, unit tested) ──────────────────────────────────────────────

fn round1(v: f64) -> f64 {
    (v * 10.0).round() / 10.0
}

fn flow(tx: Option<&Value>, window: &str) -> Flow {
    let w = tx.and_then(|t| t.get(window));
    let n = |k: &str| {
        w.and_then(|x| x.get(k))
            .and_then(|x| x.as_u64())
            .unwrap_or(0)
    };
    Flow {
        buys: n("buys"),
        sells: n("sells"),
        buyers: n("buyers"),
        sellers: n("sellers"),
    }
}

/// GeckoTerminal pool list (new pools, trending pools or one exchange's pools).
pub fn parse_pools(raw: &str, chain: &ChainInfo) -> Vec<Pool> {
    let Ok(v) = serde_json::from_str::<Value>(raw) else {
        return vec![];
    };
    let Some(data) = v.get("data").and_then(|d| d.as_array()) else {
        return vec![];
    };
    let included: HashMap<&str, &Value> = v
        .get("included")
        .and_then(|i| i.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| Some((x.get("id")?.as_str()?, x)))
                .collect()
        })
        .unwrap_or_default();
    let prefix = format!("{}_", chain.gecko_network);

    data.iter()
        .filter_map(|pool| {
            let attrs = pool.get("attributes")?;
            let rel = pool.get("relationships")?;
            let base_id = rel.get("base_token")?.get("data")?.get("id")?.as_str()?;
            let address = base_id.strip_prefix(&prefix).unwrap_or(base_id).to_string();
            if !valid_address_for(chain.key, &address) {
                return None;
            }
            let token = included.get(base_id).and_then(|t| t.get("attributes"));
            let pool_name = attrs
                .get("name")
                .and_then(|n| n.as_str())
                .unwrap_or_default();
            let fallback = pool_name.split(" / ").next().unwrap_or("?");
            let text = |key: &str, max: usize| -> String {
                token
                    .and_then(|t| t.get(key))
                    .and_then(|s| s.as_str())
                    .unwrap_or(fallback)
                    .chars()
                    .filter(|c| !c.is_control())
                    .take(max)
                    .collect()
            };
            let pc = attrs.get("price_change_percentage");
            let tx = attrs.get("transactions");
            let vol = attrs.get("volume_usd");
            Some(Pool {
                symbol: text("symbol", 20),
                name: text("name", 60),
                address,
                pool_address: attrs
                    .get("address")
                    .and_then(|a| a.as_str())
                    .unwrap_or_default()
                    .to_string(),
                dex: rel
                    .get("dex")
                    .and_then(|d| d.get("data"))
                    .and_then(|d| d.get("id"))
                    .and_then(|d| d.as_str())
                    .unwrap_or_default()
                    .to_string(),
                price_usd: num(attrs.get("base_token_price_usd"))?,
                liquidity_usd: num(attrs.get("reserve_in_usd")).unwrap_or(0.0),
                market_cap_usd: num(attrs.get("market_cap_usd"))
                    .or_else(|| num(attrs.get("fdv_usd")))
                    .unwrap_or(0.0),
                volume_1h_usd: num(vol.and_then(|x| x.get("h1"))).unwrap_or(0.0),
                volume_24h_usd: num(vol.and_then(|x| x.get("h24"))).unwrap_or(0.0),
                change_5m: num(pc.and_then(|x| x.get("m5"))),
                change_1h: num(pc.and_then(|x| x.get("h1"))),
                change_24h: num(pc.and_then(|x| x.get("h24"))),
                m5: flow(tx, "m5"),
                h1: flow(tx, "h1"),
                h24: flow(tx, "h24"),
                created_at: attrs
                    .get("pool_created_at")
                    .and_then(|c| c.as_str())
                    .and_then(|c| DateTime::parse_from_rfc3339(c).ok())
                    .map(|d| d.timestamp_millis()),
                image_url: safe_http_url(
                    token
                        .and_then(|t| t.get("image_url"))
                        .and_then(|u| u.as_str()),
                ),
                on_curve: false,
            })
        })
        .collect()
}

fn parse_graduation(details: Option<&Value>) -> Option<Graduation> {
    let d = details.filter(|d| d.is_object())?;
    let completed = d
        .get("completed")
        .and_then(|c| c.as_bool())
        .unwrap_or(false);
    let percent =
        num(d.get("graduation_percentage")).unwrap_or(if completed { 100.0 } else { 0.0 });
    Some(Graduation {
        percent: round1(percent.clamp(0.0, 100.0)),
        completed,
    })
}

/// Bonding curve progress for many tokens at once (GeckoTerminal `tokens/multi`).
pub fn parse_graduations(raw: &str) -> HashMap<String, Graduation> {
    let Ok(v) = serde_json::from_str::<Value>(raw) else {
        return HashMap::new();
    };
    v.get("data")
        .and_then(|d| d.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|t| {
                    let a = t.get("attributes")?;
                    let address = a.get("address")?.as_str()?.to_string();
                    Some((address, parse_graduation(a.get("launchpad_details"))?))
                })
                .collect()
        })
        .unwrap_or_default()
}

/// "yes"/"no"/"unknown" style answers. Anything that is not a clear "no" for an
/// authority means the authority exists.
fn yes_no(v: Option<&Value>) -> Option<bool> {
    match v? {
        Value::Bool(b) => Some(*b),
        Value::String(s) => match s.to_ascii_lowercase().as_str() {
            "no" | "false" => Some(false),
            "unknown" | "" => None,
            _ => Some(true),
        },
        _ => None,
    }
}

/// GeckoTerminal token info: developer wallet, holders, authorities, socials.
pub fn parse_intel(raw: &str) -> Option<Intel> {
    let v: Value = serde_json::from_str(raw).ok()?;
    let a = v.get("data")?.get("attributes")?;
    let holders = a.get("holders");
    let nonempty = |k: &str| {
        a.get(k)
            .and_then(|x| x.as_str())
            .is_some_and(|s| !s.trim().is_empty())
    };
    Some(Intel {
        developer: a
            .get("developer_address")
            .and_then(|d| d.as_str())
            .map(str::trim)
            .filter(|d| !d.is_empty() && d.len() <= 160)
            .map(str::to_string),
        developer_holding_pct: num(a.get("developer_holding_percentage")),
        holders: holders
            .and_then(|h| h.get("count"))
            .and_then(|c| c.as_u64()),
        top10_pct: num(holders
            .and_then(|h| h.get("distribution_percentage"))
            .and_then(|d| d.get("top_10"))),
        mint_authority: yes_no(a.get("mint_authority")),
        freeze_authority: yes_no(a.get("freeze_authority")),
        honeypot: yes_no(a.get("is_honeypot")),
        has_socials: nonempty("twitter_handle")
            || nonempty("telegram_handle")
            || a.get("websites")
                .and_then(|w| w.as_array())
                .is_some_and(|w| !w.is_empty()),
        graduation: parse_graduation(a.get("launchpad_details")),
    })
}

// ── Scoring (pure, unit tested) ──────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScoreParts {
    /// Out of 30.
    pub demand: u32,
    /// Out of 25.
    pub developer: u32,
    /// Out of 25.
    pub safety: u32,
    /// Out of 10.
    pub liquidity: u32,
    /// Out of 10.
    pub momentum: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Score {
    /// 0 to 100.
    pub total: u32,
    /// "A" (strongest) to "F".
    pub grade: &'static str,
    pub parts: ScoreParts,
    /// What counts in the token's favour.
    pub reasons: Vec<String>,
    /// What counts against it.
    pub warnings: Vec<String>,
    /// True when a warning is serious enough that the token should not be bought.
    pub blocked: bool,
    /// False until the developer, holders and contract have been checked.
    pub checked: bool,
}

pub fn grade_for(total: u32) -> &'static str {
    match total {
        80.. => "A",
        65..=79 => "B",
        50..=64 => "C",
        35..=49 => "D",
        _ => "F",
    }
}

/// The trade flow to judge: the last hour when it has enough trades, else the day.
fn judged_flow(p: &Pool) -> Flow {
    if p.h1.trades() >= 10 {
        p.h1
    } else {
        p.h24
    }
}

pub fn score_token(
    pool: &Pool,
    graduation: Option<Graduation>,
    intel: Option<&Intel>,
    security: Option<&Security>,
    dev: Option<&DevStats>,
    now_ms: i64,
) -> Score {
    let mut reasons: Vec<String> = Vec::new();
    let mut warnings: Vec<String> = Vec::new();
    let mut blocked = false;

    // Demand, out of 30.
    let f = judged_flow(pool);
    let mut demand = 0.0;
    match f.buy_ratio() {
        Some(ratio) if f.trades() >= 10 => {
            // 50% buys earns nothing, 75% or more earns the full 16.
            demand += ((ratio - 0.5) / 0.25).clamp(0.0, 1.0) * 16.0;
            if ratio >= 0.6 {
                reasons.push(format!("{:.0}% of recent trades are buys", ratio * 100.0));
            } else if ratio < 0.45 {
                warnings.push(format!(
                    "Sellers lead: only {:.0}% of recent trades are buys",
                    ratio * 100.0
                ));
            }
        }
        _ => warnings.push("Too few trades to read demand".into()),
    }
    if f.buyers > 0 || f.sellers > 0 {
        let unique = f.buyers as f64 / (f.buyers + f.sellers).max(1) as f64;
        demand += ((unique - 0.5) / 0.2).clamp(0.0, 1.0) * 6.0;
        if f.buyers >= 50 && unique >= 0.55 {
            reasons.push(format!(
                "{} separate buyers against {} sellers",
                f.buyers, f.sellers
            ));
        }
        // Many trades from very few wallets is the usual shape of wash trading.
        if f.trades() >= 200 && (f.buyers + f.sellers) * 10 < f.trades() {
            demand -= 6.0;
            warnings.push("Trades come from very few wallets, which can mean wash trading".into());
        }
    }
    demand += ((f.trades() as f64).ln_1p() / 500f64.ln_1p()).clamp(0.0, 1.0) * 8.0;
    let demand = demand.clamp(0.0, 30.0).round() as u32;

    // Developer, out of 25. Unknown developers sit in the middle.
    let mut developer = 10.0;
    match (intel.and_then(|i| i.developer.as_ref()), dev) {
        (Some(_), Some(stats)) => match stats.success_rate {
            Some(rate) => {
                developer = 4.0 + rate / 100.0 * 17.0;
                let line = format!(
                    "Developer record: {} of {} earlier launches succeeded",
                    stats.successes, stats.launches_seen
                );
                if rate >= 50.0 {
                    reasons.push(line);
                } else if rate < 20.0 {
                    warnings.push(line);
                }
            }
            None if stats.launches_seen == 1 => {
                developer = if stats.successes == 1 { 14.0 } else { 8.0 };
            }
            None => {}
        },
        (None, _) if intel.is_some() => {
            warnings.push("Developer wallet could not be identified".into())
        }
        _ => {}
    }
    if let Some(avg) = dev.and_then(|d| d.avg_buy_ratio) {
        if avg >= 58.0 {
            developer += 2.0;
            reasons.push(format!(
                "Buyers led this developer's earlier launches ({avg:.0}% buys)"
            ));
        }
    }
    if let Some(pct) = intel.and_then(|i| i.developer_holding_pct) {
        if pct > 30.0 {
            developer -= 12.0;
            blocked = true;
            warnings.push(format!("Developer holds {pct:.1}% of supply"));
        } else if pct > 12.0 {
            developer -= 6.0;
            warnings.push(format!("Developer holds {pct:.1}% of supply"));
        } else if pct >= 0.5 {
            developer += 2.0;
            reasons.push(format!("Developer still holds a modest {pct:.1}%"));
        }
    }
    let developer = developer.clamp(0.0, 25.0).round() as u32;

    // Safety, out of 25. Nothing is assumed safe before it is checked.
    let mut safety = match intel {
        Some(_) => 21.0,
        None => 8.0,
    };
    if let Some(i) = intel {
        if i.honeypot == Some(true) {
            safety = 0.0;
            blocked = true;
            warnings.push("Flagged as a honeypot: it may be impossible to sell".into());
        }
        if i.mint_authority == Some(true) {
            safety -= 12.0;
            blocked = true;
            warnings.push("Mint authority is active: more supply can be created".into());
        }
        if i.freeze_authority == Some(true) {
            safety -= 12.0;
            blocked = true;
            warnings.push("Freeze authority is active: wallets can be frozen".into());
        }
        if i.mint_authority == Some(false) && i.freeze_authority == Some(false) {
            reasons.push("Mint and freeze authority are both renounced".into());
        }
        // While a token is on its bonding curve the curve itself holds most of
        // the supply, so holder spread only means something after graduation.
        if let (Some(top10), false) = (i.top10_pct, pool.on_curve) {
            if top10 > 70.0 {
                safety -= 8.0;
                warnings.push(format!("Top 10 wallets hold {top10:.0}% of supply"));
            } else if top10 < 30.0 {
                safety += 2.0;
                reasons.push(format!(
                    "Supply is spread out: top 10 wallets hold {top10:.0}%"
                ));
            }
        }
        if i.has_socials {
            safety += 2.0;
        }
    }
    if let Some(sec) = security.filter(|s| s.available) {
        if sec.is_honeypot == Some(true) {
            safety = 0.0;
            blocked = true;
            warnings.push("Contract check says this is a honeypot".into());
        }
        let tax = sec
            .buy_tax_pct
            .unwrap_or(0.0)
            .max(sec.sell_tax_pct.unwrap_or(0.0));
        if tax > 25.0 {
            safety -= 14.0;
            blocked = true;
            warnings.push(format!("Trade tax of {tax:.0}%"));
        } else if tax > 10.0 {
            safety -= 6.0;
            warnings.push(format!("Trade tax of {tax:.0}%"));
        }
        // The contract risk score runs 0 (clean) to 100.
        safety -= sec.risk_score as f64 / 100.0 * 10.0;
        if sec.risk_score <= 10 && tax <= 5.0 {
            reasons.push("Contract check found no serious risk".into());
        }
    }
    let safety = safety.clamp(0.0, 25.0).round() as u32;

    // Liquidity, out of 10. On a bonding curve the curve itself takes the other
    // side of every trade, so depth is read from how far along the curve is.
    let mut liquidity = if pool.on_curve {
        3.0 + graduation.map_or(0.0, |g| g.percent / 100.0 * 5.0)
    } else {
        if pool.liquidity_usd < 3_000.0 {
            warnings.push("Very thin liquidity: a small sell moves the price a lot".into());
        }
        let mut depth = ((pool.liquidity_usd.max(1.0).log10() - 3.0) / 2.0).clamp(0.0, 1.0) * 8.0;
        if pool.market_cap_usd > 0.0
            && pool.liquidity_usd > 0.0
            && pool.market_cap_usd / pool.liquidity_usd > 60.0
        {
            depth -= 2.0;
            warnings.push("Market cap is very large next to the liquidity behind it".into());
        }
        depth
    };
    if let Some(created) = pool.created_at {
        let age_min = (now_ms - created) as f64 / 60_000.0;
        if (10.0..=360.0).contains(&age_min) {
            liquidity += 2.0;
        }
    }
    let liquidity = liquidity.clamp(0.0, 10.0).round() as u32;

    // Momentum, out of 10.
    let mut momentum: f64 = 3.0;
    match pool.change_1h.or(pool.change_5m) {
        Some(c) if c > 300.0 => {
            momentum -= 2.0;
            warnings.push("Price already ran more than 300% this hour".into());
        }
        Some(c) if c >= 5.0 => {
            momentum += 4.0;
            reasons.push(format!("Price is up {c:.0}% over the last hour"));
        }
        Some(c) if c <= -30.0 => {
            momentum -= 3.0;
            warnings.push(format!("Price is down {:.0}% over the last hour", c.abs()));
        }
        _ => {}
    }
    if let Some(g) = graduation {
        if g.completed {
            momentum += 3.0;
            reasons.push("Graduated from its bonding curve".into());
        } else if g.percent >= 70.0 {
            momentum += 3.0;
            reasons.push(format!("{:.0}% of the way to graduating", g.percent));
        }
    }
    let momentum = momentum.clamp(0.0, 10.0).round() as u32;

    let mut total = demand + developer + safety + liquidity + momentum;
    if blocked {
        total = total.min(20);
    }
    Score {
        total,
        grade: grade_for(total),
        parts: ScoreParts {
            demand,
            developer,
            safety,
            liquidity,
            momentum,
        },
        reasons,
        warnings,
        blocked,
        checked: intel.is_some(),
    }
}

// ── API types ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DeveloperView {
    pub address: String,
    pub holding_pct: Option<f64>,
    pub record: DevStats,
    /// "proven", "mixed", "poor", "first" (no earlier launches seen).
    pub verdict: &'static str,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FeedToken {
    pub id: String,
    pub symbol: String,
    pub name: String,
    pub address: String,
    pub chain: String,
    pub pair_address: String,
    pub dex: String,
    /// The launchpad's display name, when the pool belongs to one.
    pub launchpad: Option<&'static str>,
    /// True while the token still trades against a bonding curve.
    pub on_curve: bool,
    pub graduation: Option<Graduation>,
    pub price_usd: f64,
    pub liquidity_usd: f64,
    pub market_cap_usd: f64,
    pub volume_24h_usd: f64,
    pub change_5m: Option<f64>,
    pub change_1h: Option<f64>,
    pub change_24h: Option<f64>,
    pub buys_24h: u64,
    pub sells_24h: u64,
    pub flow_1h: Flow,
    pub flow_24h: Flow,
    /// Share of recent trades that were buys, 0 to 100.
    pub buy_ratio_pct: Option<f64>,
    pub created_at: Option<i64>,
    pub url: String,
    pub image_url: Option<String>,
    pub holders: Option<u64>,
    pub top10_pct: Option<f64>,
    pub developer: Option<DeveloperView>,
    pub security: Option<Security>,
    pub score: Score,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FeedResponse {
    pub chain: String,
    pub launchpad: String,
    pub view: String,
    pub tokens: Vec<FeedToken>,
    /// How many of the tokens have had a full check so far.
    pub checked: usize,
    /// Developer wallets with a record in the index.
    pub developers_known: usize,
    pub updated_at: DateTime<Utc>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChainView {
    key: &'static str,
    name: &'static str,
    /// True when contract risk checks are available on this chain.
    risk_checks: bool,
    launchpads: &'static [Launchpad],
}

pub async fn get_chains() -> Json<Vec<ChainView>> {
    Json(
        CHAINS
            .iter()
            .map(|c| ChainView {
                key: c.key,
                name: c.name,
                risk_checks: c.kind == ChainKind::Solana || c.goplus_id.is_some(),
                launchpads: launchpads_for(c.key),
            })
            .collect(),
    )
}

// ── Building a feed ──────────────────────────────────────────────────────────

fn verdict(stats: &DevStats) -> &'static str {
    match stats.success_rate {
        Some(r) if r >= 50.0 => "proven",
        Some(r) if r < 20.0 => "poor",
        Some(_) => "mixed",
        None if stats.launches_seen == 0 => "first",
        None => "mixed",
    }
}

/// One call to the pool data provider. With a CoinGecko API key the request
/// goes to CoinGecko's on chain API, which serves the same data from a
/// dedicated allowance. Without one it goes to GeckoTerminal's public API.
pub(crate) async fn gecko(
    state: &AppState,
    path: &str,
    query: &[(&str, String)],
) -> std::result::Result<String, UpstreamError> {
    // The provider rejects bursts, so its calls are spaced out.
    state
        .launchpad
        .turn(Duration::from_millis(state.config.provider_call_spacing_ms))
        .await;
    gecko_now(state, path, query).await
}

/// The call itself. The caller has already taken its turn.
async fn gecko_now(
    state: &AppState,
    path: &str,
    query: &[(&str, String)],
) -> std::result::Result<String, UpstreamError> {
    let accept = ("accept", "application/json;version=20230302");
    let keyed = match &state.config.coingecko_api_key {
        Some(key) => {
            let url = format!("{}/onchain{}", state.config.coingecko_base, path);
            let result = state
                .up
                .get_json_with::<Value>(
                    "coingecko-onchain",
                    &url,
                    query,
                    &[accept, ("x-cg-demo-api-key", key.as_str())],
                )
                .await;
            match result {
                // A rejected key must not take the sniper down: fall through to the public API.
                Err(UpstreamError::Http {
                    status: 400..=403, ..
                }) => None,
                other => Some(other),
            }
        }
        None => None,
    };
    let result = match keyed {
        Some(r) => r,
        None => {
            let url = format!("{}{}", state.config.geckoterminal_base, path);
            state
                .up
                .get_json_with::<Value>("geckoterminal", &url, query, &[accept])
                .await
        }
    };
    if matches!(&result, Err(UpstreamError::Http { status: 429, .. })) {
        state.launchpad.pause();
    }
    result.map(|v| v.to_string())
}

async fn fetch_pools(
    state: &AppState,
    chain: &ChainInfo,
    launchpad: Option<&Launchpad>,
    view: &str,
) -> std::result::Result<Vec<Pool>, UpstreamError> {
    let net = chain.gecko_network;
    let include = ("include", "base_token,quote_token,dex".to_string());
    let page = |n: u32| [include.clone(), ("page", n.to_string())];
    let raw = match (launchpad, view) {
        // The busiest pools on one launchpad.
        (Some(l), "active") => {
            gecko(
                state,
                &format!("/networks/{net}/dexes/{}/pools", l.id),
                &page(1),
            )
            .await?
        }
        (None, "active") => {
            gecko(state, &format!("/networks/{net}/trending_pools"), &page(1)).await?
        }
        // Newest pools across the chain.
        _ => gecko(state, &format!("/networks/{net}/new_pools"), &page(1)).await?,
    };
    let mut pools = parse_pools(&raw, chain);
    if let (Some(l), "new") = (launchpad, view) {
        pools.retain(|p| p.dex == l.id);
        // Newest pools on a quiet launchpad may not be on the first page.
        if pools.len() < 6 {
            if let Ok(more) = gecko(state, &format!("/networks/{net}/new_pools"), &page(2)).await {
                pools.extend(
                    parse_pools(&more, chain)
                        .into_iter()
                        .filter(|p| p.dex == l.id),
                );
            }
        }
    }
    // One entry per token: keep its deepest pool.
    let mut best: HashMap<String, Pool> = HashMap::new();
    for p in pools {
        match best.get(&p.address) {
            Some(existing) if existing.liquidity_usd >= p.liquidity_usd => {}
            _ => {
                best.insert(p.address.clone(), p);
            }
        }
    }
    let mut out: Vec<Pool> = best.into_values().collect();
    out.truncate(MAX_FEED_TOKENS);
    Ok(out)
}

/// Bonding curve progress for the feed's tokens. Returns the map and whether
/// a provider call was spent on it.
async fn fetch_graduations(
    state: &Arc<AppState>,
    chain: &ChainInfo,
    feed_key: &str,
    pools: &[Pool],
) -> (HashMap<String, Graduation>, bool) {
    if pools.is_empty() || launchpads_for(chain.key).is_empty() {
        return (HashMap::new(), false);
    }
    let cache = &state.launchpad.graduations;
    if cache.is_fresh(feed_key) || state.launchpad.paused() {
        return (cache.peek(feed_key).unwrap_or_default(), false);
    }
    let addresses: Vec<&str> = pools.iter().take(30).map(|p| p.address.as_str()).collect();
    let path = format!(
        "/networks/{}/tokens/multi/{}",
        chain.gecko_network,
        addresses.join(",")
    );
    let st = state.clone();
    let map = cache
        .get_or_fetch(feed_key, || async move {
            gecko(&st, &path, &[])
                .await
                .map(|raw| parse_graduations(&raw))
        })
        .await
        .unwrap_or_else(|e| {
            tracing::warn!("launchpad progress for {} failed: {e}", chain.key);
            HashMap::new()
        });
    (map, true)
}

async fn fetch_intel(state: &Arc<AppState>, chain: ChainInfo, address: String) -> Option<Intel> {
    let key = token_id(chain.key, &address);
    let st = state.clone();
    state
        .launchpad
        .intel
        .get_or_fetch(&key, || async move {
            let path = format!("/networks/{}/tokens/{}/info", chain.gecko_network, address);
            let raw = gecko(&st, &path, &[]).await?;
            parse_intel(&raw).ok_or_else(|| UpstreamError::Parse("token info".into()))
        })
        .await
        .map_err(|e| tracing::warn!("token check on {} failed: {e}", chain.key))
        .ok()
}

/// A fresh look at one token, skipping the long lived check cache. The trade
/// keeper uses it to see whether the developer's holding has moved. Returns
/// `None` when the provider is resting after a rate limit or the call fails.
///
/// A `patient` caller (the background check) waits for its turn. Any other
/// caller is answering a person, so it gives up at once when the provider is
/// busy and tries again on a later round. That also keeps a flood of requests
/// from piling up behind the provider's pace.
pub(crate) async fn fresh_intel(
    state: &AppState,
    chain: &ChainInfo,
    address: &str,
    patient: bool,
) -> Option<Intel> {
    if state.launchpad.paused() {
        return None;
    }
    let spacing = Duration::from_millis(state.config.provider_call_spacing_ms);
    if patient {
        state.launchpad.turn(spacing).await;
    } else if !state
        .launchpad
        .turn_soon(spacing, Duration::from_millis(1500))
        .await
    {
        return None;
    }
    let path = format!("/networks/{}/tokens/{}/info", chain.gecko_network, address);
    match gecko_now(state, &path, &[]).await {
        Ok(raw) => parse_intel(&raw),
        Err(e) => {
            tracing::warn!("developer check on {} failed: {e}", chain.key);
            None
        }
    }
}

async fn build_feed(
    state: &Arc<AppState>,
    chain: ChainInfo,
    launchpad: Option<Launchpad>,
    view: &str,
    same_pools: bool,
) -> std::result::Result<FeedResponse, UpstreamError> {
    let feed_key = format!(
        "{}:{}:{view}",
        chain.key,
        launchpad.map(|l| l.id).unwrap_or("all")
    );
    let reused = if same_pools {
        state.launchpad.pools.peek(&feed_key)
    } else {
        None
    };
    let mut pools = match reused {
        Some(pools) => pools,
        None => {
            let fresh = fetch_pools(state, &chain, launchpad.as_ref(), view).await?;
            state
                .launchpad
                .pools
                .put(&feed_key, fresh.clone(), Duration::ZERO)
                .await;
            fresh
        }
    };
    let mut budget = if state.config.coingecko_api_key.is_some() {
        EXTRA_CALLS_KEYED
    } else {
        EXTRA_CALLS_PUBLIC
    };
    let (graduations, spent) = fetch_graduations(state, &chain, &feed_key, &pools).await;
    if spent {
        budget -= 1;
    }
    // A token that has graduated left its curve pool empty and now trades
    // elsewhere. The old pool's price is stale, so it does not belong in a feed.
    pools.retain(|p| {
        let graduated = graduations.get(&p.address).is_some_and(|g| g.completed);
        !(graduated && launchpad_of(chain.key, &p.dex).is_some_and(|l| l.curve))
    });
    for p in pools.iter_mut() {
        p.on_curve = on_curve(chain.key, &p.dex, graduations.get(&p.address).copied());
    }
    let now_ms = Utc::now().timestamp_millis();
    let cache_key = |p: &Pool| token_id(chain.key, &p.address);

    // A token another copy of the service checked recently is not checked again.
    if let Some(db) = &state.db {
        let missing: Vec<String> = pools
            .iter()
            .filter(|p| state.launchpad.intel.peek(&cache_key(p)).is_none())
            .map(|p| p.address.clone())
            .collect();
        for (token, intel, age) in records::load_checks(db, chain.key, &missing).await {
            state
                .launchpad
                .intel
                .put(&token_id(chain.key, &token), intel, age)
                .await;
        }
    }

    // Check the most promising tokens that have not been checked yet.
    let mut unchecked: Vec<(&Pool, u32)> = pools
        .iter()
        .filter(|p| {
            state.launchpad.intel.peek(&cache_key(p)).is_none()
                && !state.launchpad.check_failed_recently(&cache_key(p))
        })
        .map(|p| {
            (
                p,
                score_token(
                    p,
                    graduations.get(&p.address).copied(),
                    None,
                    None,
                    None,
                    now_ms,
                )
                .total,
            )
        })
        .collect();
    unchecked.sort_by_key(|(_, s)| std::cmp::Reverse(*s));
    let mut fresh_checks: Vec<(String, Intel)> = Vec::new();
    for (p, _) in unchecked.iter().take(budget) {
        // Contract risk comes from another provider, so it is not held back.
        let security = security_for(state, chain, &p.address);
        if state.launchpad.paused() {
            security.await;
            continue;
        }
        let (intel, _) = tokio::join!(fetch_intel(state, chain, p.address.clone()), security);
        match intel {
            Some(intel) => fresh_checks.push((p.address.clone(), intel)),
            None if !state.launchpad.paused() => state.launchpad.note_failed_check(&cache_key(p)),
            None => {}
        }
    }
    if let Some(db) = &state.db {
        records::save_checks(db, chain.key, &fresh_checks).await;
    }

    // Remember every identified developer's launch before judging anyone.
    let intel_of: HashMap<&str, Intel> = pools
        .iter()
        .filter_map(|p| {
            Some((
                p.address.as_str(),
                state.launchpad.intel.peek(&cache_key(p))?,
            ))
        })
        .collect();
    // Their earlier launches, as every copy of the service has seen them.
    if let Some(db) = &state.db {
        let mut developers: Vec<String> = intel_of
            .values()
            .filter_map(|i| i.developer.clone())
            .collect();
        developers.sort();
        developers.dedup();
        for (developer, launch) in records::load_launches(db, chain.key, &developers).await {
            state.launchpad.devs.record(chain.key, &developer, launch);
        }
    }
    let mut observed: Vec<(String, DevLaunch)> = Vec::new();
    for p in &pools {
        let Some(intel) = intel_of.get(p.address.as_str()) else {
            continue;
        };
        let Some(dev) = &intel.developer else {
            continue;
        };
        let graduation = graduations.get(&p.address).copied().or(intel.graduation);
        let launch = DevLaunch {
            token: p.address.clone(),
            graduated: graduation.is_some_and(|g| g.completed),
            on_curve: p.on_curve,
            liquidity_usd: p.liquidity_usd,
            market_cap_usd: p.market_cap_usd,
            buy_ratio: judged_flow(p).buy_ratio(),
            seen_at: now_ms,
        };
        state.launchpad.devs.record(chain.key, dev, launch.clone());
        observed.push((dev.clone(), launch));
    }
    let developers_known = match &state.db {
        Some(db) => {
            records::save_launches(db, chain.key, &observed).await;
            state
                .launchpad
                .dev_count
                .get_or_fetch("all", || async {
                    records::developer_count(db).await.ok_or(())
                })
                .await
                .ok()
                .map(|n| n.max(0) as usize)
        }
        None => None,
    }
    .unwrap_or_else(|| state.launchpad.devs.developers());

    let mut tokens: Vec<FeedToken> = Vec::with_capacity(pools.len());
    for p in &pools {
        let intel = intel_of.get(p.address.as_str());
        let graduation = graduations
            .get(&p.address)
            .copied()
            .or(intel.and_then(|i| i.graduation));
        let security = state
            .sniper
            .security_peek(&cache_key(p))
            .filter(|s| s.available);
        let developer = intel.and_then(|i| {
            let address = i.developer.clone()?;
            let record = state.launchpad.devs.stats(chain.key, &address, &p.address);
            Some(DeveloperView {
                verdict: verdict(&record),
                holding_pct: i.developer_holding_pct,
                record,
                address,
            })
        });
        let score = score_token(
            p,
            graduation,
            intel,
            security.as_ref(),
            developer.as_ref().map(|d| &d.record),
            now_ms,
        );
        tokens.push(FeedToken {
            id: cache_key(p),
            symbol: p.symbol.clone(),
            name: p.name.clone(),
            address: p.address.clone(),
            chain: chain.key.to_string(),
            url: format!(
                "https://www.geckoterminal.com/{}/pools/{}",
                chain.gecko_network, p.pool_address
            ),
            pair_address: p.pool_address.clone(),
            launchpad: launchpad_name(chain.key, &p.dex),
            on_curve: p.on_curve,
            dex: p.dex.clone(),
            graduation,
            price_usd: p.price_usd,
            liquidity_usd: p.liquidity_usd,
            market_cap_usd: p.market_cap_usd,
            volume_24h_usd: p.volume_24h_usd,
            change_5m: p.change_5m,
            change_1h: p.change_1h,
            change_24h: p.change_24h,
            buys_24h: p.h24.buys,
            sells_24h: p.h24.sells,
            flow_1h: p.h1,
            flow_24h: p.h24,
            buy_ratio_pct: judged_flow(p).buy_ratio().map(|r| round1(r * 100.0)),
            created_at: p.created_at,
            image_url: p.image_url.clone(),
            holders: intel.and_then(|i| i.holders),
            top10_pct: intel.and_then(|i| i.top10_pct),
            developer,
            security,
            score,
        });
    }
    // Best first. Checked tokens outrank unchecked ones with the same score.
    tokens.sort_by(|a, b| {
        b.score
            .total
            .cmp(&a.score.total)
            .then(b.score.checked.cmp(&a.score.checked))
            .then(b.created_at.cmp(&a.created_at))
    });
    Ok(FeedResponse {
        chain: chain.key.to_string(),
        launchpad: launchpad.map(|l| l.id).unwrap_or("all").to_string(),
        view: view.to_string(),
        checked: tokens.iter().filter(|t| t.score.checked).count(),
        developers_known,
        tokens,
        updated_at: Utc::now(),
    })
}

// ── HTTP handler ─────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct FeedQuery {
    chain: String,
    launchpad: Option<String>,
    view: Option<String>,
}

pub async fn get_feed(
    State(state): State<Arc<AppState>>,
    Query(q): Query<FeedQuery>,
) -> Result<Json<FeedResponse>> {
    Ok(Json(
        feed(&state, &q.chain, q.launchpad.as_deref(), q.view.as_deref()).await?,
    ))
}

/// Runs the full check (developer wallet, holders, authorities, contract risk)
/// on tokens that have not had one, most important first, until `max` are
/// done or `time` runs out. Results land in the shared caches and the
/// database, so the next feed build scores them. Returns how many were checked.
pub async fn check_now(
    state: &Arc<AppState>,
    chain: &str,
    addresses: &[String],
    max: usize,
    time: Duration,
) -> usize {
    let Some(chain) = chain_info(chain) else {
        return 0;
    };
    let todo: Vec<&String> = addresses
        .iter()
        .filter(|a| valid_address_for(chain.key, a))
        .filter(|a| {
            let key = token_id(chain.key, a);
            state.launchpad.intel.peek(&key).is_none()
                && !state.launchpad.check_failed_recently(&key)
        })
        .take(max)
        .collect();
    let mut fresh: Vec<(String, Intel)> = Vec::new();
    let work = async {
        // Contract risk comes from another provider, so those run side by side.
        let risks =
            futures_util::future::join_all(todo.iter().map(|a| security_for(state, chain, a)));
        let developers = async {
            for a in &todo {
                if state.launchpad.paused() {
                    break;
                }
                match fetch_intel(state, chain, (*a).clone()).await {
                    Some(intel) => fresh.push(((*a).clone(), intel)),
                    None => state.launchpad.note_failed_check(&token_id(chain.key, a)),
                }
            }
        };
        tokio::join!(risks, developers);
    };
    // Whatever finished in time is kept, even when the rest did not.
    let _ = tokio::time::timeout(time, work).await;
    if let Some(db) = &state.db {
        records::save_checks(db, chain.key, &fresh).await;
    }
    fresh.len()
}

/// Scores a feed again with the latest checks, over the same tokens it showed
/// a moment ago, so tokens just checked are not pushed out by newer launches.
pub async fn rescore_feed(
    state: &Arc<AppState>,
    chain: &str,
    launchpad: Option<&str>,
    view: Option<&str>,
) -> Result<FeedResponse> {
    let (chain, launchpad, view) = feed_target(chain, launchpad, view)?;
    let key = format!(
        "{}:{}:{view}",
        chain.key,
        launchpad.map(|l| l.id).unwrap_or("all")
    );
    let fresh = build_feed(state, chain, launchpad, view, true).await?;
    state
        .launchpad
        .feeds
        .put(&key, fresh.clone(), Duration::ZERO)
        .await;
    Ok(fresh)
}

/// Checks a feed request against the registry. Only registry ids may reach
/// an upstream URL.
fn feed_target(
    chain: &str,
    launchpad: Option<&str>,
    view: Option<&str>,
) -> Result<(ChainInfo, Option<Launchpad>, &'static str)> {
    let chain =
        chain_info(chain).ok_or_else(|| AppError::BadRequest("unsupported chain".into()))?;
    let launchpad = match launchpad {
        None | Some("all") | Some("") => None,
        Some(id) => Some(
            launchpads_for(chain.key)
                .iter()
                .copied()
                .find(|l| l.id == id)
                .ok_or_else(|| AppError::BadRequest("unknown launchpad for this chain".into()))?,
        ),
    };
    let view = match view {
        None | Some("new") => "new",
        Some("active") => "active",
        Some(_) => return Err(AppError::BadRequest("view must be new or active".into())),
    };
    Ok((chain, launchpad, view))
}

/// A launchpad feed, from the shared cache or freshly built. Used by the
/// feed endpoint and by the AI assistant's tools.
pub async fn feed(
    state: &Arc<AppState>,
    chain: &str,
    launchpad: Option<&str>,
    view: Option<&str>,
) -> Result<FeedResponse> {
    let (chain, launchpad, view) = feed_target(chain, launchpad, view)?;
    let key = format!(
        "{}:{}:{view}",
        chain.key,
        launchpad.map(|l| l.id).unwrap_or("all")
    );
    let st = state.clone();
    Ok(state
        .launchpad
        .feeds
        .get_or_fetch(&key, || async move {
            build_feed(&st, chain, launchpad, view, false).await
        })
        .await?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn solana() -> ChainInfo {
        chain_info("solana").unwrap()
    }

    const MINT: &str = "CYJw33QHZ49oEgvK4YpE7Vowu9ACZWEoNsNPcDKepump";

    fn pools_json() -> String {
        format!(
            r#"{{"data":[{{"id":"solana_POOL","type":"pool","attributes":{{"name":"TEST / SOL","address":"POOLaddr1111111111111111111111111111111111",
            "base_token_price_usd":"0.00012","fdv_usd":"120000","market_cap_usd":null,"reserve_in_usd":"24000.5",
            "pool_created_at":"2026-11-14T20:00:00Z",
            "price_change_percentage":{{"m5":"1.5","h1":"22.4","h24":"310"}},
            "transactions":{{"m5":{{"buys":12,"sells":4,"buyers":11,"sellers":4}},"h1":{{"buys":300,"sells":100,"buyers":210,"sellers":80}},"h24":{{"buys":900,"sells":500,"buyers":600,"sellers":300}}}},
            "volume_usd":{{"h1":"15000","h24":"98000"}}}},
            "relationships":{{"base_token":{{"data":{{"id":"solana_{MINT}"}}}},"dex":{{"data":{{"id":"pump-fun"}}}}}}}},
            {{"id":"bad","type":"pool","attributes":{{"name":"X / SOL","address":"p","base_token_price_usd":"1"}},
            "relationships":{{"base_token":{{"data":{{"id":"solana_not a valid address!"}}}},"dex":{{"data":{{"id":"raydium"}}}}}}}}],
            "included":[{{"id":"solana_{MINT}","type":"token","attributes":{{"address":"{MINT}","name":"Test Coin","symbol":"TEST","image_url":"https://img.example/t.png"}}}}]}}"#
        )
    }

    fn pool() -> Pool {
        parse_pools(&pools_json(), &solana()).remove(0)
    }

    #[test]
    fn pools_parse_with_trade_flow_and_reject_bad_addresses() {
        let pools = parse_pools(&pools_json(), &solana());
        assert_eq!(
            pools.len(),
            1,
            "the pool with an invalid token address is dropped"
        );
        let p = &pools[0];
        assert_eq!(p.symbol, "TEST");
        assert_eq!(p.dex, "pump-fun");
        assert_eq!(
            p.market_cap_usd, 120000.0,
            "falls back to fully diluted value"
        );
        assert_eq!(
            p.h1,
            Flow {
                buys: 300,
                sells: 100,
                buyers: 210,
                sellers: 80
            }
        );
        assert_eq!(p.h1.buy_ratio(), Some(0.75));
        assert_eq!(p.change_1h, Some(22.4));
        assert!(p.created_at.is_some());
    }

    #[test]
    fn graduation_and_intel_parse_from_real_shapes() {
        let multi = format!(
            r#"{{"data":[{{"attributes":{{"address":"{MINT}","launchpad_details":{{"graduation_percentage":89.16,"completed":false,"completed_at":null}}}}}},
            {{"attributes":{{"address":"other","launchpad_details":null}}}}]}}"#
        );
        let g = parse_graduations(&multi);
        assert_eq!(g.len(), 1);
        assert_eq!(
            g[MINT],
            Graduation {
                percent: 89.2,
                completed: false
            }
        );

        let info = r#"{"data":{"attributes":{"developer_address":"HjTUoWdev","developer_holding_percentage":3.07,
            "holders":{"count":177,"distribution_percentage":{"top_10":"93.4338","11_20":"6.1"}},
            "mint_authority":"no","freeze_authority":"no","is_honeypot":"unknown","twitter_handle":"x","websites":[],
            "launchpad_details":{"graduation_percentage":100,"completed":true}}}}"#;
        let i = parse_intel(info).unwrap();
        assert_eq!(i.developer.as_deref(), Some("HjTUoWdev"));
        assert_eq!(i.developer_holding_pct, Some(3.07));
        assert_eq!(i.holders, Some(177));
        assert_eq!(i.top10_pct, Some(93.4338));
        assert_eq!(i.mint_authority, Some(false));
        assert_eq!(i.honeypot, None, "unknown is not the same as safe");
        assert!(i.has_socials);
        assert_eq!(
            i.graduation,
            Some(Graduation {
                percent: 100.0,
                completed: true
            })
        );
        // An authority that is anything but "no" is treated as active.
        assert_eq!(
            yes_no(Some(&Value::String("SomeAuthorityAddress".into()))),
            Some(true)
        );
    }

    #[test]
    fn developer_record_counts_successes_and_ignores_the_token_itself() {
        let index = DevIndex::default();
        let launch = |token: &str, graduated: bool, liq: f64, cap: f64, ratio: f64| DevLaunch {
            token: token.into(),
            graduated,
            on_curve: false,
            liquidity_usd: liq,
            market_cap_usd: cap,
            buy_ratio: Some(ratio),
            seen_at: 0,
        };
        index.record("solana", "dev", launch("a", true, 0.0, 0.0, 0.7));
        index.record(
            "solana",
            "dev",
            launch("b", false, 50_000.0, 400_000.0, 0.6),
        );
        index.record("solana", "dev", launch("c", false, 200.0, 3_000.0, 0.4));
        index.record("solana", "dev", launch("current", false, 0.0, 0.0, 0.9));
        // Seeing a graduated token again with stale data must not undo the graduation.
        index.record("solana", "dev", launch("a", false, 0.0, 0.0, 0.7));

        let s = index.stats("solana", "dev", "current");
        assert_eq!((s.launches_seen, s.successes), (3, 2));
        assert_eq!(s.success_rate, Some(66.7));
        assert_eq!(s.avg_buy_ratio, Some(56.7));
        assert_eq!(verdict(&s), "proven");

        let unknown = index.stats("solana", "nobody", "x");
        assert_eq!(
            unknown.success_rate, None,
            "no record means no rate, not zero"
        );
        assert_eq!(verdict(&unknown), "first");
        assert_eq!(
            index.stats("bsc", "dev", "x").launches_seen,
            0,
            "records are per chain"
        );
    }

    fn clean_intel() -> Intel {
        Intel {
            developer: Some("dev".into()),
            developer_holding_pct: Some(3.0),
            holders: Some(900),
            top10_pct: Some(25.0),
            mint_authority: Some(false),
            freeze_authority: Some(false),
            honeypot: Some(false),
            has_socials: true,
            graduation: None,
        }
    }

    #[test]
    fn a_strong_checked_token_scores_high_and_explains_itself() {
        let record = DevStats {
            launches_seen: 5,
            successes: 4,
            success_rate: Some(80.0),
            avg_buy_ratio: Some(62.0),
        };
        let grad = Some(Graduation {
            percent: 100.0,
            completed: true,
        });
        let now = pool().created_at.unwrap() + 45 * 60_000;
        let s = score_token(
            &pool(),
            grad,
            Some(&clean_intel()),
            None,
            Some(&record),
            now,
        );
        assert!(s.checked && !s.blocked);
        assert!(s.total >= 80, "got {} {:?}", s.total, s.parts);
        assert_eq!(s.grade, "A");
        assert!(s
            .reasons
            .iter()
            .any(|r| r.contains("4 of 5 earlier launches")));
        assert!(s
            .reasons
            .iter()
            .any(|r| r.contains("75% of recent trades are buys")));
    }

    #[test]
    fn unchecked_tokens_never_reach_the_top_grades() {
        let now = pool().created_at.unwrap() + 45 * 60_000;
        let s = score_token(&pool(), None, None, None, None, now);
        assert!(!s.checked);
        assert!(
            s.total < 65,
            "an unchecked token must stay below grade B, got {}",
            s.total
        );
    }

    #[test]
    fn serious_risks_block_a_token_whatever_else_looks_good() {
        let record = DevStats {
            launches_seen: 5,
            successes: 5,
            success_rate: Some(100.0),
            avg_buy_ratio: Some(70.0),
        };
        let now = pool().created_at.unwrap() + 45 * 60_000;
        for risky in [
            Intel {
                honeypot: Some(true),
                ..clean_intel()
            },
            Intel {
                mint_authority: Some(true),
                ..clean_intel()
            },
            Intel {
                freeze_authority: Some(true),
                ..clean_intel()
            },
            Intel {
                developer_holding_pct: Some(45.0),
                ..clean_intel()
            },
        ] {
            let s = score_token(&pool(), None, Some(&risky), None, Some(&record), now);
            assert!(s.blocked && s.total <= 20, "{risky:?} scored {}", s.total);
            assert_eq!(s.grade, "F");
            assert!(!s.warnings.is_empty());
        }
        let taxed = Security {
            available: true,
            risk_score: 20,
            sell_tax_pct: Some(40.0),
            ..Security::unavailable()
        };
        let s = score_token(
            &pool(),
            None,
            Some(&clean_intel()),
            Some(&taxed),
            Some(&record),
            now,
        );
        assert!(s.blocked);
    }

    #[test]
    fn a_poor_developer_record_and_seller_pressure_pull_the_score_down() {
        let now = pool().created_at.unwrap() + 45 * 60_000;
        let good = DevStats {
            launches_seen: 6,
            successes: 5,
            success_rate: Some(83.3),
            avg_buy_ratio: None,
        };
        let bad = DevStats {
            launches_seen: 6,
            successes: 0,
            success_rate: Some(0.0),
            avg_buy_ratio: None,
        };
        let a = score_token(&pool(), None, Some(&clean_intel()), None, Some(&good), now);
        let b = score_token(&pool(), None, Some(&clean_intel()), None, Some(&bad), now);
        assert!(
            a.parts.developer >= b.parts.developer + 10,
            "{} vs {}",
            a.parts.developer,
            b.parts.developer
        );
        assert!(b
            .warnings
            .iter()
            .any(|w| w.contains("0 of 6 earlier launches")));

        let mut dumping = pool();
        dumping.h1 = Flow {
            buys: 60,
            sells: 240,
            buyers: 40,
            sellers: 200,
        };
        let c = score_token(&dumping, None, Some(&clean_intel()), None, Some(&good), now);
        assert!(
            c.parts.demand + 12 <= a.parts.demand,
            "{} vs {}",
            c.parts.demand,
            a.parts.demand
        );
        assert!(c.warnings.iter().any(|w| w.contains("Sellers lead")));

        let mut washed = pool();
        washed.h1 = Flow {
            buys: 900,
            sells: 300,
            buyers: 20,
            sellers: 10,
        };
        let d = score_token(&washed, None, Some(&clean_intel()), None, Some(&good), now);
        assert!(d.warnings.iter().any(|w| w.contains("wash trading")));
    }

    #[test]
    fn every_listed_chain_has_valid_launchpad_ids() {
        for c in CHAINS {
            for l in launchpads_for(c.key) {
                assert!(
                    l.id.chars()
                        .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_'),
                    "{}",
                    l.id
                );
            }
        }
        assert_eq!(launchpad_name("solana", "pump-fun"), Some("Pump.fun"));
        assert_eq!(launchpad_name("solana", "raydium"), None);
        assert!(!launchpads_for("robinhood").is_empty());
    }

    #[test]
    fn bonding_curve_tokens_are_not_marked_down_for_having_no_pool() {
        let near_graduation = Some(Graduation {
            percent: 90.0,
            completed: false,
        });
        assert!(on_curve("solana", "pump-fun", near_graduation));
        assert!(
            on_curve("solana", "pump-fun", None),
            "a curve launchpad with no progress data is still a curve"
        );
        assert!(!on_curve("solana", "pumpswap", None));
        assert!(!on_curve(
            "solana",
            "pump-fun",
            Some(Graduation {
                percent: 100.0,
                completed: true
            })
        ));

        let mut curve_pool = pool();
        curve_pool.liquidity_usd = 0.0;
        curve_pool.on_curve = true;
        let now = curve_pool.created_at.unwrap() + 45 * 60_000;
        let on = score_token(
            &curve_pool,
            near_graduation,
            Some(&clean_intel()),
            None,
            None,
            now,
        );
        assert!(!on.warnings.iter().any(|w| w.contains("thin liquidity")));
        assert!(on.parts.liquidity >= 8, "{}", on.parts.liquidity);
        // Holder spread is ignored on the curve, where the curve holds the supply.
        let concentrated = Intel {
            top10_pct: Some(95.0),
            ..clean_intel()
        };
        let s = score_token(
            &curve_pool,
            near_graduation,
            Some(&concentrated),
            None,
            None,
            now,
        );
        assert!(!s.warnings.iter().any(|w| w.contains("Top 10 wallets")));

        // The same empty pool on an ordinary exchange is a real problem.
        curve_pool.on_curve = false;
        let off = score_token(&curve_pool, None, Some(&clean_intel()), None, None, now);
        assert!(off.warnings.iter().any(|w| w.contains("thin liquidity")));
        assert!(off.parts.liquidity <= 2);
    }

    #[test]
    fn a_launch_still_on_its_curve_has_not_succeeded_yet() {
        let launch = DevLaunch {
            token: "t".into(),
            graduated: false,
            on_curve: true,
            liquidity_usd: 50_000.0,
            market_cap_usd: 400_000.0,
            buy_ratio: None,
            seen_at: 0,
        };
        assert!(!launch.succeeded());
        assert!(DevLaunch {
            on_curve: false,
            ..launch.clone()
        }
        .succeeded());
        assert!(DevLaunch {
            graduated: true,
            ..launch
        }
        .succeeded());
    }

    #[test]
    fn grades_follow_the_score() {
        assert_eq!(grade_for(92), "A");
        assert_eq!(grade_for(70), "B");
        assert_eq!(grade_for(50), "C");
        assert_eq!(grade_for(40), "D");
        assert_eq!(grade_for(10), "F");
    }
}
