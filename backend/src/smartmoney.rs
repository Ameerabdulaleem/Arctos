//! Smart money: wallets that bought legit tokens early, before those tokens pumped.
//!
//! The trending pools on a chain are read from GeckoTerminal. The legit ones (real liquidity
//! and volume, not a stablecoin or wrapped coin) are ranked by how far they rose, and the
//! large trades of the top few are read. Each wallet's buys and sells in a pool give its entry
//! price, what it took out and what it still holds, valued at today's price. Bots (dozens of
//! trades, or buying and selling in the same second) are dropped. Every wallet is then graded
//! on how many of these tokens it won on, its win rate across the tokens it traded, and its
//! profit. Everything is cached, so a page view costs no provider calls.

use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use axum::{
    extract::{Query, State},
    Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::{
    error::{AppError, Result},
    launchpad::gecko,
    sniper::{chain_info, num, parse_new_pools, ChainInfo, SniperToken},
    upstream::{KeyedCache, UpstreamError},
    AppState,
};

/// Chains the scan covers. GeckoTerminal lists trades with wallets on each.
pub const CHAINS: &[&str] = &["solana", "bsc", "base"];
/// Pools whose trades are read on each scan. Each one is a provider call.
const POOLS_PER_SCAN: usize = 6;
/// Only trades at least this large are read, so the wallets are whales, not dust.
const MIN_TRADE_USD: u32 = 300;
/// A wallet must have put at least this much into a token to count there.
const MIN_POSITION_USD: f64 = 300.0;
/// More trades than this in one pool is a bot, not a trader.
const BOT_TRADES: u32 = 24;
/// A token is legit enough to grade on when it has this much liquidity and volume.
const MIN_LIQUIDITY_USD: f64 = 25_000.0;
const MIN_VOLUME_USD: f64 = 50_000.0;
const MAX_WALLETS: usize = 60;
/// Trades read on earlier scans are kept this long, so wallets that hit several tokens show.
/// A token that left the trending list keeps its last price, so this is kept short.
const RETAIN: Duration = Duration::from_secs(3 * 3600);
/// Pools kept per chain, and trades kept per pool.
const MAX_BOOKS: usize = 30;
const MAX_TRADES: usize = 3000;
/// How long to wait before asking again when the provider says it is busy.
const BUSY_WAIT: Duration = Duration::from_secs(10);

/// Wrapped coins and stablecoins are what tokens trade against, not tokens to grade on.
const QUOTES: &[&str] = &[
    "SOL", "WSOL", "USDC", "USDT", "USD1", "DAI", "BNB", "WBNB", "ETH", "WETH", "CBBTC", "WBTC",
    "BUSD", "FDUSD", "PYUSD", "USDS",
];

/// The trades read for one pool, across scans.
struct PoolBook {
    token: SniperToken,
    trades: HashMap<String, Trade>,
    read_at: Instant,
}

pub struct SmartStore {
    scans: KeyedCache<Value>,
    /// Pools read recently, by chain and then pool address.
    books: Mutex<HashMap<String, HashMap<String, PoolBook>>>,
}

impl SmartStore {
    pub fn new() -> Self {
        Self {
            // A scan is fresh for ten minutes and served for an hour if a refresh fails.
            scans: KeyedCache::new(Duration::from_secs(600), Duration::from_secs(3600)),
            books: Mutex::new(HashMap::new()),
        }
    }

    /// Adds a pool's newly read trades to what earlier scans read, refreshes the prices of
    /// every pool still trending, drops old pools, and returns what is left to grade on.
    fn merge(
        &self,
        chain: &str,
        read: Vec<(SniperToken, Vec<Trade>)>,
        trending: &[SniperToken],
    ) -> Vec<(SniperToken, Vec<Trade>)> {
        let mut all = self.books.lock().unwrap_or_else(|e| e.into_inner());
        let books = all.entry(chain.to_string()).or_default();
        let now = Instant::now();
        for (token, trades) in read {
            let book = books
                .entry(token.pair_address.clone())
                .or_insert_with(|| PoolBook {
                    token: token.clone(),
                    trades: HashMap::new(),
                    read_at: now,
                });
            book.token = token;
            book.read_at = now;
            for t in trades {
                book.trades.insert(t.tx.clone(), t);
            }
            if book.trades.len() > MAX_TRADES {
                let mut v: Vec<Trade> = book.trades.drain().map(|(_, t)| t).collect();
                v.sort_by_key(|t| std::cmp::Reverse(t.at));
                v.truncate(MAX_TRADES);
                book.trades = v.into_iter().map(|t| (t.tx.clone(), t)).collect();
            }
        }
        for t in trending {
            if let Some(book) = books.get_mut(&t.pair_address) {
                book.token = t.clone();
            }
        }
        books.retain(|_, b| now.duration_since(b.read_at) < RETAIN);
        if books.len() > MAX_BOOKS {
            let mut by_age: Vec<(String, Instant)> =
                books.iter().map(|(k, b)| (k.clone(), b.read_at)).collect();
            by_age.sort_by_key(|x| std::cmp::Reverse(x.1));
            for (k, _) in by_age.into_iter().skip(MAX_BOOKS) {
                books.remove(&k);
            }
        }
        books
            .values()
            .map(|b| (b.token.clone(), b.trades.values().cloned().collect()))
            .collect()
    }

    /// Pools read in the last `within`, so a scan can read others first.
    fn read_recently(&self, chain: &str, within: Duration) -> HashSet<String> {
        let all = self.books.lock().unwrap_or_else(|e| e.into_inner());
        all.get(chain)
            .map(|b| {
                b.iter()
                    .filter(|(_, x)| x.read_at.elapsed() < within)
                    .map(|(k, _)| k.clone())
                    .collect()
            })
            .unwrap_or_default()
    }
}

impl Default for SmartStore {
    fn default() -> Self {
        Self::new()
    }
}

/// One trade in a pool, from the side of the token being graded.
#[derive(Debug, Clone, PartialEq)]
pub struct Trade {
    /// The transaction, so a trade read on two scans counts once.
    pub tx: String,
    pub wallet: String,
    pub buy: bool,
    pub usd: f64,
    pub qty: f64,
    pub at: i64,
}

/// GeckoTerminal trades response to trades of `token`. Trades that do not move it are dropped.
pub fn parse_trades(raw: &str, token: &str) -> Vec<Trade> {
    let Ok(v) = serde_json::from_str::<Value>(raw) else {
        return vec![];
    };
    let Some(data) = v.get("data").and_then(|d| d.as_array()) else {
        return vec![];
    };
    let same = |a: Option<&Value>| {
        a.and_then(|x| x.as_str())
            .is_some_and(|x| x.eq_ignore_ascii_case(token))
    };
    data.iter()
        .filter_map(|t| {
            let a = t.get("attributes")?;
            let wallet = a.get("tx_from_address")?.as_str()?.trim();
            if wallet.is_empty() || wallet.len() > 64 {
                return None;
            }
            let usd = num(a.get("volume_in_usd"))?;
            let (buy, qty) = if same(a.get("to_token_address")) {
                (true, num(a.get("to_token_amount"))?)
            } else if same(a.get("from_token_address")) {
                (false, num(a.get("from_token_amount"))?)
            } else {
                return None;
            };
            if !(usd.is_finite() && usd > 0.0 && qty.is_finite() && qty > 0.0) {
                return None;
            }
            let at = a
                .get("block_timestamp")
                .and_then(|x| x.as_str())
                .and_then(|x| DateTime::parse_from_rfc3339(x).ok())
                .map(|d| d.timestamp_millis())
                .unwrap_or(0);
            let tx = a
                .get("tx_hash")
                .and_then(|x| x.as_str())
                .filter(|x| !x.is_empty() && x.len() <= 100)
                .map(str::to_string)
                .unwrap_or_else(|| format!("{wallet}:{at}:{usd}:{qty}"));
            Some(Trade {
                tx,
                wallet: wallet.to_string(),
                buy,
                usd,
                qty,
                at,
            })
        })
        .collect()
}

/// A wallet's trades in one token.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Position {
    pub buys: u32,
    pub sells: u32,
    pub bought_usd: f64,
    pub bought_qty: f64,
    pub sold_usd: f64,
    pub sold_qty: f64,
    pub first_buy_at: i64,
    pub last_at: i64,
}

