//! Read only wallet balances straight from chain RPC, priced with live market data.
//!
//! Covers native balances and a curated set of tokens (stablecoins, wrapped
//! ETH, BNB and BTC) on Ethereum, BNB Chain, Base and Arbitrum, and every
//! token in a Solana wallet, named and priced with Jupiter's token list. DeFi positions and NFTs need an indexer and are not
//! included. Nothing here can move funds.

use std::{collections::HashMap, sync::Arc};

use axum::{
    extract::{Path, State},
    Json,
};
use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::{json, Value};

use crate::{
    error::{AppError, Result},
    indexers::{IndexedToken, Nft},
    sniper::{valid_evm_address, valid_solana_address},
    upstream::UpstreamError,
    whales::{price_of, rpc_url, PriceRef, CHAINS},
    AppState,
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Holding {
    pub chain: String,
    pub chain_name: String,
    pub symbol: String,
    pub name: String,
    pub kind: &'static str,
    pub amount: f64,
    pub price_usd: Option<f64>,
    pub value_usd: Option<f64>,
    pub change_24h: Option<f64>,
    /// The token contract or mint. Absent for a chain's native coin.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub address: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub decimals: Option<u8>,
    /// The exact balance in the token's smallest unit, so a swap can use all of it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw_amount: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logo: Option<String>,
    /// True when the token is on a verified list.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub verified: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortfolioResponse {
    pub address: String,
    pub kind: &'static str,
    pub holdings: Vec<Holding>,
    pub total_usd: f64,
    /// Small or unknown tokens counted but not listed.
    pub hidden_tokens: usize,
    /// True when some balances could not be read, so the total may be low.
    pub partial: bool,
    /// True when every token was looked for. False means only native coins
    /// and major tokens were checked (EVM without a wallet index).
    pub complete: bool,
    pub updated_at: DateTime<Utc>,
}

fn native_name(symbol: &str) -> &'static str {
    match symbol {
        "ETH" => "Ethereum",
        "BNB" => "BNB",
        "SOL" => "Solana",
        _ => "Native token",
    }
}

fn change_of(state: &AppState, price: PriceRef) -> Option<f64> {
    match price {
        PriceRef::Stable => Some(0.0),
        PriceRef::Ticker(sym) => state
            .binance
            .tickers
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .get(sym)
            .map(|t| t.change_24h_pct),
    }
}

#[allow(clippy::too_many_arguments)]
fn holding(
    state: &AppState,
    chain: &str,
    chain_name: &str,
    symbol: &str,
    name: &str,
    kind: &'static str,
    amount: f64,
    price: PriceRef,
) -> Holding {
    let price_usd = price_of(state, price);
    Holding {
        chain: chain.into(),
        chain_name: chain_name.into(),
        symbol: symbol.into(),
        name: name.into(),
        kind,
        amount,
        price_usd,
        value_usd: price_usd.map(|p| p * amount),
        change_24h: change_of(state, price),
        address: None,
        decimals: None,
        raw_amount: None,
        logo: None,
        verified: None,
    }
}

/// A hex quantity from an EVM RPC as an exact integer.
fn hex_to_u128(s: &str) -> Option<u128> {
    let s = s.strip_prefix("0x").unwrap_or(s);
    if s.is_empty() {
        return Some(0);
    }
    u128::from_str_radix(s, 16).ok()
}

/// `balanceOf(address)` calldata for a wallet.
pub fn balance_of_calldata(wallet: &str) -> String {
    format!(
        "0x70a08231{:0>64}",
        wallet.trim_start_matches("0x").to_ascii_lowercase()
    )
}

