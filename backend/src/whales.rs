//! Whale tracker built on real chain data.
//!
//! * EVM chains (Ethereum, BNB Chain, Base, Arbitrum): native transfers read from
//!   blocks (Ethereum and BNB Chain) plus ERC 20 `Transfer` logs for stablecoins,
//!   wrapped ETH, BNB and BTC, via public JSON-RPC.
//! * Bitcoin: large transactions from the Blockchair public API.
//!
//! Direction labels ("exchange inflow" / "exchange outflow") are only assigned
//! when one side is in a small built in list of well known exchange wallets.
//! Everything else is reported honestly as a plain transfer.

use std::{
    collections::{HashMap, HashSet, VecDeque},
    sync::{Arc, Mutex, RwLock},
    time::Duration,
};

use axum::{
    extract::{Query, State},
    Json,
};
use chrono::{DateTime, NaiveDateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::broadcast;

use crate::{error::Result, upstream::Gate, AppState};

const TRANSFER_TOPIC: &str = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const MAX_EVENTS: usize = 1000;

// ── Types ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WhaleEvent {
    pub id: String,
    pub chain: String,
    pub chain_name: String,
    pub asset: String,
    pub amount: f64,
    pub value_usd: f64,
    pub from: Option<String>,
    pub to: Option<String>,
    pub from_label: Option<String>,
    pub to_label: Option<String>,
    /// "transfer", "exchange_inflow" or "exchange_outflow"
    pub kind: &'static str,
    pub tx_hash: String,
    pub block: Option<u64>,
    /// Unix milliseconds
    pub timestamp: i64,
    pub explorer_url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChainStatus {
    pub chain: String,
    pub name: String,
    pub supported: bool,
    pub ok: bool,
    pub last_block: Option<u64>,
    pub last_poll: Option<DateTime<Utc>>,
    pub note: String,
}

pub struct WhaleStore {
    events: RwLock<VecDeque<WhaleEvent>>,
    seen: Mutex<HashSet<String>>,
    pub status: RwLock<HashMap<String, ChainStatus>>,
    pub tx: broadcast::Sender<String>,
    /// Last scanned block per chain, so each scan only covers new blocks.
    last_blocks: Mutex<HashMap<&'static str, u64>>,
    evm_gate: Gate,
    bitcoin_gate: Gate,
}

impl WhaleStore {
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(256);
        let mut status = HashMap::new();
        status.insert(
            "solana".to_string(),
            ChainStatus {
                chain: "solana".into(),
                name: "Solana".into(),
                supported: false,
                ok: false,
                last_block: None,
                last_poll: None,
                note: "Not available yet. A reliable Solana feed needs a dedicated RPC provider."
                    .into(),
            },
        );
        Self {
            events: RwLock::new(VecDeque::new()),
            seen: Mutex::new(HashSet::new()),
            status: RwLock::new(status),
            tx,
            last_blocks: Mutex::new(HashMap::new()),
            evm_gate: Gate::new(Duration::from_secs(15), Duration::from_secs(10)),
            // The free Blockchair tier allows roughly one request a minute.
            bitcoin_gate: Gate::new(Duration::from_secs(90), Duration::from_secs(60)),
        }
    }

    fn last_block(&self, chain: &'static str) -> Option<u64> {
        self.last_blocks
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(chain)
            .copied()
    }

    fn set_last_block(&self, chain: &'static str, block: u64) {
        self.last_blocks
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(chain, block);
    }

    /// Records a failed scan while keeping what is known about the chain.
    fn mark_failed(&self, chain: &str, name: &str, error: &str) {
        let mut status = self
            .status
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .get(chain)
            .cloned()
            .unwrap_or(ChainStatus {
                chain: chain.into(),
                name: name.into(),
                supported: true,
                ok: false,
                last_block: None,
                last_poll: None,
                note: String::new(),
            });
        status.ok = false;
        status.last_poll = Some(Utc::now());
        status.note = format!(
            "Last poll failed: {}",
            error.chars().take(120).collect::<String>()
        );
        self.set_status(status);
    }

    /// Adds events that have not been seen before and broadcasts them. Returns how many were new.
    pub fn push(&self, incoming: Vec<WhaleEvent>) -> usize {
        let mut fresh: Vec<WhaleEvent> = Vec::new();
        {
            let mut seen = self.seen.lock().unwrap_or_else(|e| e.into_inner());
            if seen.len() > MAX_EVENTS * 4 {
                seen.clear();
            }
            for ev in incoming {
                if seen.insert(ev.id.clone()) {
                    fresh.push(ev);
                }
            }
        }
        if fresh.is_empty() {
            return 0;
        }
        fresh.sort_by_key(|e| e.timestamp);
        {
            let mut events = self.events.write().unwrap_or_else(|e| e.into_inner());
            for ev in &fresh {
                events.push_front(ev.clone());
            }
            let mut v: Vec<WhaleEvent> = events.drain(..).collect();
            v.sort_by_key(|e| std::cmp::Reverse(e.timestamp));
            v.truncate(MAX_EVENTS);
            *events = v.into();
        }
        for ev in &fresh {
            let _ = self
                .tx
                .send(json!({ "type": "whale", "data": ev }).to_string());
        }
        fresh.len()
    }

    /// Newest events at or above `min_usd`.
    pub fn recent(&self, n: usize, min_usd: f64) -> Vec<WhaleEvent> {
        self.events
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .iter()
            .filter(|e| e.value_usd >= min_usd)
            .take(n)
            .cloned()
            .collect()
    }

    fn set_status(&self, s: ChainStatus) {
        self.status
            .write()
            .unwrap_or_else(|e| e.into_inner())
            .insert(s.chain.clone(), s);
    }
}

