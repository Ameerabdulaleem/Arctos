//! Exchange data: a live 24h ticker stream (WebSocket with REST fallback),
//! and cached candles, order book and recent trades for the trading terminal.

use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, RwLock},
    time::Duration,
};

use axum::{
    extract::{Query, State},
    Json,
};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::broadcast;
use tokio_tungstenite::{connect_async, tungstenite::Message as WsMsg};

use crate::{
    error::{AppError, Result},
    upstream::{Gate, KeyedCache, UpstreamError},
    AppState,
};

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Ticker {
    pub symbol: String,
    pub base: String,
    pub price: f64,
    pub open_24h: f64,
    pub high_24h: f64,
    pub low_24h: f64,
    pub change_24h_pct: f64,
    pub volume_base: f64,
    pub volume_quote: f64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Candle {
    pub t: i64,
    pub o: f64,
    pub h: f64,
    pub l: f64,
    pub c: f64,
    pub v: f64,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct Depth {
    pub bids: Vec<[f64; 2]>,
    pub asks: Vec<[f64; 2]>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TradePrint {
    pub id: u64,
    pub price: f64,
    pub qty: f64,
    pub time: i64,
    /// "buy" when the aggressor bought, "sell" when the aggressor sold.
    pub side: &'static str,
}

pub struct BinanceStore {
    pub tickers: RwLock<HashMap<String, Ticker>>,
    pub tickers_source: RwLock<&'static str>,
    pub tx: broadcast::Sender<String>,
    tickers_gate: Gate,
    klines: KeyedCache<Vec<Candle>>,
    depth: KeyedCache<Depth>,
    trades: KeyedCache<Vec<TradePrint>>,
}

impl BinanceStore {
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(64);
        Self {
            tickers: RwLock::new(HashMap::new()),
            tickers_source: RwLock::new("starting"),
            tx,
            tickers_gate: Gate::new(Duration::from_secs(2), Duration::from_secs(1)),
            klines: KeyedCache::new(Duration::from_millis(900), Duration::from_secs(30)),
            depth: KeyedCache::new(Duration::from_millis(600), Duration::from_secs(10)),
            trades: KeyedCache::new(Duration::from_millis(600), Duration::from_secs(10)),
        }
    }

    pub fn price(&self, symbol_usdt: &str) -> Option<f64> {
        self.tickers
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .get(symbol_usdt)
            .map(|t| t.price)
    }
}

impl Default for BinanceStore {
    fn default() -> Self {
        Self::new()
    }
}

// ── Parsing (pure, unit tested) ──────────────────────────────────────────────

fn f(v: &Value) -> Option<f64> {
    match v {
        Value::String(s) => s.parse().ok(),
        Value::Number(n) => n.as_f64(),
        _ => None,
    }
}

/// Parses a `!miniTicker@arr` frame (either the raw array or a combined stream envelope).
pub fn parse_mini_tickers(raw: &str, wanted: &HashSet<String>, now_ms: i64) -> Vec<Ticker> {
    let Ok(v) = serde_json::from_str::<Value>(raw) else {
        return vec![];
    };
    let arr = match &v {
        Value::Array(a) => a.clone(),
        Value::Object(o) => o
            .get("data")
            .and_then(|d| d.as_array())
            .cloned()
            .unwrap_or_default(),
        _ => vec![],
    };
    arr.iter()
        .filter_map(|item| {
            let symbol = item.get("s")?.as_str()?;
            if !wanted.contains(symbol) {
                return None;
            }
            let price = f(item.get("c")?)?;
            let open = f(item.get("o")?)?;
            Some(Ticker {
                symbol: symbol.to_string(),
                base: symbol.trim_end_matches("USDT").to_string(),
                price,
                open_24h: open,
                high_24h: f(item.get("h")?)?,
                low_24h: f(item.get("l")?)?,
                change_24h_pct: if open > 0.0 {
                    (price - open) / open * 100.0
                } else {
                    0.0
                },
                volume_base: f(item.get("v")?)?,
                volume_quote: f(item.get("q")?)?,
                updated_at: item.get("E").and_then(|e| e.as_i64()).unwrap_or(now_ms),
            })
        })
        .collect()
}

/// Parses the REST `/api/v3/ticker/24hr` response.
pub fn parse_rest_tickers(raw: &str, now_ms: i64) -> Vec<Ticker> {
    let Ok(Value::Array(arr)) = serde_json::from_str::<Value>(raw) else {
        return vec![];
    };
    arr.iter()
        .filter_map(|item| {
            let symbol = item.get("symbol")?.as_str()?;
            Some(Ticker {
                symbol: symbol.to_string(),
                base: symbol.trim_end_matches("USDT").to_string(),
                price: f(item.get("lastPrice")?)?,
                open_24h: f(item.get("openPrice")?)?,
                high_24h: f(item.get("highPrice")?)?,
                low_24h: f(item.get("lowPrice")?)?,
                change_24h_pct: f(item.get("priceChangePercent")?)?,
                volume_base: f(item.get("volume")?)?,
                volume_quote: f(item.get("quoteVolume")?)?,
                updated_at: now_ms,
            })
        })
        .collect()
}

/// Builds tickers from the market list (CoinGecko) for the tracked symbols.
/// Used only when the exchange cannot be reached, so prices still show.
pub fn tickers_from_coins(
    coins: &[crate::market::Coin],
    tracked: &[String],
    now_ms: i64,
) -> Vec<Ticker> {
    tracked
        .iter()
        .filter_map(|base| {
            let coin = coins.iter().find(|c| &c.symbol == base)?;
            if !(coin.price.is_finite() && coin.price > 0.0) {
                return None;
            }
            let change = coin.change_24h.unwrap_or(0.0);
            let open = if change > -100.0 {
                coin.price / (1.0 + change / 100.0)
            } else {
                coin.price
            };
            Some(Ticker {
                symbol: format!("{base}USDT"),
                base: base.clone(),
                price: coin.price,
                open_24h: open,
                high_24h: coin.high_24h.unwrap_or(coin.price.max(open)),
                low_24h: coin.low_24h.unwrap_or(coin.price.min(open)),
                change_24h_pct: change,
                volume_base: coin.volume_24h / coin.price,
                volume_quote: coin.volume_24h,
                updated_at: now_ms,
            })
        })
        .collect()
}

pub fn parse_klines(raw: &str) -> Option<Vec<Candle>> {
    let rows: Vec<Vec<Value>> = serde_json::from_str(raw).ok()?;
    rows.iter()
        .map(|r| {
            Some(Candle {
                t: r.first()?.as_i64()? / 1000,
                o: f(r.get(1)?)?,
                h: f(r.get(2)?)?,
                l: f(r.get(3)?)?,
                c: f(r.get(4)?)?,
                v: f(r.get(5)?)?,
            })
        })
        .collect()
}

pub fn parse_depth(raw: &str) -> Option<Depth> {
    let v: Value = serde_json::from_str(raw).ok()?;
    let side = |key: &str| -> Option<Vec<[f64; 2]>> {
        v.get(key)?
            .as_array()?
            .iter()
            .map(|lvl| Some([f(lvl.get(0)?)?, f(lvl.get(1)?)?]))
            .collect()
    };
    Some(Depth {
        bids: side("bids")?,
        asks: side("asks")?,
    })
}

pub fn parse_trades(raw: &str) -> Option<Vec<TradePrint>> {
    let v: Value = serde_json::from_str(raw).ok()?;
    let mut out: Vec<TradePrint> = v
        .as_array()?
        .iter()
        .filter_map(|t| {
            Some(TradePrint {
                id: t.get("id")?.as_u64()?,
                price: f(t.get("price")?)?,
                qty: f(t.get("qty")?)?,
                time: t.get("time")?.as_i64()?,
                // isBuyerMaker=true means the buyer was resting, so the aggressor sold.
                side: if t.get("isBuyerMaker")?.as_bool()? {
                    "sell"
                } else {
                    "buy"
                },
            })
        })
        .collect();
    out.reverse(); // newest first
    Some(out)
}

pub fn valid_symbol(s: &str) -> bool {
    (5..=15).contains(&s.len())
        && s.ends_with("USDT")
        && s.bytes()
            .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit())
}

pub fn valid_interval(s: &str) -> bool {
    matches!(s, "1m" | "5m" | "15m" | "1h" | "4h" | "1d")
}

// ── Upstream access ──────────────────────────────────────────────────────────

async fn binance_get_text(
    state: &AppState,
    path: &str,
    query: &[(&str, String)],
) -> std::result::Result<String, UpstreamError> {
    let mut last = UpstreamError::Network("no exchange endpoint configured".into());
    for base in &state.config.binance_rest_bases {
        let url = format!("{}{}", base.trim_end_matches('/'), path);
        match state
            .up
            .get_json_with::<Value>("binance", &url, query, &[])
            .await
        {
            Ok(v) => return Ok(v.to_string()),
            Err(e) => last = e,
        }
    }
    Err(last)
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn tracked_set(state: &AppState) -> HashSet<String> {
    state
        .config
        .tracked_symbols
        .iter()
        .map(|s| format!("{s}USDT"))
        .collect()
}

fn publish(state: &AppState, source: &'static str) {
    let tickers = state
        .binance
        .tickers
        .read()
        .unwrap_or_else(|e| e.into_inner());
    let data: Vec<&Ticker> = state
        .config
        .tracked_symbols
        .iter()
        .filter_map(|s| tickers.get(&format!("{s}USDT")))
        .collect();
    let msg = serde_json::json!({ "type": "tickers", "source": source, "data": data }).to_string();
    drop(tickers);
    *state
        .binance
        .tickers_source
        .write()
        .unwrap_or_else(|e| e.into_inner()) = source;
    let _ = state.binance.tx.send(msg);
}

async fn refresh_tickers_rest(state: &Arc<AppState>) -> bool {
    let symbols: Vec<String> = state
        .config
        .tracked_symbols
        .iter()
        .map(|s| format!("{s}USDT"))
        .collect();
    let query = [(
        "symbols",
        serde_json::to_string(&symbols).unwrap_or_default(),
    )];
    match binance_get_text(state, "/api/v3/ticker/24hr", &query).await {
        Ok(raw) => {
            let parsed = parse_rest_tickers(&raw, now_ms());
            if parsed.is_empty() {
                return false;
            }
            {
                let mut map = state
                    .binance
                    .tickers
                    .write()
                    .unwrap_or_else(|e| e.into_inner());
                for t in parsed {
                    map.insert(t.symbol.clone(), t);
                }
            }
            publish(state, "rest");
            true
        }
        Err(e) => {
            tracing::warn!("ticker REST refresh failed: {e}");
            refresh_tickers_from_market(state).await
        }
    }
}

/// Last resort when the exchange is unreachable (for example a regional
/// block): prices from the market list. They move every minute instead of
/// every second, and the source is reported so the app can say so.
async fn refresh_tickers_from_market(state: &Arc<AppState>) -> bool {
    crate::market::ensure_fresh(state).await;
    let parsed = {
        let coins = state.market.coins.read().unwrap_or_else(|e| e.into_inner());
        tickers_from_coins(&coins, &state.config.tracked_symbols, now_ms())
    };
    if parsed.is_empty() {
        return false;
    }
    {
        let mut map = state
            .binance
            .tickers
            .write()
            .unwrap_or_else(|e| e.into_inner());
        for t in parsed {
            map.insert(t.symbol.clone(), t);
        }
    }
    publish(state, "market-list");
    true
}

async fn run_ticker_stream(state: &Arc<AppState>) -> std::result::Result<(), String> {
    let wanted = tracked_set(state);
    let (mut ws, _) = connect_async(state.config.binance_ws_url.as_str())
        .await
        .map_err(|e| e.to_string())?;
    state.up.note("binance-stream", Ok(()));
    loop {
        let next = tokio::time::timeout(Duration::from_secs(30), ws.next())
            .await
            .map_err(|_| "no data for 30s".to_string())?;
        let Some(msg) = next else {
            return Err("stream closed".into());
        };
        match msg.map_err(|e| e.to_string())? {
            WsMsg::Text(text) => {
                let parsed = parse_mini_tickers(&text, &wanted, now_ms());
                if !parsed.is_empty() {
                    {
                        let mut map = state
                            .binance
                            .tickers
                            .write()
                            .unwrap_or_else(|e| e.into_inner());
                        for t in parsed {
                            map.insert(t.symbol.clone(), t);
                        }
                    }
                    publish(state, "stream");
                }
            }
            WsMsg::Close(_) => return Err("closed by peer".into()),
            _ => {}
        }
    }
}

/// On demand mode: refreshes exchange prices that are due. A no op when the stream runs.
pub async fn ensure_tickers(state: &Arc<AppState>) {
    if !state.config.on_demand {
        return;
    }
    state
        .binance
        .tickers_gate
        .ensure(|| refresh_tickers_rest(state))
        .await;
}

pub fn spawn_pollers(state: Arc<AppState>) {
    tokio::spawn(async move {
        refresh_tickers_rest(&state).await;
        let mut backoff = Duration::from_secs(2);
        loop {
            match run_ticker_stream(&state).await {
                Ok(()) => backoff = Duration::from_secs(2),
                Err(e) => {
                    tracing::warn!("ticker stream ended: {e}");
                    state.up.note("binance-stream", Err(e));
                    // Keep prices fresh over REST while the stream is down.
                    for _ in 0..4 {
                        refresh_tickers_rest(&state).await;
                        tokio::time::sleep(Duration::from_secs(3)).await;
                    }
                    backoff = (backoff * 2).min(Duration::from_secs(30));
                }
            }
            tokio::time::sleep(backoff).await;
        }
    });
}

// ── HTTP handlers ────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TickersResponse {
    tickers: Vec<Ticker>,
    source: &'static str,
}

pub async fn get_tickers(State(state): State<Arc<AppState>>) -> Result<Json<TickersResponse>> {
    ensure_tickers(&state).await;
    let empty = state
        .binance
        .tickers
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .is_empty();
    if empty {
        refresh_tickers_rest(&state).await;
    }
    let tickers = state
        .binance
        .tickers
        .read()
        .unwrap_or_else(|e| e.into_inner());
    let list: Vec<Ticker> = state
        .config
        .tracked_symbols
        .iter()
        .filter_map(|s| tickers.get(&format!("{s}USDT")).cloned())
        .collect();
    if list.is_empty() {
        return Err(AppError::Upstream("exchange tickers unavailable".into()));
    }
    let source = *state
        .binance
        .tickers_source
        .read()
        .unwrap_or_else(|e| e.into_inner());
    Ok(Json(TickersResponse {
        tickers: list,
        source,
    }))
}

#[derive(Deserialize)]
pub struct KlinesQuery {
    symbol: String,
    interval: Option<String>,
    limit: Option<u32>,
}

pub async fn get_klines(
    State(state): State<Arc<AppState>>,
    Query(q): Query<KlinesQuery>,
) -> Result<Json<Vec<Candle>>> {
    let symbol = q.symbol.to_ascii_uppercase();
    let interval = q.interval.unwrap_or_else(|| "15m".into());
    if !valid_symbol(&symbol) || !valid_interval(&interval) {
        return Err(AppError::BadRequest("invalid symbol or interval".into()));
    }
    let limit = q.limit.unwrap_or(300).clamp(2, 1000);
    let key = format!("{symbol}:{interval}:{limit}");
    let st = state.clone();
    let candles = state
        .binance
        .klines
        .get_or_fetch(&key, || async move {
            let query = [
                ("symbol", symbol),
                ("interval", interval),
                ("limit", limit.to_string()),
            ];
            let raw = binance_get_text(&st, "/api/v3/klines", &query).await?;
            parse_klines(&raw).ok_or_else(|| UpstreamError::Parse("klines".into()))
        })
        .await?;
    Ok(Json(candles))
}

#[derive(Deserialize)]
pub struct DepthQuery {
    symbol: String,
    limit: Option<u32>,
}

pub async fn get_depth(
    State(state): State<Arc<AppState>>,
    Query(q): Query<DepthQuery>,
) -> Result<Json<Depth>> {
    let symbol = q.symbol.to_ascii_uppercase();
    if !valid_symbol(&symbol) {
        return Err(AppError::BadRequest("invalid symbol".into()));
    }
    let limit = match q.limit.unwrap_or(20) {
        0..=5 => 5,
        6..=10 => 10,
        _ => 20,
    };
    let key = format!("{symbol}:{limit}");
    let st = state.clone();
    let depth = state
        .binance
        .depth
        .get_or_fetch(&key, || async move {
            let query = [("symbol", symbol), ("limit", limit.to_string())];
            let raw = binance_get_text(&st, "/api/v3/depth", &query).await?;
            parse_depth(&raw).ok_or_else(|| UpstreamError::Parse("depth".into()))
        })
        .await?;
    Ok(Json(depth))
}

#[derive(Deserialize)]
pub struct TradesQuery {
    symbol: String,
    limit: Option<u32>,
}

pub async fn get_trades(
    State(state): State<Arc<AppState>>,
    Query(q): Query<TradesQuery>,
) -> Result<Json<Vec<TradePrint>>> {
    let symbol = q.symbol.to_ascii_uppercase();
    if !valid_symbol(&symbol) {
        return Err(AppError::BadRequest("invalid symbol".into()));
    }
    let limit = q.limit.unwrap_or(30).clamp(1, 100);
    let key = format!("{symbol}:{limit}");
    let st = state.clone();
    let trades = state
        .binance
        .trades
        .get_or_fetch(&key, || async move {
            let query = [("symbol", symbol), ("limit", limit.to_string())];
            let raw = binance_get_text(&st, "/api/v3/trades", &query).await?;
            parse_trades(&raw).ok_or_else(|| UpstreamError::Parse("trades".into()))
        })
        .await?;
    Ok(Json(trades))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wanted() -> HashSet<String> {
        ["BTCUSDT", "ETHUSDT"]
            .iter()
            .map(|s| s.to_string())
            .collect()
    }

    #[test]
    fn mini_ticker_array_filters_and_computes_change() {
        let raw = r#"[{"e":"24hrMiniTicker","E":1700000000000,"s":"BTCUSDT","c":"110.00","o":"100.00","h":"120.0","l":"90.0","v":"5","q":"550"},
                      {"e":"24hrMiniTicker","E":1700000000000,"s":"XYZUSDT","c":"1","o":"1","h":"1","l":"1","v":"1","q":"1"}]"#;
        let t = parse_mini_tickers(raw, &wanted(), 1);
        assert_eq!(t.len(), 1);
        assert_eq!(t[0].symbol, "BTCUSDT");
        assert_eq!(t[0].base, "BTC");
        assert!((t[0].change_24h_pct - 10.0).abs() < 1e-9);
        assert_eq!(t[0].updated_at, 1_700_000_000_000);
    }

    #[test]
    fn mini_ticker_accepts_combined_stream_envelope() {
        let raw = r#"{"stream":"!miniTicker@arr","data":[{"s":"ETHUSDT","c":"2","o":"4","h":"5","l":"1","v":"1","q":"2"}]}"#;
        let t = parse_mini_tickers(raw, &wanted(), 5);
        assert_eq!(t.len(), 1);
        assert!((t[0].change_24h_pct + 50.0).abs() < 1e-9);
        assert_eq!(t[0].updated_at, 5);
    }

    #[test]
    fn garbage_frames_are_ignored() {
        assert!(parse_mini_tickers("not json", &wanted(), 0).is_empty());
        assert!(parse_mini_tickers("{}", &wanted(), 0).is_empty());
    }

    #[test]
    fn rest_tickers_parse() {
        let raw = r#"[{"symbol":"BTCUSDT","lastPrice":"65000.1","openPrice":"64000","highPrice":"66000","lowPrice":"63000",
            "priceChangePercent":"1.56","volume":"1000","quoteVolume":"65000000"}]"#;
        let t = parse_rest_tickers(raw, 9);
        assert_eq!(t[0].price, 65000.1);
        assert_eq!(t[0].change_24h_pct, 1.56);
    }

    #[test]
    fn klines_convert_ms_to_seconds() {
        let raw = r#"[[1700000000000,"1.0","2.0","0.5","1.5","10.0",1700000059999,"15.0",3,"1","1","0"]]"#;
        let c = parse_klines(raw).unwrap();
        assert_eq!(
            c,
            vec![Candle {
                t: 1_700_000_000,
                o: 1.0,
                h: 2.0,
                l: 0.5,
                c: 1.5,
                v: 10.0
            }]
        );
        assert!(
            parse_klines("[[1]]").is_none(),
            "short rows are rejected rather than half parsed"
        );
    }

    #[test]
    fn depth_and_trades_parse() {
        let d = parse_depth(
            r#"{"lastUpdateId":1,"bids":[["99.5","2"],["99.0","1"]],"asks":[["100.5","3"]]}"#,
        )
        .unwrap();
        assert_eq!(d.bids[0], [99.5, 2.0]);
        assert_eq!(d.asks[0], [100.5, 3.0]);

        let t = parse_trades(
            r#"[{"id":1,"price":"10","qty":"1","time":1,"isBuyerMaker":true},
                {"id":2,"price":"11","qty":"2","time":2,"isBuyerMaker":false}]"#,
        )
        .unwrap();
        assert_eq!(t[0].id, 2, "newest first");
        assert_eq!(t[0].side, "buy");
        assert_eq!(t[1].side, "sell");
    }

    #[test]
    fn fallback_tickers_come_from_the_market_list() {
        let coins = vec![
            crate::market::Coin {
                symbol: "BTC".into(),
                price: 110.0,
                change_24h: Some(10.0),
                volume_24h: 2200.0,
                high_24h: Some(120.0),
                low_24h: Some(95.0),
                ..Default::default()
            },
            crate::market::Coin {
                symbol: "ETH".into(),
                price: 0.0,
                ..Default::default()
            },
        ];
        let tracked = vec!["BTC".to_string(), "ETH".to_string(), "SOL".to_string()];
        let t = tickers_from_coins(&coins, &tracked, 5);
        assert_eq!(t.len(), 1, "coins without a usable price are skipped");
        assert_eq!(t[0].symbol, "BTCUSDT");
        assert!((t[0].open_24h - 100.0).abs() < 1e-9);
        assert_eq!(t[0].high_24h, 120.0);
        assert_eq!(t[0].volume_base, 20.0);
        assert_eq!(t[0].updated_at, 5);
    }

    #[test]
    fn input_validation() {
        assert!(valid_symbol("BTCUSDT"));
        assert!(!valid_symbol("btcusdt"));
        assert!(!valid_symbol("BTC/USDT"));
        assert!(!valid_symbol("BTCUSDT&x=1"));
        assert!(!valid_symbol("USDT"));
        assert!(valid_interval("15m"));
        assert!(!valid_interval("2m"));
    }
}