async fn evm_chain(
    state: &AppState,
    spec: &'static crate::whales::ChainSpec,
    wallet: &str,
) -> std::result::Result<Vec<Holding>, UpstreamError> {
    let url = rpc_url(state, spec.key);
    let mut batch =
        vec![json!({"jsonrpc":"2.0","id":0,"method":"eth_getBalance","params":[wallet,"latest"]})];
    for (i, t) in spec.tokens.iter().enumerate() {
        batch.push(json!({
            "jsonrpc":"2.0","id":i + 1,"method":"eth_call",
            "params":[{"to": t.address, "data": balance_of_calldata(wallet)}, "latest"]
        }));
    }
    let reply: Value = state
        .up
        .post_json(
            &format!("rpc-{}", spec.key),
            &url,
            &Value::Array(batch),
            &[],
            Some(std::time::Duration::from_secs(15)),
        )
        .await?;
    let entries = reply
        .as_array()
        .ok_or_else(|| UpstreamError::Parse("rpc batch".into()))?;
    let by_id: HashMap<u64, &Value> = entries
        .iter()
        .filter_map(|e| Some((e.get("id")?.as_u64()?, e)))
        .collect();
    let mut out = Vec::new();

    let native_raw = by_id
        .get(&0)
        .and_then(|e| e.get("result"))
        .and_then(|r| r.as_str())
        .and_then(hex_to_u128)
        .unwrap_or(0);
    if native_raw > 0 {
        let mut h = holding(
            state,
            spec.key,
            spec.name,
            spec.native,
            native_name(spec.native),
            "native",
            native_raw as f64 / 1e18,
            PriceRef::Ticker(spec.native_ticker),
        );
        h.decimals = Some(18);
        h.raw_amount = Some(native_raw.to_string());
        out.push(h);
    }
    for (i, t) in spec.tokens.iter().enumerate() {
        let raw = by_id
            .get(&((i + 1) as u64))
            .and_then(|e| e.get("result"))
            .and_then(|r| r.as_str())
            .and_then(hex_to_u128)
            .unwrap_or(0);
        if raw > 0 {
            let amount = raw as f64 / 10f64.powi(t.decimals);
            let mut h = holding(
                state, spec.key, spec.name, t.symbol, t.symbol, "token", amount, t.price,
            );
            h.address = Some(t.address.to_string());
            h.decimals = Some(t.decimals as u8);
            h.raw_amount = Some(raw.to_string());
            h.verified = Some(true);
            out.push(h);
        }
    }
    Ok(out)
}

/// The SPL token programs: classic and Token-2022.
const TOKEN_PROGRAMS: [&str; 2] = [
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
];
const SOL_MINT: &str = "So11111111111111111111111111111111111111112";
/// Free RPCs tried after the configured one. Single requests only: the public
/// Solana endpoint refuses batches from busy shared hosts with HTTP 429.
const SOLANA_FALLBACK_RPCS: &[&str] = &[
    "https://api.mainnet-beta.solana.com",
    "https://solana-rpc.publicnode.com",
];
/// Most tokens looked up for names and prices, and most listed.
const MAX_MINTS_PRICED: usize = 200;
const MAX_TOKENS_LISTED: usize = 50;
/// Tokens worth less than this are counted, not listed.
const DUST_USD: f64 = 0.01;

fn solana_rpcs(state: &AppState) -> Vec<String> {
    let mut out = vec![state.config.solana_rpc.clone()];
    for url in SOLANA_FALLBACK_RPCS {
        if !out.iter().any(|u| u == url) {
            out.push((*url).to_string());
        }
    }
    out
}

/// One JSON RPC call, tried on each endpoint in turn until one answers.
async fn solana_call(
    state: &AppState,
    method: &str,
    params: Value,
) -> std::result::Result<Value, UpstreamError> {
    let body = json!({"jsonrpc": "2.0", "id": 1, "method": method, "params": params});
    let mut last = UpstreamError::Network("no Solana RPC answered".into());
    for url in solana_rpcs(state) {
        match state
            .up
            .post_json::<Value>(
                "rpc-solana",
                &url,
                &body,
                &[],
                Some(std::time::Duration::from_secs(12)),
            )
            .await
        {
            Ok(reply) => match reply.get("result") {
                Some(result) => return Ok(result.clone()),
                None => {
                    let why = reply
                        .pointer("/error/message")
                        .and_then(|m| m.as_str())
                        .unwrap_or("no result");
                    last = UpstreamError::Parse(format!(
                        "{method}: {}",
                        crate::news::clean_text(why, 120)
                    ));
                }
            },
            Err(e) => last = e,
        }
    }
    Err(last)
}