impl Default for WhaleStore {
    fn default() -> Self {
        Self::new()
    }
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

/// Parses a hex string of any length into f64 (precise to about 15 significant digits).
pub fn hex_to_f64(s: &str) -> Option<f64> {
    let s = s.strip_prefix("0x").unwrap_or(s);
    if s.is_empty() {
        return Some(0.0);
    }
    let mut acc = 0.0f64;
    for c in s.chars() {
        acc = acc * 16.0 + c.to_digit(16)? as f64;
    }
    Some(acc)
}

fn hex_to_u64(s: &str) -> Option<u64> {
    u64::from_str_radix(s.strip_prefix("0x").unwrap_or(s), 16).ok()
}

/// Extracts the 20 byte address from a 32 byte topic.
fn topic_address(topic: &str) -> Option<String> {
    let t = topic.strip_prefix("0x")?;
    if t.len() != 64 {
        return None;
    }
    Some(format!("0x{}", &t[24..]))
}

const EXCHANGES: &[(&str, &str)] = &[
    ("0x28c6c06298d514db089934071355e5743bf21d60", "Binance"),
    ("0x21a31ee1afc51d94c2efccaa2092ad1028285549", "Binance"),
    ("0xdfd5293d8e347dfe59e90efd55b2956a1343963d", "Binance"),
    ("0xf977814e90da44bfa03b6295a0616a897441acec", "Binance"),
    ("0xbe0eb53f46cd790cd13851d5eff43d12404d33e8", "Binance"),
    ("0x3f5ce5fbfe3e9af3971dd833d26ba9b5c936f0be", "Binance"),
    ("0xd551234ae421e3bcba99a0da6d736074f22192ff", "Binance"),
    ("0x564286362092d8e7936f0549571a803b203aaced", "Binance"),
    ("0x71660c4005ba85c37ccec55d0c4493e66fe775d3", "Coinbase"),
    ("0x503828976d22510aad0201ac7ec88293211d23da", "Coinbase"),
    ("0xddfabcdc4d8ffc6d5beaf154f18b778f892a0740", "Coinbase"),
    ("0x267be1c1d684f78cb4f6a176c4911b741e4ffdc0", "Kraken"),
    ("0x2910543af39aba0cd09dbb2d50200b3e800a63d2", "Kraken"),
    ("0x6cc5f688a315f3dc28a7781717a9a798a59fda7b", "OKX"),
    ("0xf89d7b9c864f589bbf53a82105107622b35eaa40", "Bybit"),
    ("0x876eabf441b2ee5b5b0554fd502a8e0600950cfa", "Bitfinex"),
];

pub fn exchange_label(addr: &str) -> Option<&'static str> {
    let a = addr.to_ascii_lowercase();
    EXCHANGES
        .iter()
        .find(|(known, _)| *known == a)
        .map(|(_, name)| *name)
}

pub fn classify(
    from: Option<&str>,
    to: Option<&str>,
) -> (&'static str, Option<&'static str>, Option<&'static str>) {
    let fl = from.and_then(exchange_label);
    let tl = to.and_then(exchange_label);
    let kind = match (fl, tl) {
        (None, Some(_)) => "exchange_inflow",
        (Some(_), None) => "exchange_outflow",
        _ => "transfer",
    };
    (kind, fl, tl)
}

