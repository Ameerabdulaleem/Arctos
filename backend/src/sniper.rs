//! Token discovery and contract risk checks.
//!
//! * New pools: GeckoTerminal `new_pools` per network (polled).
//! * Search and refresh: DexScreener.
//! * Risk: GoPlus token security (honeypot, taxes, mint and ownership flags).
//!
//! Nothing here executes trades. It only reads public market data.

use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex, RwLock},
    time::Duration,
};

use axum::{
    extract::{Query, State},
    Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::broadcast;

use crate::{
    error::{AppError, Result},
    upstream::{KeyedCache, UpstreamError},
    AppState,
};

#[derive(Clone, Copy)]
pub struct ChainInfo {
    pub key: &'static str,
    pub gecko_network: &'static str,
    pub dex_chain: &'static str,
    pub goplus_id: Option<&'static str>,
}

pub const CHAINS: &[ChainInfo] = &[
    ChainInfo {
        key: "solana",
        gecko_network: "solana",
        dex_chain: "solana",
        goplus_id: None,
    },
    ChainInfo {
        key: "ethereum",
        gecko_network: "eth",
        dex_chain: "ethereum",
        goplus_id: Some("1"),
    },
    ChainInfo {
        key: "bsc",
        gecko_network: "bsc",
        dex_chain: "bsc",
        goplus_id: Some("56"),
    },
    ChainInfo {
        key: "base",
        gecko_network: "base",
        dex_chain: "base",
        goplus_id: Some("8453"),
    },
    ChainInfo {
        key: "arbitrum",
        gecko_network: "arbitrum",
        dex_chain: "arbitrum",
        goplus_id: Some("42161"),
    },
];

pub fn chain_info(key: &str) -> Option<ChainInfo> {
    CHAINS.iter().copied().find(|c| c.key == key)
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SniperToken {
    pub id: String,
    pub symbol: String,
    pub name: String,
    pub address: String,
    pub chain: String,
    pub pair_address: String,
    pub dex: String,
    pub price_usd: f64,
    pub liquidity_usd: f64,
    pub market_cap_usd: f64,
    pub volume_24h_usd: f64,
    pub change_5m: Option<f64>,
    pub change_1h: Option<f64>,
    pub change_24h: Option<f64>,
    pub buys_24h: u64,
    pub sells_24h: u64,
    /// Unix milliseconds the pool was created, when known.
    pub created_at: Option<i64>,
    pub url: String,
    pub image_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Security {
    pub available: bool,
    pub risk_score: u32,
    pub risk_level: &'static str,
    pub flags: Vec<String>,
    pub buy_tax_pct: Option<f64>,
    pub sell_tax_pct: Option<f64>,
    pub holders: Option<u64>,
    pub is_honeypot: Option<bool>,
    pub source: &'static str,
}

impl Security {
    fn unavailable() -> Self {
        Self {
            available: false,
            risk_score: 0,
            risk_level: "unknown",
            flags: vec![],
            buy_tax_pct: None,
            sell_tax_pct: None,
            holders: None,
            is_honeypot: None,
            source: "GoPlus",
        }
    }
}

pub struct SniperStore {
    latest: RwLock<HashMap<String, Vec<SniperToken>>>,
    updated_at: RwLock<HashMap<String, DateTime<Utc>>>,
    seen: Mutex<HashSet<String>>,
    pub tx: broadcast::Sender<String>,
    security: KeyedCache<Security>,
    search: KeyedCache<Vec<SniperToken>>,
    refresh: KeyedCache<Vec<SniperToken>>,
    /// New pools per chain, used in on demand mode where no poller keeps `latest` fresh.
    new_pools: KeyedCache<Vec<SniperToken>>,
}

impl SniperStore {
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(128);
        Self {
            latest: RwLock::new(HashMap::new()),
            updated_at: RwLock::new(HashMap::new()),
            seen: Mutex::new(HashSet::new()),
            tx,
            security: KeyedCache::new(Duration::from_secs(300), Duration::from_secs(3600)),
            search: KeyedCache::new(Duration::from_secs(20), Duration::from_secs(120)),
            refresh: KeyedCache::new(Duration::from_secs(8), Duration::from_secs(60)),
            new_pools: KeyedCache::new(Duration::from_secs(20), Duration::from_secs(300)),
        }
    }
}

impl Default for SniperStore {
    fn default() -> Self {
        Self::new()
    }
}

// ── Validation ───────────────────────────────────────────────────────────────

pub fn valid_evm_address(a: &str) -> bool {
    a.len() == 42 && a.starts_with("0x") && a[2..].bytes().all(|b| b.is_ascii_hexdigit())
}

pub fn valid_solana_address(a: &str) -> bool {
    (32..=44).contains(&a.len())
        && a.bytes()
            .all(|b| b.is_ascii_alphanumeric() && b != b'0' && b != b'O' && b != b'I' && b != b'l')
}

pub fn valid_address_for(chain: &str, a: &str) -> bool {
    if chain == "solana" {
        valid_solana_address(a)
    } else {
        valid_evm_address(a)
    }
}

// ── Parsing ──────────────────────────────────────────────────────────────────

fn num(v: Option<&Value>) -> Option<f64> {
    match v? {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.parse().ok(),
        _ => None,
    }
}

fn safe_http_url(u: Option<&str>) -> Option<String> {
    let u = u?;
    (u.starts_with("https://") || u.starts_with("http://")).then(|| u.to_string())
}

fn token_id(chain: &str, address: &str) -> String {
    if chain == "solana" {
        format!("{chain}:{address}")
    } else {
        format!("{chain}:{}", address.to_ascii_lowercase())
    }
}

/// DexScreener pair list to tokens, keeping the most liquid pool per token.
pub fn parse_dexscreener(raw: &str, only_chain: Option<&str>) -> Vec<SniperToken> {
    let Ok(v) = serde_json::from_str::<Value>(raw) else {
        return vec![];
    };
    let Some(pairs) = v.get("pairs").and_then(|p| p.as_array()) else {
        return vec![];
    };
    let mut best: HashMap<String, SniperToken> = HashMap::new();
    for p in pairs {
        let Some(chain_id) = p.get("chainId").and_then(|c| c.as_str()) else {
            continue;
        };
        let Some(chain) = CHAINS.iter().find(|c| c.dex_chain == chain_id) else {
            continue;
        };
        if only_chain.is_some_and(|oc| oc != chain.key) {
            continue;
        }
        let base = p.get("baseToken");
        let Some(address) = base.and_then(|b| b.get("address")).and_then(|a| a.as_str()) else {
            continue;
        };
        let Some(price) = num(p.get("priceUsd")) else {
            continue;
        };
        let liquidity = num(p.get("liquidity").and_then(|l| l.get("usd"))).unwrap_or(0.0);
        let id = token_id(chain.key, address);
        let token = SniperToken {
            id: id.clone(),
            symbol: base
                .and_then(|b| b.get("symbol"))
                .and_then(|s| s.as_str())
                .unwrap_or("?")
                .chars()
                .take(20)
                .collect(),
            name: base
                .and_then(|b| b.get("name"))
                .and_then(|s| s.as_str())
                .unwrap_or("Unknown")
                .chars()
                .take(60)
                .collect(),
            address: address.to_string(),
            chain: chain.key.to_string(),
            pair_address: p
                .get("pairAddress")
                .and_then(|a| a.as_str())
                .unwrap_or_default()
                .to_string(),
            dex: p
                .get("dexId")
                .and_then(|a| a.as_str())
                .unwrap_or_default()
                .to_string(),
            price_usd: price,
            liquidity_usd: liquidity,
            market_cap_usd: num(p.get("marketCap"))
                .or_else(|| num(p.get("fdv")))
                .unwrap_or(0.0),
            volume_24h_usd: num(p.get("volume").and_then(|x| x.get("h24"))).unwrap_or(0.0),
            change_5m: num(p.get("priceChange").and_then(|x| x.get("m5"))),
            change_1h: num(p.get("priceChange").and_then(|x| x.get("h1"))),
            change_24h: num(p.get("priceChange").and_then(|x| x.get("h24"))),
            buys_24h: p
                .get("txns")
                .and_then(|t| t.get("h24"))
                .and_then(|h| h.get("buys"))
                .and_then(|b| b.as_u64())
                .unwrap_or(0),
            sells_24h: p
                .get("txns")
                .and_then(|t| t.get("h24"))
                .and_then(|h| h.get("sells"))
                .and_then(|b| b.as_u64())
                .unwrap_or(0),
            created_at: p.get("pairCreatedAt").and_then(|c| c.as_i64()),
            url: safe_http_url(p.get("url").and_then(|u| u.as_str())).unwrap_or_default(),
            image_url: safe_http_url(
                p.get("info")
                    .and_then(|i| i.get("imageUrl"))
                    .and_then(|u| u.as_str()),
            ),
        };
        match best.get(&id) {
            Some(existing) if existing.liquidity_usd >= token.liquidity_usd => {}
            _ => {
                best.insert(id, token);
            }
        }
    }
    let mut out: Vec<SniperToken> = best.into_values().collect();
    out.sort_by(|a, b| {
        b.liquidity_usd
            .partial_cmp(&a.liquidity_usd)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    out
}

/// GeckoTerminal new pools response to tokens.
pub fn parse_new_pools(raw: &str, chain: &ChainInfo) -> Vec<SniperToken> {
    let Ok(v) = serde_json::from_str::<Value>(raw) else {
        return vec![];
    };
    let Some(data) = v.get("data").and_then(|d| d.as_array()) else {
        return vec![];
    };
    let included: HashMap<String, &Value> = v
        .get("included")
        .and_then(|i| i.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| Some((x.get("id")?.as_str()?.to_string(), x)))
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
            let tok_attrs = included.get(base_id).and_then(|t| t.get("attributes"));
            let pool_name = attrs
                .get("name")
                .and_then(|n| n.as_str())
                .unwrap_or_default();
            let fallback_symbol = pool_name.split(" / ").next().unwrap_or("?");
            let price = num(attrs.get("base_token_price_usd"))?;
            let pc = attrs.get("price_change_percentage");
            let tx24 = attrs.get("transactions").and_then(|t| t.get("h24"));
            let pair_address = attrs
                .get("address")
                .and_then(|a| a.as_str())
                .unwrap_or_default()
                .to_string();
            let dex = rel
                .get("dex")
                .and_then(|d| d.get("data"))
                .and_then(|d| d.get("id"))
                .and_then(|d| d.as_str())
                .unwrap_or_default()
                .to_string();
            let created_at = attrs
                .get("pool_created_at")
                .and_then(|c| c.as_str())
                .and_then(|c| DateTime::parse_from_rfc3339(c).ok())
                .map(|d| d.timestamp_millis());
            let url_chain = chain.dex_chain;
            Some(SniperToken {
                id: token_id(chain.key, &address),
                symbol: tok_attrs
                    .and_then(|t| t.get("symbol"))
                    .and_then(|s| s.as_str())
                    .unwrap_or(fallback_symbol)
                    .chars()
                    .take(20)
                    .collect(),
                name: tok_attrs
                    .and_then(|t| t.get("name"))
                    .and_then(|s| s.as_str())
                    .unwrap_or(fallback_symbol)
                    .chars()
                    .take(60)
                    .collect(),
                address,
                chain: chain.key.to_string(),
                url: format!("https://dexscreener.com/{url_chain}/{pair_address}"),
                pair_address,
                dex,
                price_usd: price,
                liquidity_usd: num(attrs.get("reserve_in_usd")).unwrap_or(0.0),
                market_cap_usd: num(attrs.get("market_cap_usd"))
                    .or_else(|| num(attrs.get("fdv_usd")))
                    .unwrap_or(0.0),
                volume_24h_usd: num(attrs.get("volume_usd").and_then(|x| x.get("h24")))
                    .unwrap_or(0.0),
                change_5m: num(pc.and_then(|x| x.get("m5"))),
                change_1h: num(pc.and_then(|x| x.get("h1"))),
                change_24h: num(pc.and_then(|x| x.get("h24"))),
                buys_24h: tx24
                    .and_then(|h| h.get("buys"))
                    .and_then(|b| b.as_u64())
                    .unwrap_or(0),
                sells_24h: tx24
                    .and_then(|h| h.get("sells"))
                    .and_then(|b| b.as_u64())
                    .unwrap_or(0),
                created_at,
                image_url: safe_http_url(
                    tok_attrs
                        .and_then(|t| t.get("image_url"))
                        .and_then(|u| u.as_str()),
                ),
            })
        })
        .collect()
}

fn flag(v: Option<&Value>) -> bool {
    matches!(v, Some(Value::String(s)) if s == "1") || matches!(v, Some(Value::Bool(true)))
}

fn pct(v: Option<&Value>) -> Option<f64> {
    let n = num(v)?;
    Some((n * 1000.0).round() / 10.0)
}

fn level_for(score: u32) -> &'static str {
    match score {
        0..=19 => "low",
        20..=49 => "medium",
        _ => "high",
    }
}

/// Scores one EVM token entry from GoPlus. Higher means riskier.
pub fn score_evm(entry: &Value) -> Security {
    let mut score = 0u32;
    let mut flags: Vec<String> = Vec::new();
    let mut add = |points: u32, text: &str| {
        score += points;
        flags.push(text.to_string());
    };

    let honeypot = flag(entry.get("is_honeypot"));
    if honeypot {
        add(100, "Flagged as a honeypot, buyers may not be able to sell");
    }
    if flag(entry.get("cannot_sell_all")) {
        add(40, "Cannot sell the full balance");
    }
    let buy_tax = pct(entry.get("buy_tax"));
    let sell_tax = pct(entry.get("sell_tax"));
    for (label, tax) in [("Buy", buy_tax), ("Sell", sell_tax)] {
        match tax {
            Some(t) if t >= 50.0 => add(40, &format!("{label} tax is {t:.1}%")),
            Some(t) if t > 10.0 => add(20, &format!("{label} tax is {t:.1}%")),
            _ => {}
        }
    }
    if entry.get("is_open_source").and_then(|v| v.as_str()) == Some("0") {
        add(15, "Contract source is not verified");
    }
    if flag(entry.get("is_mintable")) {
        add(15, "Owner can mint new tokens");
    }
    if flag(entry.get("is_proxy")) {
        add(10, "Upgradeable proxy contract");
    }
    if flag(entry.get("hidden_owner")) {
        add(25, "Hidden owner");
    }
    if flag(entry.get("can_take_back_ownership")) {
        add(25, "Ownership can be taken back");
    }
    if flag(entry.get("owner_change_balance")) {
        add(30, "Owner can change balances");
    }
    if flag(entry.get("transfer_pausable")) {
        add(20, "Transfers can be paused");
    }
    if flag(entry.get("is_blacklisted")) {
        add(10, "Has a blacklist function");
    }
    if flag(entry.get("slippage_modifiable")) {
        add(20, "Tax can be changed by the owner");
    }
    let holders = entry
        .get("holder_count")
        .and_then(|h| h.as_str())
        .and_then(|h| h.parse::<u64>().ok());
    if matches!(holders, Some(h) if h < 50) {
        add(10, "Very few holders");
    }
    let score = score.min(100);
    Security {
        available: true,
        risk_score: score,
        risk_level: level_for(score),
        flags,
        buy_tax_pct: buy_tax,
        sell_tax_pct: sell_tax,
        holders,
        is_honeypot: Some(honeypot),
        source: "GoPlus",
    }
}

/// Scores one Solana token entry from GoPlus.
pub fn score_solana(entry: &Value) -> Security {
    let status = |key: &str| {
        entry
            .get(key)
            .and_then(|v| v.get("status"))
            .and_then(|s| s.as_str())
            == Some("1")
    };
    let mut score = 0u32;
    let mut flags: Vec<String> = Vec::new();
    let mut add = |points: u32, text: &str| {
        score += points;
        flags.push(text.to_string());
    };
    if status("mintable") {
        add(25, "Mint authority is still active");
    }
    if status("freezable") {
        add(25, "Freeze authority is still active");
    }
    if status("closable") {
        add(20, "Token account can be closed by the authority");
    }
    if status("balance_mutable_authority") {
        add(30, "Authority can change balances");
    }
    if entry
        .get("transfer_fee")
        .and_then(|t| t.as_object())
        .is_some_and(|o| !o.is_empty())
    {
        add(10, "Transfer fee is configured");
    }
    if entry.get("non_transferable").and_then(|v| v.as_str()) == Some("1") {
        add(100, "Token is non transferable");
    }
    let holders = entry
        .get("holder_count")
        .and_then(|h| h.as_str())
        .and_then(|h| h.parse::<u64>().ok());
    if matches!(holders, Some(h) if h < 50) {
        add(10, "Very few holders");
    }
    let score = score.min(100);
    Security {
        available: true,
        risk_score: score,
        risk_level: level_for(score),
        flags,
        buy_tax_pct: None,
        sell_tax_pct: None,
        holders,
        is_honeypot: None,
        source: "GoPlus",
    }
}

// ── Upstream calls ───────────────────────────────────────────────────────────

async fn fetch_security(
    state: &AppState,
    chain: &ChainInfo,
    address: &str,
) -> std::result::Result<Security, UpstreamError> {
    let base = &state.config.goplus_base;
    let url = match chain.goplus_id {
        Some(id) => format!("{base}/token_security/{id}"),
        None => format!("{base}/solana/token_security"),
    };
    let query = [("contract_addresses", address.to_string())];
    let v: Value = state.up.get_json_with("goplus", &url, &query, &[]).await?;
    let result = v.get("result");
    let entry = result.and_then(|r| {
        r.get(address)
            .or_else(|| r.get(address.to_ascii_lowercase()))
            .or_else(|| r.as_object().and_then(|o| o.values().next()))
    });
    Ok(match entry {
        Some(e) if e.is_object() && !e.as_object().is_none_or(|o| o.is_empty()) => {
            if chain.goplus_id.is_some() {
                score_evm(e)
            } else {
                score_solana(e)
            }
        }
        _ => Security::unavailable(),
    })
}

async fn fetch_new_pools(
    state: &AppState,
    chain: &ChainInfo,
) -> std::result::Result<Vec<SniperToken>, UpstreamError> {
    let url = format!(
        "{}/networks/{}/new_pools",
        state.config.geckoterminal_base, chain.gecko_network
    );
    let query = [
        ("include", "base_token,quote_token,dex".to_string()),
        ("page", "1".to_string()),
    ];
    let v: Value = state
        .up
        .get_json_with(
            "geckoterminal",
            &url,
            &query,
            &[("accept", "application/json;version=20230302")],
        )
        .await?;
    Ok(parse_new_pools(&v.to_string(), chain))
}

pub fn spawn_pollers(state: Arc<AppState>) {
    tokio::spawn(async move {
        let mut first_cycle = true;
        loop {
            for chain in CHAINS {
                match fetch_new_pools(&state, chain).await {
                    Ok(tokens) if !tokens.is_empty() => {
                        let fresh: Vec<SniperToken> = {
                            let mut seen =
                                state.sniper.seen.lock().unwrap_or_else(|e| e.into_inner());
                            if seen.len() > 5000 {
                                seen.clear();
                            }
                            tokens
                                .iter()
                                .filter(|t| seen.insert(t.pair_address.clone()))
                                .cloned()
                                .collect()
                        };
                        {
                            let mut latest = state
                                .sniper
                                .latest
                                .write()
                                .unwrap_or_else(|e| e.into_inner());
                            let entry = latest.entry(chain.key.to_string()).or_default();
                            let mut merged: Vec<SniperToken> = tokens.clone();
                            for old in entry.iter() {
                                if !merged.iter().any(|t| t.pair_address == old.pair_address) {
                                    merged.push(old.clone());
                                }
                            }
                            merged.sort_by_key(|t| std::cmp::Reverse(t.created_at));
                            merged.truncate(40);
                            *entry = merged;
                        }
                        state
                            .sniper
                            .updated_at
                            .write()
                            .unwrap_or_else(|e| e.into_inner())
                            .insert(chain.key.to_string(), Utc::now());
                        if !first_cycle && !fresh.is_empty() {
                            let _ = state.sniper.tx.send(
                                json!({ "type": "new_pairs", "chain": chain.key, "tokens": fresh })
                                    .to_string(),
                            );
                        }
                    }
                    Ok(_) => {}
                    Err(e) => tracing::warn!("new pools for {} failed: {e}", chain.key),
                }
                // GeckoTerminal's public limit is about 30 calls a minute.
                tokio::time::sleep(Duration::from_secs(3)).await;
            }
            first_cycle = false;
            tokio::time::sleep(Duration::from_secs(45)).await;
        }
    });
}

// ── HTTP handlers ────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct NewQuery {
    chain: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokensResponse {
    chain: String,
    tokens: Vec<SniperToken>,
    updated_at: Option<DateTime<Utc>>,
}

pub async fn get_new(
    State(state): State<Arc<AppState>>,
    Query(q): Query<NewQuery>,
) -> Result<Json<TokensResponse>> {
    let chain =
        chain_info(&q.chain).ok_or_else(|| AppError::BadRequest("unsupported chain".into()))?;
    if state.config.on_demand {
        // No poller here: fetch on request, shared and cached for a few seconds.
        let st = state.clone();
        let info = chain;
        let tokens = state
            .sniper
            .new_pools
            .get_or_fetch(chain.key, || async move {
                let tokens = fetch_new_pools(&st, &info).await?;
                st.sniper
                    .updated_at
                    .write()
                    .unwrap_or_else(|e| e.into_inner())
                    .insert(info.key.to_string(), Utc::now());
                Ok::<_, UpstreamError>(tokens)
            })
            .await?;
        let updated_at = state
            .sniper
            .updated_at
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .get(chain.key)
            .copied();
        return Ok(Json(TokensResponse {
            chain: chain.key.to_string(),
            tokens,
            updated_at,
        }));
    }
    let have = state
        .sniper
        .latest
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .get(chain.key)
        .cloned();
    let tokens = match have {
        Some(t) if !t.is_empty() => t,
        _ => {
            // Cold start: fetch once on demand so the first visitor does not see an empty page.
            let t = fetch_new_pools(&state, &chain).await?;
            state
                .sniper
                .latest
                .write()
                .unwrap_or_else(|e| e.into_inner())
                .insert(chain.key.to_string(), t.clone());
            state
                .sniper
                .updated_at
                .write()
                .unwrap_or_else(|e| e.into_inner())
                .insert(chain.key.to_string(), Utc::now());
            t
        }
    };
    let updated_at = state
        .sniper
        .updated_at
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .get(chain.key)
        .copied();
    Ok(Json(TokensResponse {
        chain: chain.key.to_string(),
        tokens,
        updated_at,
    }))
}

#[derive(Deserialize)]
pub struct SearchQuery {
    q: String,
    chain: Option<String>,
}

pub async fn search(
    State(state): State<Arc<AppState>>,
    Query(q): Query<SearchQuery>,
) -> Result<Json<Vec<SniperToken>>> {
    let term = q.q.trim().to_string();
    if term.is_empty() || term.len() > 64 || term.chars().any(|c| c.is_control()) {
        return Err(AppError::BadRequest(
            "enter a token name, symbol or contract address".into(),
        ));
    }
    let only = match q.chain.as_deref() {
        Some(c) if chain_info(c).is_some() => Some(c.to_string()),
        Some(_) => return Err(AppError::BadRequest("unsupported chain".into())),
        None => None,
    };
    let key = format!(
        "{}|{}",
        term.to_ascii_lowercase(),
        only.clone().unwrap_or_default()
    );
    let st = state.clone();
    let tokens = state
        .sniper
        .search
        .get_or_fetch(&key, || async move {
            let url = format!("{}/latest/dex/search", st.config.dexscreener_base);
            let v: Value = st
                .up
                .get_json_with("dexscreener", &url, &[("q", term)], &[])
                .await?;
            let mut t = parse_dexscreener(&v.to_string(), only.as_deref());
            t.truncate(8);
            Ok::<_, UpstreamError>(t)
        })
        .await?;
    Ok(Json(tokens))
}

#[derive(Deserialize)]
pub struct IdsQuery {
    ids: String,
}

/// Refreshes live prices for tracked tokens. `ids` is `chain:address` pairs separated by commas.
pub async fn refresh_tokens(
    State(state): State<Arc<AppState>>,
    Query(q): Query<IdsQuery>,
) -> Result<Json<Vec<SniperToken>>> {
    let mut by_chain: HashMap<String, Vec<String>> = HashMap::new();
    for item in q.ids.split(',').take(30) {
        let Some((chain, address)) = item.split_once(':') else {
            return Err(AppError::BadRequest(
                "ids must look like chain:address".into(),
            ));
        };
        if chain_info(chain).is_none() || !valid_address_for(chain, address) {
            return Err(AppError::BadRequest("invalid token id".into()));
        }
        by_chain
            .entry(chain.to_string())
            .or_default()
            .push(address.to_string());
    }
    let mut out: Vec<SniperToken> = Vec::new();
    for (chain, addresses) in by_chain {
        let key = format!("{chain}|{}", addresses.join(","));
        let st = state.clone();
        let only = chain.clone();
        let tokens = state
            .sniper
            .refresh
            .get_or_fetch(&key, || async move {
                let url = format!(
                    "{}/latest/dex/tokens/{}",
                    st.config.dexscreener_base,
                    addresses.join(",")
                );
                let v: Value = st.up.get_json("dexscreener", &url).await?;
                Ok::<_, UpstreamError>(parse_dexscreener(&v.to_string(), Some(&only)))
            })
            .await?;
        out.extend(tokens);
    }
    Ok(Json(out))
}

#[derive(Deserialize)]
pub struct SecurityQuery {
    chain: String,
    address: String,
}

pub async fn security(
    State(state): State<Arc<AppState>>,
    Query(q): Query<SecurityQuery>,
) -> Result<Json<Security>> {
    let chain =
        chain_info(&q.chain).ok_or_else(|| AppError::BadRequest("unsupported chain".into()))?;
    if !valid_address_for(chain.key, &q.address) {
        return Err(AppError::BadRequest("invalid contract address".into()));
    }
    let key = token_id(chain.key, &q.address);
    let st = state.clone();
    let address = q.address.clone();
    let result = state
        .sniper
        .security
        .get_or_fetch(&key, || async move {
            fetch_security(&st, &chain, &address).await
        })
        .await;
    // A failed risk lookup must never look like "safe": report it as unavailable.
    Ok(Json(result.unwrap_or_else(|_| Security::unavailable())))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn address_validation() {
        assert!(valid_evm_address(
            "0x6982508145454Ce325dDbE47a25d4ec3d2311933"
        ));
        assert!(!valid_evm_address("0x123"));
        assert!(!valid_evm_address(
            "6982508145454Ce325dDbE47a25d4ec3d2311933aa"
        ));
        assert!(valid_solana_address(
            "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"
        ));
        assert!(
            !valid_solana_address("0xDezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB26"),
            "0 is not base58"
        );
        assert!(!valid_solana_address("short"));
    }

    #[test]
    fn dexscreener_keeps_best_pool_per_token_and_filters_chain() {
        let raw = r#"{"pairs":[
          {"chainId":"ethereum","dexId":"uniswap","url":"https://dexscreener.com/ethereum/0xp1","pairAddress":"0xp1",
           "baseToken":{"address":"0xAAAAaaaaAAAAaaaaAAAAaaaaAAAAaaaaAAAAaaaa","name":"Alpha","symbol":"ALP"},
           "priceUsd":"0.5","txns":{"h24":{"buys":10,"sells":4}},"volume":{"h24":1234.5},
           "priceChange":{"m5":0.1,"h1":1.5,"h24":-3.0},"liquidity":{"usd":1000.0},"fdv":5000,"pairCreatedAt":1700000000000},
          {"chainId":"ethereum","dexId":"sushi","pairAddress":"0xp2",
           "baseToken":{"address":"0xAAAAaaaaAAAAaaaaAAAAaaaaAAAAaaaaAAAAaaaa","name":"Alpha","symbol":"ALP"},
           "priceUsd":"0.51","liquidity":{"usd":9000.0},"marketCap":7000},
          {"chainId":"solana","pairAddress":"s1","baseToken":{"address":"So11111111111111111111111111111111111111112","name":"Wrapped SOL","symbol":"SOL"},
           "priceUsd":"150","liquidity":{"usd":1}},
          {"chainId":"someotherchain","pairAddress":"x","baseToken":{"address":"0x1","name":"N","symbol":"N"},"priceUsd":"1"}
        ]}"#;
        let all = parse_dexscreener(raw, None);
        assert_eq!(
            all.len(),
            2,
            "unknown chains are dropped, duplicate token merged"
        );
        assert_eq!(all[0].symbol, "ALP");
        assert_eq!(all[0].pair_address, "0xp2", "most liquid pool wins");
        assert_eq!(all[0].market_cap_usd, 7000.0);
        assert_eq!(
            all[0].id,
            "ethereum:0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        );

        let eth = parse_dexscreener(raw, Some("ethereum"));
        assert_eq!(eth.len(), 1);
    }

    #[test]
    fn gecko_new_pools_parse() {
        let raw = r#"{"data":[{"id":"eth_0xpool","type":"pool","attributes":{"name":"MOON / WETH","address":"0xpool",
          "base_token_price_usd":"0.0012","pool_created_at":"2026-01-02T03:04:05Z","fdv_usd":"250000","market_cap_usd":null,
          "price_change_percentage":{"m5":"1.5","h1":"-2","h24":"30"},"transactions":{"h24":{"buys":12,"sells":3}},
          "volume_usd":{"h24":"4200.5"},"reserve_in_usd":"15000"},
          "relationships":{"base_token":{"data":{"id":"eth_0xtoken","type":"token"}},"dex":{"data":{"id":"uniswap_v2"}}}}],
          "included":[{"id":"eth_0xtoken","type":"token","attributes":{"address":"0xtoken","name":"Moon Coin","symbol":"MOON","image_url":"https://img/x.png"}}]}"#;
        let chain = chain_info("ethereum").unwrap();
        let t = parse_new_pools(raw, &chain);
        assert_eq!(t.len(), 1);
        assert_eq!(t[0].symbol, "MOON");
        assert_eq!(t[0].name, "Moon Coin");
        assert_eq!(t[0].address, "0xtoken");
        assert_eq!(t[0].liquidity_usd, 15000.0);
        assert_eq!(
            t[0].market_cap_usd, 250000.0,
            "falls back to FDV when market cap is null"
        );
        assert_eq!(t[0].change_24h, Some(30.0));
        assert_eq!(t[0].created_at, Some(1_767_323_045_000));
        assert_eq!(t[0].dex, "uniswap_v2");
        assert_eq!(t[0].image_url.as_deref(), Some("https://img/x.png"));
    }

    #[test]
    fn evm_risk_scoring() {
        let clean = json!({"is_honeypot":"0","buy_tax":"0","sell_tax":"0.01","is_open_source":"1","is_mintable":"0","holder_count":"5400"});
        let s = score_evm(&clean);
        assert_eq!(s.risk_level, "low");
        assert_eq!(s.sell_tax_pct, Some(1.0));
        assert!(s.flags.is_empty());

        let bad = json!({"is_honeypot":"1","buy_tax":"0.6","sell_tax":"0.99","is_open_source":"0","holder_count":"12"});
        let s = score_evm(&bad);
        assert_eq!(s.risk_level, "high");
        assert_eq!(s.risk_score, 100, "score is capped");
        assert_eq!(s.is_honeypot, Some(true));
        assert!(s.flags.iter().any(|f| f.contains("honeypot")));
        assert_eq!(s.sell_tax_pct, Some(99.0));

        // Missing fields must never look dangerous or safe by accident.
        let sparse = score_evm(&json!({}));
        assert_eq!(sparse.risk_score, 0);
        assert_eq!(sparse.buy_tax_pct, None);
    }

    #[test]
    fn solana_risk_scoring() {
        let s = score_solana(
            &json!({"mintable":{"status":"1"},"freezable":{"status":"1"},"closable":{"status":"0"},"holder_count":"900"}),
        );
        assert_eq!(s.risk_score, 50);
        assert_eq!(s.risk_level, "high");
        let ok = score_solana(
            &json!({"mintable":{"status":"0"},"freezable":{"status":"0"},"transfer_fee":{}}),
        );
        assert_eq!(ok.risk_level, "low");
    }
}