/// A token's raw balance summed over the wallet's accounts for it.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct MintBalance {
    pub mint: String,
    pub raw: u128,
    pub decimals: u8,
}

/// Reads `getTokenAccountsByOwner` results (jsonParsed) into one balance per mint.
pub(crate) fn mint_balances(results: &[Value]) -> Vec<MintBalance> {
    let mut by_mint: HashMap<String, MintBalance> = HashMap::new();
    for result in results {
        let Some(accounts) = result.get("value").and_then(|v| v.as_array()) else {
            continue;
        };
        for acc in accounts {
            let Some(info) = acc.pointer("/account/data/parsed/info") else {
                continue;
            };
            let Some(mint) = info.get("mint").and_then(|m| m.as_str()) else {
                continue;
            };
            if !valid_solana_address(mint) {
                continue;
            }
            let amount = info.pointer("/tokenAmount/amount").and_then(|a| a.as_str());
            let decimals = info
                .pointer("/tokenAmount/decimals")
                .and_then(|d| d.as_u64());
            let (Some(raw), Some(decimals)) =
                (amount.and_then(|a| a.parse::<u128>().ok()), decimals)
            else {
                continue;
            };
            if raw == 0 || decimals > 30 {
                continue;
            }
            by_mint
                .entry(mint.to_string())
                .and_modify(|b| b.raw = b.raw.saturating_add(raw))
                .or_insert(MintBalance {
                    mint: mint.to_string(),
                    raw,
                    decimals: decimals as u8,
                });
        }
    }
    let mut out: Vec<MintBalance> = by_mint.into_values().collect();
    out.sort_by_key(|b| std::cmp::Reverse(b.raw));
    out
}

/// Name, symbol, logo and price of a Solana token, from Jupiter's token list.
#[derive(Debug, Clone, Default)]
pub(crate) struct TokenInfo {
    pub symbol: String,
    pub name: String,
    pub logo: Option<String>,
    pub price_usd: Option<f64>,
    pub change_24h: Option<f64>,
    pub verified: bool,
}

pub(crate) fn token_infos(reply: &Value) -> HashMap<String, TokenInfo> {
    let mut out = HashMap::new();
    for t in reply.as_array().map(|a| a.as_slice()).unwrap_or(&[]) {
        let Some(id) = t.get("id").and_then(|v| v.as_str()) else {
            continue;
        };
        let text = |k: &str, max: usize| {
            t.get(k)
                .and_then(|v| v.as_str())
                .map(|s| crate::news::clean_text(s, max))
                .unwrap_or_default()
        };
        let logo = t
            .get("icon")
            .and_then(|v| v.as_str())
            .filter(|u| u.starts_with("https://") && u.len() <= 300)
            .map(str::to_owned);
        let price = t
            .get("usdPrice")
            .and_then(|v| v.as_f64())
            .filter(|p| p.is_finite() && *p >= 0.0);
        out.insert(
            id.to_string(),
            TokenInfo {
                symbol: text("symbol", 16),
                name: text("name", 48),
                logo,
                price_usd: price,
                change_24h: t
                    .pointer("/stats24h/priceChange")
                    .and_then(|v| v.as_f64())
                    .filter(|c| c.is_finite()),
                verified: t.get("isVerified").and_then(|v| v.as_bool()) == Some(true),
            },
        );
    }
    out
}

