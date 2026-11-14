//! Read only wallet balances straight from chain RPC, priced with live market data.
//!
//! Covers native balances and a curated set of tokens (stablecoins, wrapped
//! ETH, BNB and BTC) on Ethereum, BNB Chain, Base and Arbitrum, plus SOL and
//! USDC/USDT on Solana. DeFi positions and NFTs need an indexer and are not
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
    sniper::{valid_evm_address, valid_solana_address},
    upstream::UpstreamError,
    whales::{hex_to_f64, price_of, rpc_url, PriceRef, CHAINS},
    AppState,
};

const SOL_USDC: &str = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL_USDT: &str = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

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
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortfolioResponse {
    pub address: String,
    pub kind: &'static str,
    pub holdings: Vec<Holding>,
    pub total_usd: f64,
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
    }
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

    let native_amount = by_id
        .get(&0)
        .and_then(|e| e.get("result"))
        .and_then(|r| r.as_str())
        .and_then(hex_to_f64)
        .unwrap_or(0.0)
        / 1e18;
    if native_amount > 0.0 {
        out.push(holding(
            state,
            spec.key,
            spec.name,
            spec.native,
            native_name(spec.native),
            "native",
            native_amount,
            PriceRef::Ticker(spec.native_ticker),
        ));
    }
    for (i, t) in spec.tokens.iter().enumerate() {
        let raw = by_id
            .get(&((i + 1) as u64))
            .and_then(|e| e.get("result"))
            .and_then(|r| r.as_str())
            .and_then(hex_to_f64)
            .unwrap_or(0.0);
        let amount = raw / 10f64.powi(t.decimals);
        if amount > 0.0 {
            out.push(holding(
                state, spec.key, spec.name, t.symbol, t.symbol, "token", amount, t.price,
            ));
        }
    }
    Ok(out)
}

async fn solana_holdings(
    state: &AppState,
    wallet: &str,
) -> std::result::Result<Vec<Holding>, UpstreamError> {
    let batch = json!([
        {"jsonrpc":"2.0","id":0,"method":"getBalance","params":[wallet]},
        {"jsonrpc":"2.0","id":1,"method":"getTokenAccountsByOwner","params":[wallet,{"mint":SOL_USDC},{"encoding":"jsonParsed"}]},
        {"jsonrpc":"2.0","id":2,"method":"getTokenAccountsByOwner","params":[wallet,{"mint":SOL_USDT},{"encoding":"jsonParsed"}]},
    ]);
    let reply: Value = state
        .up
        .post_json(
            "rpc-solana",
            &state.config.solana_rpc,
            &batch,
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

    let lamports = by_id
        .get(&0)
        .and_then(|e| e.get("result"))
        .and_then(|r| r.get("value"))
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    if lamports > 0.0 {
        out.push(holding(
            state,
            "solana",
            "Solana",
            "SOL",
            "Solana",
            "native",
            lamports / 1e9,
            PriceRef::Ticker("SOLUSDT"),
        ));
    }
    for (id, symbol) in [(1u64, "USDC"), (2u64, "USDT")] {
        let total: f64 = by_id
            .get(&id)
            .and_then(|e| e.get("result"))
            .and_then(|r| r.get("value"))
            .and_then(|v| v.as_array())
            .map(|accounts| {
                accounts
                    .iter()
                    .filter_map(|a| {
                        a.pointer("/account/data/parsed/info/tokenAmount/uiAmount")
                            .and_then(|x| x.as_f64())
                    })
                    .sum()
            })
            .unwrap_or(0.0);
        if total > 0.0 {
            out.push(holding(
                state,
                "solana",
                "Solana",
                symbol,
                symbol,
                "token",
                total,
                PriceRef::Stable,
            ));
        }
    }
    Ok(out)
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
            let mut holdings: Vec<Holding> = Vec::new();
            if kind == "evm" {
                let tasks = CHAINS.iter().map(|spec| {
                    let st = st.clone();
                    let addr = addr.clone();
                    async move { evm_chain(&st, spec, &addr).await }
                });
                let results = futures_util::future::join_all(tasks).await;
                let mut any_ok = false;
                let mut last_err: Option<UpstreamError> = None;
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
                    return Err(
                        last_err.unwrap_or(UpstreamError::Network("no chain responded".into()))
                    );
                }
            } else {
                holdings = solana_holdings(&st, &addr).await?;
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