/// What a position is worth at `price`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Valued {
    pub realized_usd: f64,
    pub unrealized_usd: f64,
    pub pnl_usd: f64,
    pub roi_pct: f64,
    pub entry_price: f64,
    /// Share of the tokens bought that the wallet still holds, from 0 to 1.
    pub held_share: f64,
}

impl Position {
    pub fn value(&self, price: f64) -> Valued {
        let entry = self.bought_usd / self.bought_qty;
        // Tokens sold beyond what was bought here were bought before the trades read, so
        // only the part covered by a known buy counts.
        let sold_tracked = self.sold_qty.min(self.bought_qty);
        let proceeds = if self.sold_qty > 0.0 {
            self.sold_usd * sold_tracked / self.sold_qty
        } else {
            0.0
        };
        let realized = proceeds - entry * sold_tracked;
        let left = self.bought_qty - sold_tracked;
        let unrealized = left * price - entry * left;
        let pnl = realized + unrealized;
        Valued {
            realized_usd: realized,
            unrealized_usd: unrealized,
            pnl_usd: pnl,
            roi_pct: pnl / self.bought_usd * 100.0,
            entry_price: entry,
            held_share: (left / self.bought_qty).clamp(0.0, 1.0),
        }
    }
}

/// Groups a pool's trades by wallet. Bots and wallets that only sold are left out.
pub fn positions(trades: &[Trade]) -> HashMap<String, Position> {
    let mut by: HashMap<String, (Position, Vec<(i64, bool)>)> = HashMap::new();
    for t in trades {
        let (p, marks) = by.entry(t.wallet.clone()).or_default();
        if t.buy {
            p.buys += 1;
            p.bought_usd += t.usd;
            p.bought_qty += t.qty;
            if p.first_buy_at == 0 || (t.at > 0 && t.at < p.first_buy_at) {
                p.first_buy_at = t.at;
            }
        } else {
            p.sells += 1;
            p.sold_usd += t.usd;
            p.sold_qty += t.qty;
        }
        p.last_at = p.last_at.max(t.at);
        marks.push((t.at, t.buy));
    }
    by.into_iter()
        .filter(|(_, (p, marks))| {
            if p.buys + p.sells > BOT_TRADES || p.bought_usd < MIN_POSITION_USD {
                return false;
            }
            // Buying and selling in the same second is a sandwich or arbitrage bot.
            let buys: HashSet<i64> = marks
                .iter()
                .filter(|(at, b)| *b && *at > 0)
                .map(|(at, _)| at / 1000)
                .collect();
            !marks
                .iter()
                .any(|(at, b)| !*b && *at > 0 && buys.contains(&(at / 1000)))
        })
        .map(|(w, (p, _))| (w, p))
        .collect()
}