#[derive(Clone, Copy)]
pub(crate) enum PriceRef {
    Stable,
    Ticker(&'static str),
}

pub(crate) struct TokenSpec {
    pub(crate) symbol: &'static str,
    pub(crate) address: &'static str,
    pub(crate) decimals: i32,
    pub(crate) price: PriceRef,
}

pub(crate) struct ChainSpec {
    pub(crate) key: &'static str,
    pub(crate) name: &'static str,
    pub(crate) native: &'static str,
    pub(crate) native_ticker: &'static str,
    explorer_tx: &'static str,
    poll_secs: u64,
    native_blocks: u64,
    log_range: u64,
    lookback: u64,
    pub(crate) tokens: &'static [TokenSpec],
}

const ETH_TOKENS: &[TokenSpec] = &[
    TokenSpec {
        symbol: "USDT",
        address: "0xdac17f958d2ee523a2206206994597c13d831ec7",
        decimals: 6,
        price: PriceRef::Stable,
    },
    TokenSpec {
        symbol: "USDC",
        address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
        decimals: 6,
        price: PriceRef::Stable,
    },
    TokenSpec {
        symbol: "DAI",
        address: "0x6b175474e89094c44da98b954eedeac495271d0f",
        decimals: 18,
        price: PriceRef::Stable,
    },
    TokenSpec {
        symbol: "WETH",
        address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
        decimals: 18,
        price: PriceRef::Ticker("ETHUSDT"),
    },
    TokenSpec {
        symbol: "WBTC",
        address: "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599",
        decimals: 8,
        price: PriceRef::Ticker("BTCUSDT"),
    },
];
const BSC_TOKENS: &[TokenSpec] = &[
    TokenSpec {
        symbol: "USDT",
        address: "0x55d398326f99059ff775485246999027b3197955",
        decimals: 18,
        price: PriceRef::Stable,
    },
    TokenSpec {
        symbol: "USDC",
        address: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
        decimals: 18,
        price: PriceRef::Stable,
    },
    TokenSpec {
        symbol: "WBNB",
        address: "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
        decimals: 18,
        price: PriceRef::Ticker("BNBUSDT"),
    },
    TokenSpec {
        symbol: "BTCB",
        address: "0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c",
        decimals: 18,
        price: PriceRef::Ticker("BTCUSDT"),
    },
];
const BASE_TOKENS: &[TokenSpec] = &[
    TokenSpec {
        symbol: "USDC",
        address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
        decimals: 6,
        price: PriceRef::Stable,
    },
    TokenSpec {
        symbol: "WETH",
        address: "0x4200000000000000000000000000000000000006",
        decimals: 18,
        price: PriceRef::Ticker("ETHUSDT"),
    },
];
const ARB_TOKENS: &[TokenSpec] = &[
    TokenSpec {
        symbol: "USDC",
        address: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
        decimals: 6,
        price: PriceRef::Stable,
    },
    TokenSpec {
        symbol: "USDT",
        address: "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9",
        decimals: 6,
        price: PriceRef::Stable,
    },
    TokenSpec {
        symbol: "WETH",
        address: "0x82af49447d8a07e3bd95bd0d56f35241523fbab1",
        decimals: 18,
        price: PriceRef::Ticker("ETHUSDT"),
    },
    TokenSpec {
        symbol: "WBTC",
        address: "0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f",
        decimals: 8,
        price: PriceRef::Ticker("BTCUSDT"),
    },
];

pub(crate) const CHAINS: &[ChainSpec] = &[
    ChainSpec {
        key: "ethereum",
        name: "Ethereum",
        native: "ETH",
        native_ticker: "ETHUSDT",
        explorer_tx: "https://etherscan.io/tx/",
        poll_secs: 15,
        native_blocks: 3,
        log_range: 40,
        lookback: 25,
        tokens: ETH_TOKENS,
    },
    ChainSpec {
        key: "bsc",
        name: "BNB Chain",
        native: "BNB",
        native_ticker: "BNBUSDT",
        explorer_tx: "https://bscscan.com/tx/",
        poll_secs: 15,
        native_blocks: 6,
        log_range: 200,
        lookback: 100,
        tokens: BSC_TOKENS,
    },
    ChainSpec {
        key: "base",
        name: "Base",
        native: "ETH",
        native_ticker: "ETHUSDT",
        explorer_tx: "https://basescan.org/tx/",
        poll_secs: 20,
        native_blocks: 0,
        log_range: 300,
        lookback: 150,
        tokens: BASE_TOKENS,
    },
    ChainSpec {
        key: "arbitrum",
        name: "Arbitrum",
        native: "ETH",
        native_ticker: "ETHUSDT",
        explorer_tx: "https://arbiscan.io/tx/",
        poll_secs: 20,
        native_blocks: 0,
        log_range: 1200,
        lookback: 600,
        tokens: ARB_TOKENS,
    },
];

pub(crate) fn price_of(state: &AppState, p: PriceRef) -> Option<f64> {
    match p {
        PriceRef::Stable => Some(1.0),
        PriceRef::Ticker(sym) => state
            .binance
            .price(sym)
            .or_else(|| state.market.price_of_symbol(sym.trim_end_matches("USDT"))),
    }
}

pub(crate) fn rpc_url(state: &AppState, key: &str) -> String {
    match key {
        "ethereum" => state.config.eth_rpc.clone(),
        "bsc" => state.config.bsc_rpc.clone(),
        "base" => state.config.base_rpc.clone(),
        _ => state.config.arbitrum_rpc.clone(),
    }
}

/// Decodes one ERC 20 Transfer log into an event (without timestamp yet).
fn decode_transfer_log(
    spec: &ChainSpec,
    token: &TokenSpec,
    log: &Value,
    usd_price: f64,
    min_usd: f64,
) -> Option<WhaleEvent> {
    let topics = log.get("topics")?.as_array()?;
    if topics.len() != 3 || topics[0].as_str()? != TRANSFER_TOPIC {
        return None; // ERC 721 transfers have 4 topics and are ignored.
    }
    let from = topic_address(topics[1].as_str()?)?;
    let to = topic_address(topics[2].as_str()?)?;
    let raw = hex_to_f64(log.get("data")?.as_str()?)?;
    let amount = raw / 10f64.powi(token.decimals);
    let value_usd = amount * usd_price;
    if !value_usd.is_finite() || value_usd < min_usd {
        return None;
    }
    let tx_hash = log.get("transactionHash")?.as_str()?.to_string();
    let log_index = log
        .get("logIndex")
        .and_then(|v| v.as_str())
        .and_then(hex_to_u64)
        .unwrap_or(0);
    let (kind, fl, tl) = classify(Some(&from), Some(&to));
    Some(WhaleEvent {
        id: format!("{}:{}:{}", spec.key, tx_hash, log_index),
        chain: spec.key.to_string(),
        chain_name: spec.name.to_string(),
        asset: token.symbol.to_string(),
        amount,
        value_usd,
        from: Some(from),
        to: Some(to),
        from_label: fl.map(String::from),
        to_label: tl.map(String::from),
        kind,
        explorer_url: format!("{}{}", spec.explorer_tx, tx_hash),
        tx_hash,
        block: log
            .get("blockNumber")
            .and_then(|v| v.as_str())
            .and_then(hex_to_u64),
        timestamp: 0,
    })
}

/// Decodes a plain native transfer (no calldata) from a full block transaction.
fn decode_native_tx(
    spec: &ChainSpec,
    tx: &Value,
    block: u64,
    ts_ms: i64,
    usd_price: f64,
    min_usd: f64,
) -> Option<WhaleEvent> {
    if tx.get("input")?.as_str()? != "0x" {
        return None;
    }
    let to = tx.get("to")?.as_str()?.to_string();
    let from = tx.get("from")?.as_str()?.to_string();
    let amount = hex_to_f64(tx.get("value")?.as_str()?)? / 1e18;
    let value_usd = amount * usd_price;
    if !value_usd.is_finite() || value_usd < min_usd {
        return None;
    }
    let tx_hash = tx.get("hash")?.as_str()?.to_string();
    let (kind, fl, tl) = classify(Some(&from), Some(&to));
    Some(WhaleEvent {
        id: format!("{}:{}:native", spec.key, tx_hash),
        chain: spec.key.to_string(),
        chain_name: spec.name.to_string(),
        asset: spec.native.to_string(),
        amount,
        value_usd,
        from: Some(from),
        to: Some(to),
        from_label: fl.map(String::from),
        to_label: tl.map(String::from),
        kind,
        explorer_url: format!("{}{}", spec.explorer_tx, tx_hash),
        tx_hash,
        block: Some(block),
        timestamp: ts_ms,
    })
}

// ── EVM polling ──────────────────────────────────────────────────────────────

async fn rpc(
    state: &AppState,
    chain: &str,
    url: &str,
    method: &str,
    params: Value,
) -> std::result::Result<Value, String> {
    let body = json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params });
    let v: Value = state
        .up
        .post_json(
            &format!("rpc-{chain}"),
            url,
            &body,
            &[],
            Some(Duration::from_secs(15)),
        )
        .await
        .map_err(|e| e.to_string())?;
    if let Some(err) = v.get("error") {
        return Err(err.to_string());
    }
    v.get("result")
        .cloned()
        .ok_or_else(|| "empty rpc result".to_string())
}

