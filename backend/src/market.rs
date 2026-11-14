//! Market overview: CoinGecko global stats and top coins, Fear and Greed,
//! and two derived metrics (altseason index, market cap trend) computed from
//! the real coin data so nothing on the dashboard is invented.

use std::{
    collections::BTreeMap,
    sync::{Arc, RwLock},
    time::Duration,
};

use axum::{
    extract::{Query, State},
    Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::{error::Result, upstream::Gate, AppState};

// ── Public types (camelCase JSON for the frontend) ───────────────────────────

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GlobalStats {
    pub total_market_cap_usd: f64,
    pub market_cap_change_24h_pct: f64,
    pub total_volume_24h_usd: f64,
    pub btc_dominance: f64,
    pub eth_dominance: f64,
    pub dominance: BTreeMap<String, f64>,
    pub active_cryptocurrencies: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct FngPoint {
    pub t: i64,
    pub value: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FearGreed {
    pub value: u32,
    pub label: String,
    pub history: Vec<FngPoint>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Altseason {
    pub index: u32,
    pub outperformers: u32,
    pub total: u32,
    pub window: &'static str,
    pub basis: String,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Overview {
    pub global: Option<GlobalStats>,
    pub fear_greed: Option<FearGreed>,
    pub altseason: Option<Altseason>,
    pub market_cap_trend: Vec<f64>,
    pub updated_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Coin {
    pub id: String,
    pub symbol: String,
    pub name: String,
    pub image: Option<String>,
    pub price: f64,
    pub market_cap: f64,
    pub market_cap_rank: Option<u32>,
    pub volume_24h: f64,
    pub change_24h: Option<f64>,
    pub change_7d: Option<f64>,
    pub change_30d: Option<f64>,
    pub high_24h: Option<f64>,
    pub low_24h: Option<f64>,
    pub sparkline_7d: Vec<f64>,
}

// ── Store ────────────────────────────────────────────────────────────────────

pub struct MarketStore {
    pub overview: RwLock<Overview>,
    pub coins: RwLock<Vec<Coin>>,
    pub coins_updated_at: RwLock<Option<DateTime<Utc>>>,
    coingecko_gate: Gate,
    fng_gate: Gate,
}

impl Default for MarketStore {
    fn default() -> Self {
        Self {
            overview: RwLock::default(),
            coins: RwLock::default(),
            coins_updated_at: RwLock::default(),
            coingecko_gate: Gate::new(Duration::from_secs(60), Duration::from_secs(20)),
            fng_gate: Gate::new(Duration::from_secs(600), Duration::from_secs(60)),
        }
    }
}

impl MarketStore {
    pub fn price_of_symbol(&self, symbol: &str) -> Option<f64> {
        let sym = symbol.to_ascii_uppercase();
        let coins = self.coins.read().unwrap_or_else(|e| e.into_inner());
        coins.iter().find(|c| c.symbol == sym).map(|c| c.price)
    }
}

// ── CoinGecko wire types ─────────────────────────────────────────────────────

#[derive(Deserialize)]
struct GlobalEnvelope {
    data: GlobalData,
}

#[derive(Deserialize, Default)]
struct UsdMap {
    #[serde(default)]
    usd: f64,
}

#[derive(Deserialize)]
struct GlobalData {
    #[serde(default)]
    active_cryptocurrencies: u64,
    #[serde(default)]
    total_market_cap: UsdMap,
    #[serde(default)]
    total_volume: UsdMap,
    #[serde(default)]
    market_cap_percentage: BTreeMap<String, f64>,
    #[serde(default)]
    market_cap_change_percentage_24h_usd: f64,
}

#[derive(Deserialize)]
struct Sparkline {
    #[serde(default)]
    price: Vec<Option<f64>>,
}

#[derive(Deserialize)]
struct MarketCoin {
    id: String,
    symbol: String,
    name: String,
    image: Option<String>,
    current_price: Option<f64>,
    market_cap: Option<f64>,
    market_cap_rank: Option<u32>,
    total_volume: Option<f64>,
    high_24h: Option<f64>,
    low_24h: Option<f64>,
    price_change_percentage_24h_in_currency: Option<f64>,
    price_change_percentage_7d_in_currency: Option<f64>,
    price_change_percentage_30d_in_currency: Option<f64>,
    sparkline_in_7d: Option<Sparkline>,
}

#[derive(Deserialize)]
struct FngEnvelope {
    data: Vec<FngRow>,
}

#[derive(Deserialize)]
struct FngRow {
    value: String,
    value_classification: String,
    timestamp: String,
}

// ── Parsing and derived metrics (pure, unit tested) ──────────────────────────

pub fn parse_global(raw: &str) -> Option<GlobalStats> {
    let env: GlobalEnvelope = serde_json::from_str(raw).ok()?;
    let d = env.data;
    let mut dominance: BTreeMap<String, f64> = BTreeMap::new();
    for key in ["btc", "eth", "usdt", "bnb", "sol"] {
        if let Some(v) = d.market_cap_percentage.get(key) {
            dominance.insert(key.to_ascii_uppercase(), round2(*v));
        }
    }
    let named: f64 = dominance.values().sum();
    dominance.insert("OTHERS".to_string(), round2((100.0 - named).max(0.0)));
    Some(GlobalStats {
        total_market_cap_usd: d.total_market_cap.usd,
        market_cap_change_24h_pct: round2(d.market_cap_change_percentage_24h_usd),
        total_volume_24h_usd: d.total_volume.usd,
        btc_dominance: round2(d.market_cap_percentage.get("btc").copied().unwrap_or(0.0)),
        eth_dominance: round2(d.market_cap_percentage.get("eth").copied().unwrap_or(0.0)),
        dominance,
        active_cryptocurrencies: d.active_cryptocurrencies,
    })
}

pub fn parse_coins(raw: &str) -> Option<Vec<Coin>> {
    let rows: Vec<MarketCoin> = serde_json::from_str(raw).ok()?;
    Some(
        rows.into_iter()
            .filter_map(|c| {
                let price = c.current_price?;
                Some(Coin {
                    id: c.id,
                    symbol: c.symbol.to_ascii_uppercase(),
                    name: c.name,
                    image: c.image,
                    price,
                    market_cap: c.market_cap.unwrap_or(0.0),
                    market_cap_rank: c.market_cap_rank,
                    volume_24h: c.total_volume.unwrap_or(0.0),
                    change_24h: c.price_change_percentage_24h_in_currency,
                    change_7d: c.price_change_percentage_7d_in_currency,
                    change_30d: c.price_change_percentage_30d_in_currency,
                    high_24h: c.high_24h,
                    low_24h: c.low_24h,
                    sparkline_7d: c
                        .sparkline_in_7d
                        .map(|s| s.price.into_iter().flatten().collect())
                        .unwrap_or_default(),
                })
            })
            .collect(),
    )
}

pub fn parse_fng(raw: &str) -> Option<FearGreed> {
    let env: FngEnvelope = serde_json::from_str(raw).ok()?;
    let mut points: Vec<FngPoint> = env
        .data
        .iter()
        .filter_map(|r| {
            Some(FngPoint {
                t: r.timestamp.parse().ok()?,
                value: r.value.parse().ok()?,
            })
        })
        .collect();
    // The API returns newest first; the UI wants oldest first.
    points.sort_by_key(|p| p.t);
    let latest = env.data.first()?;
    Some(FearGreed {
        value: latest.value.parse().ok()?,
        label: latest.value_classification.clone(),
        history: points,
    })
}

fn is_stable_or_wrapped(c: &Coin) -> bool {
    const EXCLUDED: &[&str] = &[
        "USDT",
        "USDC",
        "DAI",
        "USDE",
        "FDUSD",
        "TUSD",
        "USDD",
        "PYUSD",
        "USDS",
        "USD1",
        "SUSDE",
        "SUSDS",
        "STETH",
        "WSTETH",
        "WETH",
        "WBTC",
        "WEETH",
        "CBBTC",
        "RETH",
        "WBETH",
        "BSC-USD",
        "USDT0",
        "BUIDL",
        "USDY",
        "GUSD",
        "USDG",
        "BFUSD",
        "XAUT",
        "PAXG",
        "JITOSOL",
        "METH",
        "SOLVBTC",
        "LBTC",
        "TBTC",
        "WSOL",
        "BNSOL",
        "EZETH",
        "RSETH",
        "USDTB",
        "USDF",
        "SYRUPUSDC",
        "WBNB",
        "WTRX",
    ];
    let s = c.symbol.as_str();
    EXCLUDED.contains(&s) || s.starts_with("USD") || s.ends_with("USD")
}

/// Share of the top 50 non stable coins that beat Bitcoin over the last 30 days.
pub fn compute_altseason(coins: &[Coin]) -> Option<Altseason> {
    let btc = coins.iter().find(|c| c.id == "bitcoin")?.change_30d?;
    let mut total = 0u32;
    let mut outperformers = 0u32;
    for c in coins
        .iter()
        .filter(|c| c.id != "bitcoin" && !is_stable_or_wrapped(c))
    {
        if total >= 50 {
            break;
        }
        if let Some(ch) = c.change_30d {
            total += 1;
            if ch > btc {
                outperformers += 1;
            }
        }
    }
    if total < 10 {
        return None;
    }
    let index = ((outperformers as f64 / total as f64) * 100.0).round() as u32;
    Some(Altseason {
        index,
        outperformers,
        total,
        window: "30d",
        basis: format!("{outperformers} of the top {total} coins beat Bitcoin over 30 days"),
    })
}

/// Market cap of the ten largest coins over the last seven days, built from
/// hourly price sparklines and circulating supply implied by current cap and price.
pub fn compute_market_cap_trend(coins: &[Coin]) -> Vec<f64> {
    let top: Vec<&Coin> = coins
        .iter()
        .filter(|c| c.sparkline_7d.len() >= 24 && c.price > 0.0 && c.market_cap > 0.0)
        .take(10)
        .collect();
    if top.is_empty() {
        return Vec::new();
    }
    let n = top.iter().map(|c| c.sparkline_7d.len()).min().unwrap_or(0);
    let mut series = vec![0.0f64; n];
    for c in &top {
        let supply = c.market_cap / c.price;
        let offset = c.sparkline_7d.len() - n;
        for (i, slot) in series.iter_mut().enumerate() {
            *slot += c.sparkline_7d[offset + i] * supply;
        }
    }
    let step = (n as f64 / 56.0).ceil().max(1.0) as usize;
    let mut out: Vec<f64> = series.iter().step_by(step).copied().collect();
    if let Some(last) = series.last() {
        if out.last() != Some(last) {
            out.push(*last);
        }
    }
    out
}

fn round2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}

// ── Pollers ──────────────────────────────────────────────────────────────────

fn cg_headers(state: &AppState) -> Vec<(&'static str, String)> {
    match &state.config.coingecko_api_key {
        Some(k) => vec![("x-cg-demo-api-key", k.clone())],
        None => vec![],
    }
}

async fn refresh_coingecko(state: &Arc<AppState>) -> bool {
    let key = cg_headers(state);
    let headers: Vec<(&str, &str)> = key.iter().map(|(k, v)| (*k, v.as_str())).collect();
    let base = &state.config.coingecko_base;

    let global_url = format!("{base}/global");
    let coins_url = format!("{base}/coins/markets");
    let query = [
        ("vs_currency", "usd".to_string()),
        ("order", "market_cap_desc".to_string()),
        ("per_page", "100".to_string()),
        ("page", "1".to_string()),
        ("sparkline", "true".to_string()),
        ("price_change_percentage", "24h,7d,30d".to_string()),
    ];
    // Both calls run together so a cold start waits for one round trip, not two.
    let (global, coins) = tokio::join!(
        state
            .up
            .get_json_with::<serde_json::Value>("coingecko", &global_url, &[], &headers),
        state
            .up
            .get_json_with::<serde_json::Value>("coingecko", &coins_url, &query, &headers),
    );
    let mut ok = true;

    match global {
        Ok(v) => {
            if let Some(g) = parse_global(&v.to_string()) {
                let mut ov = state
                    .market
                    .overview
                    .write()
                    .unwrap_or_else(|e| e.into_inner());
                ov.global = Some(g);
                ov.updated_at = Some(Utc::now());
            }
        }
        Err(e) => {
            tracing::warn!("coingecko global failed: {e}");
            ok = false;
        }
    }

    match coins {
        Ok(v) => {
            if let Some(coins) = parse_coins(&v.to_string()) {
                let alt = compute_altseason(&coins);
                let trend = compute_market_cap_trend(&coins);
                {
                    let mut ov = state
                        .market
                        .overview
                        .write()
                        .unwrap_or_else(|e| e.into_inner());
                    ov.altseason = alt;
                    ov.market_cap_trend = trend;
                    ov.updated_at = Some(Utc::now());
                }
                *state
                    .market
                    .coins
                    .write()
                    .unwrap_or_else(|e| e.into_inner()) = coins;
                *state
                    .market
                    .coins_updated_at
                    .write()
                    .unwrap_or_else(|e| e.into_inner()) = Some(Utc::now());
            }
        }
        Err(e) => {
            tracing::warn!("coingecko markets failed: {e}");
            ok = false;
        }
    }
    ok
}

async fn refresh_fng(state: &Arc<AppState>) -> bool {
    let url = format!("{}?limit=30", state.config.fng_url);
    match state
        .up
        .get_json::<serde_json::Value>("fear-greed", &url)
        .await
    {
        Ok(v) => {
            if let Some(f) = parse_fng(&v.to_string()) {
                let mut ov = state
                    .market
                    .overview
                    .write()
                    .unwrap_or_else(|e| e.into_inner());
                ov.fear_greed = Some(f);
                ov.updated_at = Some(Utc::now());
            }
            true
        }
        Err(e) => {
            tracing::warn!("fear and greed failed: {e}");
            false
        }
    }
}

/// On demand mode: refreshes market data that is due. A no op when pollers run.
pub async fn ensure_fresh(state: &Arc<AppState>) {
    if !state.config.on_demand {
        return;
    }
    tokio::join!(
        state
            .market
            .coingecko_gate
            .ensure(|| refresh_coingecko(state)),
        state.market.fng_gate.ensure(|| refresh_fng(state)),
    );
}

pub fn spawn_pollers(state: Arc<AppState>) {
    let s = state.clone();
    tokio::spawn(async move {
        // CoinGecko's free tier allows roughly 30 calls a minute; two calls a minute is polite.
        let mut wait = Duration::from_secs(60);
        loop {
            let ok = refresh_coingecko(&s).await;
            wait = if ok {
                Duration::from_secs(60)
            } else {
                (wait * 2).min(Duration::from_secs(300))
            };
            tokio::time::sleep(wait).await;
        }
    });
    let s = state;
    tokio::spawn(async move {
        loop {
            refresh_fng(&s).await;
            tokio::time::sleep(Duration::from_secs(300)).await;
        }
    });
}

// ── HTTP handlers ────────────────────────────────────────────────────────────

pub async fn get_overview(State(state): State<Arc<AppState>>) -> Json<Overview> {
    ensure_fresh(&state).await;
    Json(
        state
            .market
            .overview
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone(),
    )
}

#[derive(Deserialize)]
pub struct CoinsQuery {
    limit: Option<usize>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoinsResponse {
    coins: Vec<Coin>,
    updated_at: Option<DateTime<Utc>>,
}

pub async fn get_coins(
    State(state): State<Arc<AppState>>,
    Query(q): Query<CoinsQuery>,
) -> Result<Json<CoinsResponse>> {
    let limit = q.limit.unwrap_or(100).clamp(1, 100);
    ensure_fresh(&state).await;
    let coins: Vec<Coin> = state
        .market
        .coins
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .iter()
        .take(limit)
        .cloned()
        .collect();
    let updated_at = *state
        .market
        .coins_updated_at
        .read()
        .unwrap_or_else(|e| e.into_inner());
    Ok(Json(CoinsResponse { coins, updated_at }))
}

#[cfg(test)]
mod tests {
    use super::*;

    const GLOBAL: &str = r#"{"data":{"active_cryptocurrencies":17500,"total_market_cap":{"usd":3250000000000.0},
        "total_volume":{"usd":118000000000.0},
        "market_cap_percentage":{"btc":58.4,"eth":12.1,"usdt":4.9,"bnb":3.2,"sol":2.8,"xrp":2.5},
        "market_cap_change_percentage_24h_usd":-1.234}}"#;

    #[test]
    fn global_dominance_adds_up_to_one_hundred() {
        let g = parse_global(GLOBAL).unwrap();
        assert_eq!(g.btc_dominance, 58.4);
        assert_eq!(g.market_cap_change_24h_pct, -1.23);
        let sum: f64 = g.dominance.values().sum();
        assert!((sum - 100.0).abs() < 0.05, "sum was {sum}");
        assert_eq!(
            g.dominance["OTHERS"],
            round2(100.0 - (58.4 + 12.1 + 4.9 + 3.2 + 2.8))
        );
    }

    fn coin(id: &str, sym: &str, ch30: Option<f64>) -> Coin {
        Coin {
            id: id.into(),
            symbol: sym.into(),
            price: 1.0,
            market_cap: 1.0,
            change_30d: ch30,
            ..Default::default()
        }
    }

    #[test]
    fn altseason_counts_only_real_altcoins() {
        let mut coins = vec![
            coin("bitcoin", "BTC", Some(5.0)),
            coin("tether", "USDT", Some(0.0)),
        ];
        for i in 0..20 {
            // Half of them beat BTC (10 > 5), half do not (1 < 5).
            coins.push(coin(
                &format!("a{i}"),
                &format!("A{i}"),
                Some(if i % 2 == 0 { 10.0 } else { 1.0 }),
            ));
        }
        let a = compute_altseason(&coins).unwrap();
        assert_eq!(a.total, 20, "stablecoins and BTC are excluded");
        assert_eq!(a.outperformers, 10);
        assert_eq!(a.index, 50);
    }

    #[test]
    fn altseason_needs_enough_data() {
        let coins = vec![coin("bitcoin", "BTC", Some(5.0)), coin("a", "A", Some(9.0))];
        assert!(compute_altseason(&coins).is_none());
    }

    #[test]
    fn fng_is_sorted_oldest_first() {
        let raw = r#"{"data":[{"value":"72","value_classification":"Greed","timestamp":"300"},
            {"value":"60","value_classification":"Greed","timestamp":"200"},
            {"value":"41","value_classification":"Fear","timestamp":"100"}]}"#;
        let f = parse_fng(raw).unwrap();
        assert_eq!(f.value, 72);
        assert_eq!(f.label, "Greed");
        assert_eq!(
            f.history.iter().map(|p| p.t).collect::<Vec<_>>(),
            vec![100, 200, 300]
        );
    }

    #[test]
    fn markets_parse_tolerates_nulls() {
        let raw = r#"[{"id":"bitcoin","symbol":"btc","name":"Bitcoin","image":"x","current_price":65000.5,
            "market_cap":1280000000000,"market_cap_rank":1,"total_volume":30000000000,"high_24h":66000,"low_24h":64000,
            "price_change_percentage_24h_in_currency":1.5,"price_change_percentage_7d_in_currency":null,
            "price_change_percentage_30d_in_currency":4.0,"sparkline_in_7d":{"price":[1.0,null,2.0]}},
            {"id":"broken","symbol":"x","name":"Broken","current_price":null}]"#;
        let coins = parse_coins(raw).unwrap();
        assert_eq!(coins.len(), 1, "coins without a price are skipped");
        assert_eq!(coins[0].symbol, "BTC");
        assert_eq!(coins[0].change_7d, None);
        assert_eq!(coins[0].sparkline_7d, vec![1.0, 2.0]);
    }

    #[test]
    fn market_cap_trend_weights_by_supply() {
        // Two coins with flat prices: trend must equal the sum of their market caps.
        let mk = |id: &str, price: f64, cap: f64| Coin {
            id: id.into(),
            symbol: id.to_uppercase(),
            price,
            market_cap: cap,
            sparkline_7d: vec![price; 168],
            ..Default::default()
        };
        let coins = vec![mk("a", 2.0, 200.0), mk("b", 10.0, 1000.0)];
        let trend = compute_market_cap_trend(&coins);
        assert!(!trend.is_empty() && trend.len() <= 60);
        for v in trend {
            assert!((v - 1200.0).abs() < 1e-6);
        }
    }
}