/// True for a pool worth grading wallets on.
pub fn legit(t: &SniperToken) -> bool {
    t.price_usd > 0.0
        && t.liquidity_usd >= MIN_LIQUIDITY_USD
        && t.volume_24h_usd >= MIN_VOLUME_USD
        && !QUOTES.contains(&t.symbol.to_ascii_uppercase().as_str())
}

/// The pools to read trades of: the legit ones that rose most, then a couple of others not
/// read lately (often ones that fell), so a win rate also counts the losses.
pub fn pick_pools(
    tokens: Vec<SniperToken>,
    n: usize,
    read_lately: &HashSet<String>,
) -> Vec<SniperToken> {
    let mut seen = HashSet::new();
    let mut legit: Vec<SniperToken> = tokens
        .into_iter()
        .filter(legit)
        .filter(|t| seen.insert(t.address.to_ascii_lowercase()))
        .collect();
    let rise = |t: &SniperToken| t.change_24h.unwrap_or(0.0);
    legit.sort_by(|a, b| rise(b).total_cmp(&rise(a)));
    let top = n.saturating_sub(2);
    let rest = legit.split_off(top.min(legit.len()));
    let (fresh, stale): (Vec<_>, Vec<_>) = rest
        .into_iter()
        .partition(|t| !read_lately.contains(&t.pair_address));
    legit.extend(fresh.into_iter().chain(stale));
    legit.truncate(n);
    legit
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WalletPosition {
    #[serde(flatten)]
    pub token: SniperToken,
    pub buys: u32,
    pub sells: u32,
    pub bought_usd: f64,
    pub sold_usd: f64,
    pub pnl_usd: f64,
    pub roi_pct: f64,
    pub entry_price: f64,
    /// Today's price over the wallet's average entry.
    pub multiple: f64,
    pub held_pct: f64,
    pub first_buy_at: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SmartWallet {
    pub address: String,
    pub chain: String,
    pub grade: &'static str,
    pub score: f64,
    /// Tokens it made money on, and tokens it traded, among those read.
    pub wins: u32,
    pub tokens: u32,
    pub win_rate_pct: f64,
    pub pnl_usd: f64,
    pub invested_usd: f64,
    pub roi_pct: f64,
    /// Tokens where it got in at less than half of today's price.
    pub early_hits: u32,
    pub last_active: i64,
    pub positions: Vec<WalletPosition>,
}

/// A letter grade from how often and how much a wallet won.
pub fn grade(wins: u32, win_rate: f64, pnl: f64, roi: f64, early: u32) -> &'static str {
    if wins >= 2 && win_rate >= 75.0 && pnl >= 1_000.0 && early >= 1 {
        "A"
    } else if (wins >= 2 && win_rate >= 60.0 && pnl > 0.0)
        || (wins >= 1 && early >= 1 && roi >= 100.0 && pnl >= 1_000.0)
    {
        "B"
    } else if wins >= 1 && pnl > 0.0 {
        "C"
    } else {
        "D"
    }
}

fn grade_rank(g: &str) -> u8 {
    match g {
        "A" => 0,
        "B" => 1,
        "C" => 2,
        _ => 3,
    }
}

/// Grades every wallet seen across the pools. Only wallets in profit are kept.
pub fn rank_wallets(
    chain: &str,
    pools: &[(SniperToken, HashMap<String, Position>)],
) -> Vec<SmartWallet> {
    let mut by: HashMap<&str, Vec<WalletPosition>> = HashMap::new();
    for (token, wallets) in pools {
        for (wallet, p) in wallets {
            let r = p.value(token.price_usd);
            if !r.pnl_usd.is_finite() {
                continue;
            }
            by.entry(wallet.as_str()).or_default().push(WalletPosition {
                token: token.clone(),
                buys: p.buys,
                sells: p.sells,
                bought_usd: p.bought_usd,
                sold_usd: p.sold_usd,
                pnl_usd: r.pnl_usd,
                roi_pct: r.roi_pct,
                entry_price: r.entry_price,
                multiple: if r.entry_price > 0.0 {
                    token.price_usd / r.entry_price
                } else {
                    0.0
                },
                held_pct: r.held_share * 100.0,
                first_buy_at: p.first_buy_at,
            });
        }
    }
    let mut out: Vec<SmartWallet> = by
        .into_iter()
        .filter_map(|(address, mut positions)| {
            let tokens = positions.len() as u32;
            let wins = positions.iter().filter(|p| p.pnl_usd > 0.0).count() as u32;
            let early = positions
                .iter()
                .filter(|p| p.pnl_usd > 0.0 && p.multiple >= 2.0)
                .count() as u32;
            let pnl: f64 = positions.iter().map(|p| p.pnl_usd).sum();
            let invested: f64 = positions.iter().map(|p| p.bought_usd).sum();
            if pnl <= 0.0 || invested <= 0.0 {
                return None;
            }
            let win_rate = wins as f64 / tokens as f64 * 100.0;
            let roi = pnl / invested * 100.0;
            let g = grade(wins, win_rate, pnl, roi, early);
            // Wins and early entries count most, then win rate, then the size of the profit.
            let score = wins as f64 * 20.0
                + early as f64 * 15.0
                + win_rate * 0.3
                + roi.clamp(0.0, 1_000.0) * 0.02
                + (pnl.max(1.0)).log10() * 5.0;
            positions.sort_by(|a, b| b.pnl_usd.total_cmp(&a.pnl_usd));
            Some(SmartWallet {
                address: address.to_string(),
                chain: chain.to_string(),
                grade: g,
                score: (score * 10.0).round() / 10.0,
                wins,
                tokens,
                win_rate_pct: win_rate,
                pnl_usd: pnl,
                invested_usd: invested,
                roi_pct: roi,
                early_hits: early,
                last_active: positions.iter().map(|p| p.first_buy_at).max().unwrap_or(0),
                positions,
            })
        })
        .collect();
    out.sort_by(|a, b| {
        grade_rank(a.grade)
            .cmp(&grade_rank(b.grade))
            .then(b.score.total_cmp(&a.score))
    });
    out.truncate(MAX_WALLETS);
    out
}

/// One provider call, asked again once after a pause when the provider says it is busy. The
/// free GeckoTerminal allowance is shared with the sniper, so a scan often lands on a busy minute.
async fn gecko_patient(
    state: &AppState,
    path: &str,
    query: &[(&str, String)],
) -> std::result::Result<String, UpstreamError> {
    match gecko(state, path, query).await {
        Err(UpstreamError::Http { status: 429, .. }) => {
            tokio::time::sleep(BUSY_WAIT).await;
            gecko(state, path, query).await
        }
        other => other,
    }
}

async fn scan(state: &AppState, chain: &ChainInfo) -> std::result::Result<Value, UpstreamError> {
    let net = chain.gecko_network;
    let include = ("include", "base_token".to_string());
    let mut tokens = Vec::new();
    for page in 1..=2u32 {
        let path = format!("/networks/{net}/trending_pools");
        let query = [include.clone(), ("page", page.to_string())];
        let raw = if page == 1 {
            gecko_patient(state, &path, &query).await
        } else {
            gecko(state, &path, &query).await
        };
        match raw {
            Ok(raw) => tokens.extend(parse_new_pools(&raw, chain)),
            Err(e) if page == 1 => return Err(e),
            Err(_) => break,
        }
        // One page is enough when it already has the pools a scan reads.
        if tokens.iter().filter(|t| legit(t)).count() >= POOLS_PER_SCAN * 2 {
            break;
        }
    }
    let lately = state
        .smart
        .read_recently(chain.key, Duration::from_secs(1800));
    let picked = pick_pools(tokens.clone(), POOLS_PER_SCAN, &lately);
    let mut read = Vec::new();
    let mut busy = false;
    for token in picked {
        let path = format!("/networks/{net}/pools/{}/trades", token.pair_address);
        let query = [(
            "trade_volume_in_usd_greater_than",
            MIN_TRADE_USD.to_string(),
        )];
        // The first pool is worth waiting for; after that, a busy provider ends the scan.
        let raw = if read.is_empty() {
            gecko_patient(state, &path, &query).await
        } else {
            gecko(state, &path, &query).await
        };
        match raw {
            Ok(raw) => {
                let trades = parse_trades(&raw, &token.address);
                read.push((token, trades));
            }
            // The provider asked for a pause: grade on the pools read so far.
            Err(UpstreamError::Http { status: 429, .. }) => {
                tracing::warn!(
                    "smart money scan paused by the provider after {} pools",
                    read.len()
                );
                busy = true;
                break;
            }
            // One pool failing does not spoil the rest.
            Err(e) => tracing::warn!("smart money trades for {} failed: {e}", token.symbol),
        }
    }
    let merged = state.smart.merge(chain.key, read, &tokens);
    if merged.is_empty() {
        // Nothing read because the provider was busy: say so, rather than a generic failure.
        return Err(if busy {
            UpstreamError::Http {
                status: 429,
                snippet: "busy".into(),
            }
        } else {
            UpstreamError::Parse("no trending pools could be read".into())
        });
    }
    let pools: Vec<(SniperToken, HashMap<String, Position>)> = merged
        .into_iter()
        .map(|(t, trades)| {
            let p = positions(&trades);
            (t, p)
        })
        .collect();
    let wallets = rank_wallets(chain.key, &pools);
    let tokens: Vec<Value> = pools
        .iter()
        .map(|(t, w)| {
            let mut v = serde_json::to_value(t).unwrap_or(Value::Null);
            if let Some(o) = v.as_object_mut() {
                o.insert("whales".into(), json!(w.len()));
            }
            v
        })
        .collect();
    Ok(json!({
        "chain": chain.key,
        "chainName": chain.name,
        "wallets": wallets,
        "tokens": tokens,
        "minTradeUsd": MIN_TRADE_USD,
        "updatedAt": Utc::now().to_rfc3339(),
    }))
}

pub async fn smart_json(state: &Arc<AppState>, chain: &str) -> Result<Value> {
    if !CHAINS.contains(&chain) {
        return Err(AppError::BadRequest(format!(
            "smart money covers {}",
            CHAINS.join(", ")
        )));
    }
    let info = chain_info(chain).ok_or_else(|| AppError::BadRequest("unknown chain".into()))?;
    let st = state.clone();
    let mut v = state
        .smart
        .scans
        .get_or_fetch(chain, || async move { scan(&st, &info).await })
        .await
        .map_err(|e| match e {
            UpstreamError::Http { status: 429, .. } => AppError::Unavailable(
                "GeckoTerminal is busy right now, so this scan could not run. It tries again in a minute."
                    .into(),
            ),
            e => e.into(),
        })?;
    if let Some(o) = v.as_object_mut() {
        o.insert("chains".into(), json!(CHAINS));
    }
    Ok(v)
}

#[derive(Debug, Deserialize)]
pub struct SmartQuery {
    pub chain: Option<String>,
}

pub async fn get_smart(
    State(state): State<Arc<AppState>>,
    Query(q): Query<SmartQuery>,
) -> Result<Json<Value>> {
    let chain = q.chain.as_deref().unwrap_or("solana");
    Ok(Json(smart_json(&state, chain).await?))
}

#[cfg(test)]
mod tests {
    use super::*;

    const MINT: &str = "B34nXKpLmvnuVzHGqzZ5cZcU1yHW1n7ckDqJDsnvpump";

    fn trade(wallet: &str, buy: bool, usd: f64, qty: f64, at: i64) -> Trade {
        Trade {
            tx: format!("{wallet}{at}{buy}"),
            wallet: wallet.into(),
            buy,
            usd,
            qty,
            at,
        }
    }

    fn token(symbol: &str, price: f64, change: f64, liq: f64) -> SniperToken {
        SniperToken {
            id: format!("solana:{symbol}"),
            symbol: symbol.into(),
            name: symbol.into(),
            address: format!("{symbol}mint"),
            chain: "solana".into(),
            pair_address: format!("{symbol}pool"),
            dex: "raydium".into(),
            price_usd: price,
            liquidity_usd: liq,
            market_cap_usd: 1_000_000.0,
            volume_24h_usd: 500_000.0,
            change_5m: None,
            change_1h: None,
            change_24h: Some(change),
            buys_24h: 0,
            sells_24h: 0,
            created_at: None,
            url: String::new(),
            image_url: None,
        }
    }

    #[test]
    fn reads_buys_and_sells_of_the_token() {
        let raw = format!(
            r#"{{"data":[
              {{"attributes":{{"block_timestamp":"2026-11-20T10:00:00Z","tx_from_address":"WalletA","kind":"buy",
                "from_token_address":"So11111111111111111111111111111111111111112","to_token_address":"{MINT}",
                "from_token_amount":"5","to_token_amount":"1000000","volume_in_usd":"1000"}}}},
              {{"attributes":{{"block_timestamp":"2026-11-20T11:00:00Z","tx_from_address":"WalletA","kind":"sell",
                "from_token_address":"{MINT}","to_token_address":"So11111111111111111111111111111111111111112",
                "from_token_amount":"500000","to_token_amount":"10","volume_in_usd":"2000"}}}},
              {{"attributes":{{"tx_from_address":"WalletB","from_token_address":"x","to_token_address":"y",
                "from_token_amount":"1","to_token_amount":"1","volume_in_usd":"500"}}}},
              {{"attributes":{{"tx_from_address":"WalletC","from_token_address":"x","to_token_address":"{MINT}",
                "from_token_amount":"1","to_token_amount":"nope","volume_in_usd":"500"}}}}
            ]}}"#
        );
        let t = parse_trades(&raw, MINT);
        assert_eq!(t.len(), 2);
        assert!(t[0].buy && t[0].qty == 1_000_000.0 && t[0].usd == 1000.0);
        assert!(!t[1].buy && t[1].qty == 500_000.0);
        assert!(t[0].at > 0 && t[1].at > t[0].at);
        assert!(parse_trades("not json", MINT).is_empty());
    }

    #[test]
    fn values_a_position_from_entry_to_today() {
        // Bought 1m tokens for $1,000, sold half for $2,000, price is now 4x the entry.
        let p = Position {
            buys: 1,
            sells: 1,
            bought_usd: 1000.0,
            bought_qty: 1_000_000.0,
            sold_usd: 2000.0,
            sold_qty: 500_000.0,
            first_buy_at: 1,
            last_at: 2,
        };
        let r = p.value(0.004);
        assert!((r.realized_usd - 1500.0).abs() < 1e-6);
        assert!((r.unrealized_usd - 1500.0).abs() < 1e-6);
        assert!((r.roi_pct - 300.0).abs() < 1e-6);
        assert!((r.held_share - 0.5).abs() < 1e-9);
        // Selling more than was bought here only counts the covered part.
        let p = Position {
            sold_qty: 3_000_000.0,
            sold_usd: 3000.0,
            ..p
        };
        let r = p.value(0.004);
        assert!((r.realized_usd - 0.0).abs() < 1e-6);
        assert_eq!(r.held_share, 0.0);
    }

    #[test]
    fn drops_bots_small_wallets_and_sellers_only() {
        let mut trades = vec![
            trade("smart", true, 800.0, 100.0, 1_000_000),
            trade("smart", false, 1500.0, 50.0, 2_000_000),
            trade("tiny", true, 50.0, 5.0, 1_000_000),
            trade("seller", false, 5000.0, 10.0, 1_000_000),
            trade("sandwich", true, 900.0, 10.0, 3_000_100),
            trade("sandwich", false, 905.0, 10.0, 3_000_900),
        ];
        for i in 0..30 {
            trades.push(trade("bot", i % 2 == 0, 400.0, 1.0, i * 10_000));
        }
        let p = positions(&trades);
        assert_eq!(p.len(), 1, "{:?}", p.keys().collect::<Vec<_>>());
        let s = &p["smart"];
        assert_eq!((s.buys, s.sells), (1, 1));
        assert_eq!(s.first_buy_at, 1_000_000);
    }

    #[test]
    fn picks_legit_pools_that_rose_most() {
        let picked = pick_pools(
            vec![
                token("FLAT", 1.0, 2.0, 90_000.0),
                token("MOON", 1.0, 340.0, 60_000.0),
                token("RUG", 1.0, 900.0, 900.0),
                token("SOL", 150.0, 50.0, 9_000_000.0),
                token("UP", 1.0, 80.0, 40_000.0),
                token("MOON", 1.0, 340.0, 60_000.0),
                token("DOWN", 1.0, -40.0, 60_000.0),
            ],
            3,
            &HashSet::new(),
        );
        let names: Vec<_> = picked.iter().map(|t| t.symbol.as_str()).collect();
        assert_eq!(names, ["MOON", "UP", "FLAT"]);
        // A pool read lately gives its place to one that was not.
        let lately = HashSet::from(["FLATpool".to_string()]);
        let picked = pick_pools(
            vec![
                token("FLAT", 1.0, 2.0, 90_000.0),
                token("MOON", 1.0, 340.0, 60_000.0),
                token("DOWN", 1.0, -40.0, 60_000.0),
            ],
            3,
            &lately,
        );
        let names: Vec<_> = picked.iter().map(|t| t.symbol.as_str()).collect();
        assert_eq!(names, ["MOON", "DOWN", "FLAT"]);
    }

    #[test]
    fn keeps_trades_across_scans_once_each() {
        let store = SmartStore::new();
        let moon = token("MOON", 0.01, 400.0, 80_000.0);
        let a = trade("w", true, 500.0, 1.0, 1);
        let b = trade("w", true, 600.0, 1.0, 2);
        store.merge("solana", vec![(moon.clone(), vec![a.clone()])], &[]);
        let up = SniperToken {
            price_usd: 0.02,
            ..moon.clone()
        };
        let merged = store.merge("solana", vec![(moon, vec![a, b])], &[up]);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].1.len(), 2);
        assert_eq!(merged[0].0.price_usd, 0.02);
        assert!(store
            .read_recently("solana", Duration::from_secs(60))
            .contains("MOONpool"));
    }

    #[test]
    fn grades_wallets_that_won_early_above_the_rest() {
        let moon = token("MOON", 0.01, 400.0, 80_000.0);
        let up = token("UP", 2.0, 60.0, 80_000.0);
        let pos = |usd: f64, qty: f64| Position {
            buys: 1,
            bought_usd: usd,
            bought_qty: qty,
            first_buy_at: 5,
            last_at: 5,
            ..Default::default()
        };
        let pools = vec![
            (
                moon,
                HashMap::from([
                    // In at 0.002, now 0.01: 5x.
                    ("early".to_string(), pos(1000.0, 500_000.0)),
                    // In at 0.012, now 0.01: a loss.
                    ("late".to_string(), pos(1200.0, 100_000.0)),
                    ("one".to_string(), pos(500.0, 60_000.0)),
                ]),
            ),
            (
                up,
                HashMap::from([
                    ("early".to_string(), pos(1000.0, 1000.0)),
                    ("late".to_string(), pos(1000.0, 800.0)),
                ]),
            ),
        ];
        let w = rank_wallets("solana", &pools);
        let early = w.iter().find(|x| x.address == "early").unwrap();
        assert_eq!(early.grade, "A");
        assert_eq!((early.wins, early.tokens, early.early_hits), (2, 2, 2));
        assert_eq!(w[0].address, "early");
        let one = w.iter().find(|x| x.address == "one").unwrap();
        assert_eq!(one.grade, "C");
        // Late: lost on MOON, won on UP, net in profit, half its tokens won.
        let late = w.iter().find(|x| x.address == "late").unwrap();
        assert_eq!((late.wins, late.tokens), (1, 2));
        assert_eq!(late.grade, "C");
        assert_eq!(early.positions[0].token.symbol, "MOON");
        assert!((early.positions[0].multiple - 5.0).abs() < 1e-9);
    }

    #[test]
    fn grade_thresholds() {
        assert_eq!(grade(3, 100.0, 5000.0, 200.0, 2), "A");
        assert_eq!(grade(2, 66.0, 10.0, 5.0, 0), "B");
        assert_eq!(grade(1, 100.0, 2000.0, 150.0, 1), "B");
        assert_eq!(grade(1, 50.0, 10.0, 1.0, 0), "C");
        assert_eq!(grade(0, 0.0, -5.0, -1.0, 0), "D");
    }
}