/// Block timestamps in milliseconds. A handful of blocks are fetched exactly.
/// For a longer span (the first scan after a start) the first and last block
/// are fetched and the rest are interpolated, which keeps a cold start to two
/// calls instead of one per block.
async fn block_timestamps(
    state: &AppState,
    spec: &ChainSpec,
    url: &str,
    blocks: &[u64],
) -> HashMap<u64, i64> {
    const EXACT_LIMIT: usize = 6;
    let fetch = |n: u64| async move {
        let block = rpc(
            state,
            spec.key,
            url,
            "eth_getBlockByNumber",
            json!([format!("0x{n:x}"), false]),
        )
        .await
        .ok()?;
        let ts = block
            .get("timestamp")
            .and_then(|t| t.as_str())
            .and_then(hex_to_u64)?;
        Some((n, ts as i64 * 1000))
    };
    let mut out: HashMap<u64, i64> = HashMap::new();
    if blocks.len() <= EXACT_LIMIT {
        for (n, ts) in futures_util::future::join_all(blocks.iter().map(|n| fetch(*n)))
            .await
            .into_iter()
            .flatten()
        {
            out.insert(n, ts);
        }
        return out;
    }
    let (Some(&first), Some(&last)) = (blocks.iter().min(), blocks.iter().max()) else {
        return out;
    };
    let (a, b) = tokio::join!(fetch(first), fetch(last));
    if let (Some((_, t0)), Some((_, t1))) = (a, b) {
        for &n in blocks {
            out.insert(n, interpolate_timestamp(first, t0, last, t1, n));
        }
    }
    out
}