/// Looks tokens up on Jupiter, 100 at a time. Missing data only means no price.
async fn jupiter_infos(state: &AppState, mints: &[String]) -> HashMap<String, TokenInfo> {
    let lookups = mints.chunks(100).map(|chunk| async move {
        let query = chunk.join(",");
        for base in [state.config.jupiter_base.as_str(), "https://api.jup.ag"] {
            let url = format!("{}/tokens/v2/search", base.trim_end_matches('/'));
            if let Ok(reply) = state
                .up
                .get_json_with::<Value>("jupiter-tokens", &url, &[("query", query.clone())], &[])
                .await
            {
                return token_infos(&reply);
            }
        }
        HashMap::new()
    });
    futures_util::future::join_all(lookups)
        .await
        .into_iter()
        .flatten()
        .collect()
}

fn ui_amount(raw: u128, decimals: u8) -> f64 {
    raw as f64 / 10f64.powi(decimals as i32)
}

/// Every token in a Solana wallet worth listing, valued in USD. Returns the
/// holdings, how many small or unknown tokens were left out, and whether the
/// token list could not be read (SOL alone is still shown then).
async fn solana_holdings(
    state: &AppState,
    wallet: &str,
) -> std::result::Result<(Vec<Holding>, usize, bool), UpstreamError> {
    let token_calls = TOKEN_PROGRAMS.iter().map(|program| {
        solana_call(
            state,
            "getTokenAccountsByOwner",
            json!([wallet, {"programId": program}, {"encoding": "jsonParsed", "commitment": "confirmed"}]),
        )
    });
    let (balance, tokens) = tokio::join!(
        solana_call(
            state,
            "getBalance",
            json!([wallet, {"commitment": "confirmed"}])
        ),
        futures_util::future::join_all(token_calls),
    );
    let lamports = balance?.get("value").and_then(|v| v.as_u64()).unwrap_or(0);
    let partial = tokens.iter().any(|r| r.is_err());
    let results: Vec<Value> = tokens.into_iter().filter_map(|r| r.ok()).collect();
    let mut balances = mint_balances(&results);
    balances.truncate(MAX_MINTS_PRICED);

    let mut lookup: Vec<String> = balances.iter().map(|b| b.mint.clone()).collect();
    lookup.push(SOL_MINT.to_string());
    let infos = jupiter_infos(state, &lookup).await;

    let mut out = Vec::new();
    if lamports > 0 {
        let mut h = holding(
            state,
            "solana",
            "Solana",
            "SOL",
            "Solana",
            "native",
            lamports as f64 / 1e9,
            PriceRef::Ticker("SOLUSDT"),
        );
        if h.price_usd.is_none() {
            if let Some(price) = infos.get(SOL_MINT).and_then(|i| i.price_usd) {
                h.price_usd = Some(price);
                h.value_usd = Some(price * h.amount);
            }
        }
        h.decimals = Some(9);
        h.raw_amount = Some(lamports.to_string());
        out.push(h);
    }

    let mut tokens: Vec<Holding> = Vec::new();
    let mut hidden = 0usize;
    for b in &balances {
        let info = infos.get(&b.mint);
        let amount = ui_amount(b.raw, b.decimals);
        let price = info.and_then(|i| i.price_usd);
        let value = price.map(|p| p * amount);
        // Airdropped spam has no price (often a famous name, such as a fake USDC);
        // an unpriced token is listed only when Jupiter has verified it. Dust is
        // not worth a line.
        let listable =
            info.is_some_and(|i| !i.symbol.is_empty() && (i.price_usd.is_some() || i.verified));
        if !listable || value.is_some_and(|v| v < DUST_USD) {
            hidden += 1;
            continue;
        }
        let info = info.cloned().unwrap_or_default();
        tokens.push(Holding {
            chain: "solana".into(),
            chain_name: "Solana".into(),
            symbol: info.symbol.clone(),
            name: if info.name.is_empty() {
                info.symbol.clone()
            } else {
                info.name.clone()
            },
            kind: "token",
            amount,
            price_usd: price,
            value_usd: value,
            change_24h: info.change_24h,
            address: Some(b.mint.clone()),
            decimals: Some(b.decimals),
            raw_amount: Some(b.raw.to_string()),
            logo: info.logo.clone(),
            verified: Some(info.verified),
        });
    }
    // Priced tokens first, by value; then known tokens without a price.
    tokens.sort_by(|a, b| {
        b.value_usd
            .unwrap_or(-1.0)
            .partial_cmp(&a.value_usd.unwrap_or(-1.0))
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    if tokens.len() > MAX_TOKENS_LISTED {
        hidden += tokens.len() - MAX_TOKENS_LISTED;
        tokens.truncate(MAX_TOKENS_LISTED);
    }
    out.extend(tokens);
    Ok((out, hidden, partial))
}

/// Turns indexed EVM tokens into holdings. Unpriced tokens (almost always
/// airdropped spam) and dust are counted, not listed.
pub(crate) fn indexed_holdings(
    state: &AppState,
    tokens: Vec<IndexedToken>,
) -> (Vec<Holding>, usize) {
    let mut out = Vec::new();
    let mut hidden = 0usize;
    for t in tokens {
        let amount = t.raw as f64 / 10f64.powi(t.decimals as i32);
        let mut price = t.price_usd;
        let mut change = None;
        if t.address.is_none() {
            // Native coins: the live exchange price when the indexer has none.
            let ticker = match t.symbol.as_str() {
                "ETH" => Some("ETHUSDT"),
                "BNB" => Some("BNBUSDT"),
                "POL" | "MATIC" => Some("POLUSDT"),
                "AVAX" => Some("AVAXUSDT"),
                _ => None,
            };
            if let Some(ticker) = ticker {
                price = price.or_else(|| price_of(state, PriceRef::Ticker(ticker)));
                change = change_of(state, PriceRef::Ticker(ticker));
            }
        }
        let value = price.map(|p| p * amount);
        if t.address.is_some() && (price.is_none() || value.is_some_and(|v| v < DUST_USD)) {
            hidden += 1;
            continue;
        }
        out.push(Holding {
            chain: t.chain.into(),
            chain_name: t.chain_name.into(),
            symbol: t.symbol,
            name: t.name,
            kind: if t.address.is_some() {
                "token"
            } else {
                "native"
            },
            amount,
            price_usd: price,
            value_usd: value,
            change_24h: change,
            address: t.address,
            decimals: Some(t.decimals),
            raw_amount: Some(t.raw.to_string()),
            logo: t.logo,
            verified: None,
        });
    }
    (out, hidden)
}

/// Native coins and major tokens through plain RPC, on the chains given.
async fn evm_by_rpc(
    state: &AppState,
    wallet: &str,
    only: Option<&[String]>,
) -> std::result::Result<(Vec<Holding>, bool), UpstreamError> {
    let specs: Vec<&'static crate::whales::ChainSpec> = CHAINS
        .iter()
        .filter(|s| only.is_none_or(|keys| keys.iter().any(|k| k == s.key)))
        .collect();
    if specs.is_empty() {
        return Ok((Vec::new(), false));
    }
    let results =
        futures_util::future::join_all(specs.iter().map(|spec| evm_chain(state, spec, wallet)))
            .await;
    let mut holdings = Vec::new();
    let mut last_err = None;
    let mut any_ok = false;
    for r in results {
        match r {
            Ok(h) => {
                any_ok = true;
                holdings.extend(h);
            }
            Err(e) => last_err = Some(e),
        }
    }
    if !any_ok {
        return Err(last_err.unwrap_or(UpstreamError::Network("no chain responded".into())));
    }
    Ok((holdings, last_err.is_some()))
}

pub async fn get_portfolio(
    State(state): State<Arc<AppState>>,
    Path(address): Path<String>,
) -> Result<Json<PortfolioResponse>> {
    let kind: &'static str = if valid_evm_address(&address) {
        "evm"
    } else if valid_solana_address(&address) {
        "solana"
    } else {
        return Err(AppError::BadRequest(
            "that does not look like a wallet address".into(),
        ));
    };
    let key = if kind == "evm" {
        address.to_ascii_lowercase()
    } else {
        address.clone()
    };
    // Balances are valued with live prices.
    crate::binance::ensure_tickers(&state).await;
    let st = state.clone();
    let addr = key.clone();
    let response = state
        .portfolio_cache
        .get_or_fetch(&key, || async move {
            let mut holdings: Vec<Holding>;
            let mut hidden_tokens = 0usize;
            let partial;
            let complete;
            if kind == "evm" {
                match crate::indexers::alchemy_tokens(&st, &addr).await {
                    Some(Ok((tokens, failed))) => {
                        let (h, hidden) = indexed_holdings(&st, tokens);
                        holdings = h;
                        hidden_tokens = hidden;
                        complete = failed.is_empty();
                        // Chains the index could not read fall back to plain RPC where it can.
                        let rpc_part = if failed.is_empty() {
                            false
                        } else {
                            match evm_by_rpc(&st, &addr, Some(&failed)).await {
                                Ok((h, part)) => {
                                    holdings.extend(h);
                                    part
                                }
                                Err(_) => true,
                            }
                        };
                        partial = rpc_part;
                    }
                    other => {
                        if let Some(Err(e)) = other {
                            tracing::warn!("wallet index unavailable, using RPC: {e}");
                        }
                        let (h, part) = evm_by_rpc(&st, &addr, None).await?;
                        holdings = h;
                        partial = part;
                        complete = false;
                    }
                }
            } else {
                let (h, hidden, part) = solana_holdings(&st, &addr).await?;
                holdings = h;
                hidden_tokens = hidden;
                partial = part;
                complete = !part;
            }
            holdings.sort_by(|a, b| {
                b.value_usd
                    .unwrap_or(0.0)
                    .partial_cmp(&a.value_usd.unwrap_or(0.0))
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
            let total_usd = holdings.iter().filter_map(|h| h.value_usd).sum();
            Ok::<_, UpstreamError>(PortfolioResponse {
                address: addr,
                kind,
                holdings,
                total_usd,
                hidden_tokens,
                partial,
                complete,
                updated_at: Utc::now(),
            })
        })
        .await?;
    Ok(Json(response))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NftsResponse {
    pub address: String,
    pub nfts: Vec<Nft>,
    /// False when NFTs on these chains cannot be listed (EVM without a wallet index).
    pub available: bool,
    pub updated_at: DateTime<Utc>,
}

/// NFTs in a wallet. Separate from balances because NFT indexes are slow, and
/// balances should never wait for pictures.
pub async fn get_nfts(
    State(state): State<Arc<AppState>>,
    Path(address): Path<String>,
) -> Result<Json<NftsResponse>> {
    let evm = valid_evm_address(&address);
    if !evm && !valid_solana_address(&address) {
        return Err(AppError::BadRequest(
            "that does not look like a wallet address".into(),
        ));
    }
    let key = if evm {
        address.to_ascii_lowercase()
    } else {
        address
    };
    let st = state.clone();
    let addr = key.clone();
    let response = state
        .nft_cache
        .get_or_fetch(&key, || async move {
            let (nfts, available) = if evm {
                (
                    crate::indexers::alchemy_nfts(&st, &addr).await,
                    st.config.alchemy_api_key.is_some(),
                )
            } else {
                (crate::indexers::solana_nfts(&st, &addr).await, true)
            };
            Ok::<_, UpstreamError>(NftsResponse {
                address: addr,
                nfts,
                available,
                updated_at: Utc::now(),
            })
        })
        .await?;
    Ok(Json(response))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn calldata_is_padded_and_lowercased() {
        let data = balance_of_calldata("0xAbCdEf0123456789aBcDeF0123456789AbCdEf01");
        assert_eq!(data.len(), 2 + 8 + 64);
        assert!(data.starts_with(
            "0x70a08231000000000000000000000000abcdef0123456789abcdef0123456789abcdef01"
        ));
    }
}