/// Linear estimate of a block time between two known blocks.
pub fn interpolate_timestamp(first: u64, t0: i64, last: u64, t1: i64, block: u64) -> i64 {
    if last <= first {
        return t0;
    }
    let span = (last - first) as f64;
    let offset = block.clamp(first, last) - first;
    t0 + (((t1 - t0) as f64) * (offset as f64 / span)).round() as i64
}

async fn poll_evm_once(
    state: &Arc<AppState>,
    spec: &'static ChainSpec,
) -> std::result::Result<usize, String> {
    let last_block = state.whales.last_block(spec.key);
    let url = rpc_url(state, spec.key);
    let latest = hex_to_u64(
        rpc(state, spec.key, &url, "eth_blockNumber", json!([]))
            .await?
            .as_str()
            .unwrap_or("0x0"),
    )
    .ok_or("bad block number")?;
    let start = match last_block {
        Some(l) if l >= latest => return Ok(0),
        Some(l) => l + 1,
        None => latest.saturating_sub(spec.lookback),
    };
    let log_from = start.max(latest.saturating_sub(spec.log_range.saturating_sub(1)));
    let min_usd = state.config.whale_min_usd;
    let mut events: Vec<WhaleEvent> = Vec::new();

    // ERC 20 transfers of the tracked tokens.
    let addresses: Vec<&str> = spec.tokens.iter().map(|t| t.address).collect();
    let filter = json!([{
        "fromBlock": format!("0x{log_from:x}"),
        "toBlock": format!("0x{latest:x}"),
        "address": addresses,
        "topics": [TRANSFER_TOPIC],
    }]);
    let logs = rpc(state, spec.key, &url, "eth_getLogs", filter).await?;
    for log in logs.as_array().cloned().unwrap_or_default() {
        let addr = log
            .get("address")
            .and_then(|a| a.as_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        let Some(token) = spec.tokens.iter().find(|t| t.address == addr) else {
            continue;
        };
        let Some(price) = price_of(state, token.price) else {
            continue;
        };
        if let Some(ev) = decode_transfer_log(spec, token, &log, price, min_usd) {
            events.push(ev);
        }
    }

    // Block timestamps for the events we kept.
    let mut wanted: Vec<u64> = events.iter().filter_map(|e| e.block).collect();
    wanted.sort_unstable();
    wanted.dedup();
    let block_ts = block_timestamps(state, spec, &url, &wanted).await;
    let now = Utc::now().timestamp_millis();
    for ev in events.iter_mut() {
        ev.timestamp = ev
            .block
            .and_then(|b| block_ts.get(&b).copied())
            .unwrap_or(now);
    }

    // Native transfers.
    if spec.native_blocks > 0 {
        if let Some(native_price) = price_of(state, PriceRef::Ticker(spec.native_ticker)) {
            let native_from = start.max(latest.saturating_sub(spec.native_blocks - 1));
            let url_ref = url.as_str();
            let blocks =
                futures_util::future::join_all((native_from..=latest).map(|n| async move {
                    let block = rpc(
                        state,
                        spec.key,
                        url_ref,
                        "eth_getBlockByNumber",
                        json!([format!("0x{n:x}"), true]),
                    )
                    .await
                    .ok()?;
                    Some((n, block))
                }))
                .await;
            for (n, block) in blocks.into_iter().flatten() {
                let ts = block
                    .get("timestamp")
                    .and_then(|t| t.as_str())
                    .and_then(hex_to_u64)
                    .map(|s| s as i64 * 1000)
                    .unwrap_or(now);
                for tx in block
                    .get("transactions")
                    .and_then(|t| t.as_array())
                    .cloned()
                    .unwrap_or_default()
                {
                    if let Some(ev) = decode_native_tx(spec, &tx, n, ts, native_price, min_usd) {
                        events.push(ev);
                    }
                }
            }
        }
    }

    state.whales.set_last_block(spec.key, latest);
    state.whales.set_status(ChainStatus {
        chain: spec.key.into(),
        name: spec.name.into(),
        supported: true,
        ok: true,
        last_block: Some(latest),
        last_poll: Some(Utc::now()),
        note: format!(
            "ERC 20 transfers of {} plus {}",
            spec.tokens
                .iter()
                .map(|t| t.symbol)
                .collect::<Vec<_>>()
                .join(", "),
            if spec.native_blocks > 0 {
                "native transfers"
            } else {
                "no native scan"
            }
        ),
    });
    Ok(state.whales.push(events))
}

// ── Bitcoin (Blockchair) ─────────────────────────────────────────────────────

pub fn parse_blockchair(raw: &str, btc_usd: f64, min_usd: f64) -> Vec<WhaleEvent> {
    let Ok(v) = serde_json::from_str::<Value>(raw) else {
        return vec![];
    };
    let Some(rows) = v.get("data").and_then(|d| d.as_array()) else {
        return vec![];
    };
    rows.iter()
        .filter_map(|r| {
            let hash = r.get("hash")?.as_str()?.to_string();
            let sats = r.get("output_total")?.as_f64()?;
            let amount = sats / 1e8;
            let value_usd = r
                .get("output_total_usd")
                .and_then(|u| u.as_f64())
                .unwrap_or(amount * btc_usd);
            if value_usd < min_usd {
                return None;
            }
            let ts = r
                .get("time")
                .and_then(|t| t.as_str())
                .and_then(|t| NaiveDateTime::parse_from_str(t, "%Y-%m-%d %H:%M:%S").ok())
                .map(|n| n.and_utc().timestamp_millis())
                .unwrap_or_else(|| Utc::now().timestamp_millis());
            let block = r
                .get("block_id")
                .and_then(|b| b.as_i64())
                .filter(|b| *b > 0)
                .map(|b| b as u64);
            Some(WhaleEvent {
                id: format!("bitcoin:{hash}"),
                chain: "bitcoin".into(),
                chain_name: "Bitcoin".into(),
                asset: "BTC".into(),
                amount,
                value_usd,
                from: None,
                to: None,
                from_label: None,
                to_label: None,
                kind: "transfer",
                explorer_url: format!("https://mempool.space/tx/{hash}"),
                tx_hash: hash,
                block,
                timestamp: ts,
            })
        })
        .collect()
}

async fn poll_bitcoin_once(state: &Arc<AppState>) -> std::result::Result<usize, String> {
    let btc = price_of(state, PriceRef::Ticker("BTCUSDT")).ok_or("waiting for a BTC price")?;
    let min_usd = state.config.whale_min_usd;
    let min_sats = ((min_usd / btc) * 1e8).floor().max(1.0);
    let url = format!("{}/bitcoin/transactions", state.config.blockchair_base);
    let mut query = vec![
        ("q", format!("output_total({min_sats}..)")),
        ("s", "time(desc)".to_string()),
        ("limit", "40".to_string()),
    ];
    if let Some(k) = &state.config.blockchair_api_key {
        query.push(("key", k.clone()));
    }
    let v: Value = state
        .up
        .get_json_with("blockchair", &url, &query, &[])
        .await
        .map_err(|e| e.to_string())?;
    let events = parse_blockchair(&v.to_string(), btc, min_usd);
    state.whales.set_status(ChainStatus {
        chain: "bitcoin".into(),
        name: "Bitcoin".into(),
        supported: true,
        ok: true,
        last_block: None,
        last_poll: Some(Utc::now()),
        note:
            "Large transactions (total outputs) from Blockchair; wallet addresses are not included"
                .into(),
    });
    Ok(state.whales.push(events))
}

/// Scans one EVM chain and records the outcome. Returns true on success.
async fn poll_chain(state: &Arc<AppState>, spec: &'static ChainSpec) -> bool {
    match poll_evm_once(state, spec).await {
        Ok(_) => true,
        Err(e) => {
            tracing::warn!("{} whale poll failed: {e}", spec.key);
            state.whales.mark_failed(spec.key, spec.name, &e);
            false
        }
    }
}

/// Fetches recent large Bitcoin transactions and records the outcome.
async fn poll_bitcoin(state: &Arc<AppState>) -> bool {
    match poll_bitcoin_once(state).await {
        Ok(_) => true,
        Err(e) => {
            tracing::warn!("bitcoin whale poll failed: {e}");
            state.whales.mark_failed("bitcoin", "Bitcoin", &e);
            false
        }
    }
}

/// On demand mode: scans the chains that are due. A no op when pollers run.
pub async fn ensure_fresh(state: &Arc<AppState>) {
    if !state.config.on_demand {
        return;
    }
    // Transfers are valued with live prices, so those come first.
    crate::binance::ensure_tickers(state).await;
    tokio::join!(
        state.whales.evm_gate.ensure(|| async {
            let results =
                futures_util::future::join_all(CHAINS.iter().map(|spec| poll_chain(state, spec)))
                    .await;
            results.into_iter().any(|ok| ok)
        }),
        state.whales.bitcoin_gate.ensure(|| poll_bitcoin(state)),
    );
}

pub fn spawn_pollers(state: Arc<AppState>) {
    for spec in CHAINS {
        let st = state.clone();
        tokio::spawn(async move {
            // Wait briefly so the first prices are available for valuation.
            tokio::time::sleep(Duration::from_secs(4)).await;
            loop {
                poll_chain(&st, spec).await;
                tokio::time::sleep(Duration::from_secs(spec.poll_secs)).await;
            }
        });
    }

    let st = state;
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(6)).await;
        loop {
            poll_bitcoin(&st).await;
            // The free Blockchair tier allows roughly one request a minute.
            tokio::time::sleep(Duration::from_secs(90)).await;
        }
    });
}

// ── HTTP handler ─────────────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WhaleQuery {
    min_usd: Option<f64>,
    chain: Option<String>,
    address: Option<String>,
    limit: Option<usize>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WhaleStats {
    count: usize,
    largest_usd: f64,
    total_usd: f64,
    average_usd: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WhaleResponse {
    events: Vec<WhaleEvent>,
    stats: WhaleStats,
    chains: Vec<ChainStatus>,
    min_usd_floor: f64,
}

pub async fn get_whales(
    State(state): State<Arc<AppState>>,
    Query(q): Query<WhaleQuery>,
) -> Result<Json<WhaleResponse>> {
    let min_usd = q
        .min_usd
        .unwrap_or(state.config.whale_min_usd)
        .max(state.config.whale_min_usd);
    let limit = q.limit.unwrap_or(150).clamp(1, 500);
    let address = q.address.map(|a| a.to_ascii_lowercase());
    ensure_fresh(&state).await;
    let events: Vec<WhaleEvent> = state
        .whales
        .events
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .iter()
        .filter(|e| e.value_usd >= min_usd)
        .filter(|e| q.chain.as_deref().is_none_or(|c| c == e.chain))
        .filter(|e| {
            address.as_deref().is_none_or(|a| {
                e.from
                    .as_deref()
                    .map(|f| f.eq_ignore_ascii_case(a))
                    .unwrap_or(false)
                    || e.to
                        .as_deref()
                        .map(|t| t.eq_ignore_ascii_case(a))
                        .unwrap_or(false)
            })
        })
        .take(limit)
        .cloned()
        .collect();
    let total: f64 = events.iter().map(|e| e.value_usd).sum();
    let stats = WhaleStats {
        count: events.len(),
        largest_usd: events.iter().map(|e| e.value_usd).fold(0.0, f64::max),
        total_usd: total,
        average_usd: if events.is_empty() {
            0.0
        } else {
            total / events.len() as f64
        },
    };
    let mut chains: Vec<ChainStatus> = state
        .whales
        .status
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .values()
        .cloned()
        .collect();
    chains.sort_by(|a, b| b.supported.cmp(&a.supported).then(a.name.cmp(&b.name)));
    Ok(Json(WhaleResponse {
        events,
        stats,
        chains,
        min_usd_floor: state.config.whale_min_usd,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn block_times_are_interpolated_between_two_known_blocks() {
        assert_eq!(interpolate_timestamp(100, 1_000, 110, 121_000, 100), 1_000);
        assert_eq!(interpolate_timestamp(100, 1_000, 110, 121_000, 105), 61_000);
        assert_eq!(
            interpolate_timestamp(100, 1_000, 110, 121_000, 110),
            121_000
        );
        // Out of range blocks are clamped, and a single block span is safe.
        assert_eq!(
            interpolate_timestamp(100, 1_000, 110, 121_000, 500),
            121_000
        );
        assert_eq!(interpolate_timestamp(100, 1_000, 100, 9_000, 100), 1_000);
    }

    const USDC: &TokenSpec = &ETH_TOKENS[1];

    #[test]
    fn hex_parsing() {
        assert_eq!(hex_to_f64("0x0"), Some(0.0));
        assert_eq!(hex_to_f64("0xff"), Some(255.0));
        assert_eq!(hex_to_f64("0x"), Some(0.0));
        assert_eq!(hex_to_f64("0xzz"), None);
        // 1e18 wei
        assert_eq!(hex_to_f64("0xde0b6b3a7640000"), Some(1e18));
    }

    #[test]
    fn decodes_a_usdc_transfer_log() {
        // 2,500,000 USDC with 6 decimals
        let raw: u64 = 2_500_000_000_000;
        let log = json!({
            "address": USDC.address,
            "topics": [
                TRANSFER_TOPIC,
                "0x00000000000000000000000028c6c06298d514db089934071355e5743bf21d60",
                "0x0000000000000000000000001111111111111111111111111111111111111111"
            ],
            "data": format!("0x{:064x}", raw),
            "blockNumber": "0x1312d00",
            "transactionHash": "0xabc",
            "logIndex": "0x5"
        });
        let ev = decode_transfer_log(&CHAINS[0], USDC, &log, 1.0, 100_000.0).unwrap();
        assert_eq!(ev.asset, "USDC");
        assert!((ev.amount - 2_500_000.0).abs() < 1e-6);
        assert!((ev.value_usd - 2_500_000.0).abs() < 1e-6);
        assert_eq!(
            ev.kind, "exchange_outflow",
            "from a known Binance wallet to an unknown one"
        );
        assert_eq!(ev.from_label.as_deref(), Some("Binance"));
        assert_eq!(ev.id, "ethereum:0xabc:5");
        assert_eq!(ev.block, Some(0x1312d00));
        assert_eq!(
            ev.to.as_deref(),
            Some("0x1111111111111111111111111111111111111111")
        );
    }

    #[test]
    fn small_and_nft_transfers_are_ignored() {
        let small = json!({"topics":[TRANSFER_TOPIC,
            "0x0000000000000000000000001111111111111111111111111111111111111111",
            "0x0000000000000000000000002222222222222222222222222222222222222222"],
            "data": format!("0x{:064x}", 1_000_000u64), "transactionHash": "0x1"});
        assert!(decode_transfer_log(&CHAINS[0], USDC, &small, 1.0, 100_000.0).is_none());

        let nft = json!({"topics":[TRANSFER_TOPIC,
            "0x0000000000000000000000001111111111111111111111111111111111111111",
            "0x0000000000000000000000002222222222222222222222222222222222222222",
            "0x0000000000000000000000000000000000000000000000000000000000000001"],
            "data": "0x", "transactionHash": "0x2"});
        assert!(decode_transfer_log(&CHAINS[0], USDC, &nft, 1.0, 0.0).is_none());
    }

    #[test]
    fn native_transfer_requires_empty_calldata() {
        let tx = json!({"hash":"0xdead","from":"0xaaaa","to":"0x71660c4005ba85c37ccec55d0c4493e66fe775d3",
            "value":"0x1bc16d674ec80000","input":"0x"}); // 2 ETH
        let ev = decode_native_tx(&CHAINS[0], &tx, 100, 5_000, 3000.0, 1000.0).unwrap();
        assert!((ev.amount - 2.0).abs() < 1e-9);
        assert!((ev.value_usd - 6000.0).abs() < 1e-6);
        assert_eq!(ev.kind, "exchange_inflow");
        assert_eq!(ev.to_label.as_deref(), Some("Coinbase"));

        let call = json!({"hash":"0xbeef","from":"0xaaaa","to":"0xbbbb","value":"0x1bc16d674ec80000","input":"0xa9059cbb00"});
        assert!(decode_native_tx(&CHAINS[0], &call, 100, 5_000, 3000.0, 0.0).is_none());
    }

    #[test]
    fn classification() {
        let binance = "0x28C6c06298d514Db089934071355E5743bf21d60";
        assert_eq!(classify(Some(binance), Some(binance)).0, "transfer");
        assert_eq!(classify(None, Some(binance)).0, "exchange_inflow");
        assert_eq!(classify(Some("0x1"), Some("0x2")).0, "transfer");
        assert_eq!(exchange_label(binance), Some("Binance"), "case insensitive");
    }

    #[test]
    fn blockchair_rows_parse() {
        let raw = r#"{"data":[{"block_id":850000,"hash":"abc123","time":"2026-01-02 03:04:05","output_total":5000000000,"output_total_usd":3250000.5},
            {"block_id":-1,"hash":"small","time":"2026-01-02 03:04:05","output_total":1000,"output_total_usd":10}]}"#;
        let ev = parse_blockchair(raw, 65_000.0, 100_000.0);
        assert_eq!(ev.len(), 1);
        assert_eq!(ev[0].asset, "BTC");
        assert!((ev[0].amount - 50.0).abs() < 1e-9);
        assert_eq!(ev[0].block, Some(850000));
        assert_eq!(ev[0].timestamp, 1_767_323_045_000);
    }

    #[test]
    fn store_dedupes_sorts_and_caps() {
        let store = WhaleStore::new();
        let mk = |id: &str, ts: i64| WhaleEvent {
            id: id.into(),
            chain: "ethereum".into(),
            chain_name: "Ethereum".into(),
            asset: "USDC".into(),
            amount: 1.0,
            value_usd: 1.0,
            from: None,
            to: None,
            from_label: None,
            to_label: None,
            kind: "transfer",
            tx_hash: id.into(),
            block: None,
            timestamp: ts,
            explorer_url: String::new(),
        };
        assert_eq!(store.push(vec![mk("a", 10), mk("b", 30), mk("a", 10)]), 2);
        assert_eq!(store.push(vec![mk("b", 30), mk("c", 20)]), 1);
        let ids: Vec<String> = store
            .events
            .read()
            .unwrap()
            .iter()
            .map(|e| e.id.clone())
            .collect();
        assert_eq!(ids, vec!["b", "c", "a"]);
    }
}
