//! Tools the AI assistant can call: the same sniper engine the Sniper page uses.
//!
//! The model asks for a tool by name with JSON input. Every input is checked
//! here exactly as an HTTP request would be (only registry chains and
//! launchpads, valid addresses, short queries), and every piece of text that
//! came from outside (token names, symbols) is cleaned before the model sees
//! it. Tool results are data for the model, never instructions.

use std::{sync::Arc, time::Duration};

use axum::{
    extract::{Path, Query, State},
    Json,
};
use chrono::Utc;
use serde::Serialize;
use serde_json::{json, Value};

use crate::{
    ai::sanitize,
    binance,
    launchpad::{self, launchpads_for, FeedToken},
    market, news, portfolio,
    sniper::{self, chain_info, valid_address_for, Security, SniperToken, CHAINS},
    stocks, whales, AppState,
};

/// Chart intervals the price history tool offers.
const INTERVALS: [&str; 4] = ["15m", "1h", "4h", "1d"];
/// Chains the whale tracker watches.
const WHALE_CHAINS: [&str; 6] = ["bitcoin", "ethereum", "bsc", "base", "arbitrum", "solana"];

/// Any API answer as JSON, with heavy fields (images, sparklines, long
/// histories) dropped and every string cleaned and shortened, because much of
/// it comes from outside (names, headlines).
fn clean<T: Serialize>(value: &T, drop: &[&str]) -> Value {
    fn walk(v: Value, drop: &[&str]) -> Value {
        match v {
            Value::String(s) => Value::String(sanitize(&s, 280)),
            Value::Array(items) => Value::Array(items.into_iter().map(|i| walk(i, drop)).collect()),
            Value::Object(map) => Value::Object(
                map.into_iter()
                    .filter(|(k, _)| !drop.contains(&k.as_str()))
                    .map(|(k, v)| (k, walk(v, drop)))
                    .collect(),
            ),
            other => other,
        }
    }
    walk(serde_json::to_value(value).unwrap_or(Value::Null), drop)
}

/// "btc", "BTC" and "BTCUSDT" all mean the Binance pair BTCUSDT.
fn pair(symbol: &str) -> String {
    let s = symbol.trim().to_ascii_uppercase();
    if s.ends_with("USDT") {
        s
    } else {
        format!("{s}USDT")
    }
}

/// Tokens returned by one feed call at most, so a tool result stays small.
const MAX_FEED_TOKENS: usize = 15;
/// Full checks one feed call may run on its top unchecked candidates.
const CHECKS_PUBLIC: usize = 3;
const CHECKS_KEYED: usize = 6;
/// The longest the checks may take, leaving room for the model to answer.
const CHECK_TIME: Duration = Duration::from_secs(18);

fn round(v: f64, places: i32) -> f64 {
    let f = 10f64.powi(places);
    (v * f).round() / f
}

fn age_hours(created_at: Option<i64>, now_ms: i64) -> Option<f64> {
    created_at.map(|t| round(((now_ms - t).max(0)) as f64 / 3_600_000.0, 1))
}

fn risk_view(s: &Security) -> Value {
    if !s.available {
        return json!({ "available": false });
    }
    json!({
        "available": true,
        "level": s.risk_level,
        "score": s.risk_score,
        "honeypot": s.is_honeypot,
        "buyTaxPct": s.buy_tax_pct,
        "sellTaxPct": s.sell_tax_pct,
        "flags": s.flags.iter().take(5).map(|f| sanitize(f, 80)).collect::<Vec<_>>(),
    })
}

/// One feed token, trimmed to what helps the model judge it.
pub fn feed_token_view(t: &FeedToken, now_ms: i64) -> Value {
    json!({
        "symbol": sanitize(&t.symbol, 20),
        "name": sanitize(&t.name, 48),
        "address": t.address,
        "launchpad": t.launchpad,
        "ageHours": age_hours(t.created_at, now_ms),
        "priceUsd": t.price_usd,
        "marketCapUsd": round(t.market_cap_usd, 0),
        "liquidityUsd": if t.on_curve { Value::from("bonding curve") } else { Value::from(round(t.liquidity_usd, 0)) },
        "bondingCurvePct": t.graduation.map(|g| round(g.percent, 0)),
        "graduated": t.graduation.map(|g| g.completed),
        "volume24hUsd": round(t.volume_24h_usd, 0),
        "change1hPct": t.change_1h.map(|v| round(v, 1)),
        "buyRatioPct": t.buy_ratio_pct,
        "buyersLastHour": t.flow_1h.buyers,
        "sellersLastHour": t.flow_1h.sellers,
        "holders": t.holders,
        "top10HoldersPct": t.top10_pct,
        "snipeScore": {
            "total": t.score.total,
            "grade": t.score.grade,
            "fullyChecked": t.score.checked,
            "blocked": t.score.blocked,
            "reasons": t.score.reasons.iter().take(3).map(|r| sanitize(r, 120)).collect::<Vec<_>>(),
            "warnings": t.score.warnings.iter().take(3).map(|w| sanitize(w, 120)).collect::<Vec<_>>(),
        },
        "developer": t.developer.as_ref().map(|d| json!({
            "wallet": d.address,
            "holdingPct": d.holding_pct,
            "earlierLaunchesSeen": d.record.launches_seen,
            "earlierSuccesses": d.record.successes,
            "successRatePct": d.record.success_rate,
            "verdict": d.verdict,
        })),
        "contractRisk": t.security.as_ref().map(risk_view),
        "chart": t.url,
    })
}

fn search_token_view(t: &SniperToken, now_ms: i64) -> Value {
    json!({
        "symbol": sanitize(&t.symbol, 20),
        "name": sanitize(&t.name, 48),
        "chain": t.chain,
        "address": t.address,
        "dex": sanitize(&t.dex, 32),
        "priceUsd": t.price_usd,
        "liquidityUsd": round(t.liquidity_usd, 0),
        "marketCapUsd": round(t.market_cap_usd, 0),
        "volume24hUsd": round(t.volume_24h_usd, 0),
        "change24hPct": t.change_24h.map(|v| round(v, 1)),
        "buys24h": t.buys_24h,
        "sells24h": t.sells_24h,
        "ageHours": age_hours(t.created_at, now_ms),
        "chart": t.url,
    })
}

/// The launchpads the feed tool accepts, for its description.
fn launchpad_catalog() -> String {
    CHAINS
        .iter()
        .filter_map(|c| {
            let pads = launchpads_for(c.key);
            (!pads.is_empty()).then(|| {
                let list: Vec<String> = pads
                    .iter()
                    .map(|l| format!("{} ({})", l.id, l.name))
                    .collect();
                format!("{}: {}", c.key, list.join(", "))
            })
        })
        .collect::<Vec<_>>()
        .join("; ")
}

/// The tool definitions sent with every chat request.
pub fn definitions() -> Value {
    let chains: Vec<&str> = CHAINS.iter().map(|c| c.key).collect();
    json!([
        {
            "name": "launchpad_feed",
            "description": format!(
                "Arctos sniper engine. Lists tokens on a chain's launchpads, best first, each with a snipe score from 0 to 100 \
    built from live data: real buys and sells and how many wallets are buying (demand), the launch wallet's share of supply and its record on \
    earlier launches (developer), mint and freeze authority, honeypot and tax checks (safety), liquidity or bonding curve progress, and momentum. \
    fullyChecked false means the developer and contract checks have not run yet for that token. blocked true means a serious risk was found. \
    Use view \"new\" for the newest launches and \"active\" for the busiest tokens right now. Launchpad ids: {}. Use \"all\" for every new pool on the chain.",
                launchpad_catalog()
            ),
            "input_schema": {
                "type": "object",
                "properties": {
                    "chain": { "type": "string", "enum": chains, "description": "Chain key. Pump.fun is on solana." },
                    "launchpad": { "type": "string", "description": "A launchpad id from the list, or \"all\"." },
                    "view": { "type": "string", "enum": ["new", "active"] },
                    "limit": { "type": "integer", "minimum": 1, "maximum": MAX_FEED_TOKENS },
                    "fully_checked_only": { "type": "boolean", "description": "Only tokens whose developer and contract checks have run." },
                    "max_age_hours": { "type": "number", "description": "Only tokens launched within this many hours, for example 24 for today." }
                },
                "required": ["chain"],
                "additionalProperties": false
            }
        },
        {
            "name": "search_tokens",
            "description": "Finds tokens by name, symbol or contract address across DEX pools, with live price, liquidity, volume and trade counts.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Name, symbol or contract address, up to 64 characters." },
                    "chain": { "type": "string", "enum": chains }
                },
                "required": ["query"],
                "additionalProperties": false
            }
        },
        {
            "name": "market_overview",
            "description": "The whole crypto market now: total market cap and its 24 hour change, volume, BTC and ETH dominance, the Fear and Greed index with its last week, and the altcoin season index.",
            "input_schema": { "type": "object", "properties": {}, "additionalProperties": false }
        },
        {
            "name": "coin_lookup",
            "description": "The top 100 coins by market cap: rank, price, market cap, 24 hour volume, 24 hour high and low, and 24 hour, 7 day and 30 day change. Give a symbol or name to find one, or leave query empty for the top coins by rank.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Symbol, name or id, for example SOL or solana." },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 20 }
                },
                "additionalProperties": false
            }
        },
        {
            "name": "price_history",
            "description": "Recent candles for a coin traded against USDT on Binance, summarised: change over the period, high, low, average volume and the last closes. Use it for trend, support and resistance questions.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "symbol": { "type": "string", "description": "Coin symbol such as BTC, ETH or SOL." },
                    "interval": { "type": "string", "enum": INTERVALS },
                    "candles": { "type": "integer", "minimum": 10, "maximum": 200 }
                },
                "required": ["symbol"],
                "additionalProperties": false
            }
        },
        {
            "name": "order_book",
            "description": "The live Binance order book for a coin against USDT: best bid and ask, spread, and how much money waits on each side near the price.",
            "input_schema": {
                "type": "object",
                "properties": { "symbol": { "type": "string", "description": "Coin symbol such as BTC." } },
                "required": ["symbol"],
                "additionalProperties": false
            }
        },
        {
            "name": "whale_activity",
            "description": "Recent large transfers seen on chain (whale alerts), with value, asset, direction (into or out of exchanges, or wallet to wallet) and totals. Filter by chain and minimum value.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "chain": { "type": "string", "enum": WHALE_CHAINS },
                    "min_usd": { "type": "number", "minimum": 0 },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 25 }
                },
                "additionalProperties": false
            }
        },
        {
            "name": "news_search",
            "description": "Recent crypto headlines from the news feeds Arctos follows, with source, category, expected market impact and time. Give a keyword (a coin, a company, a topic such as ETF or hack) to filter, or leave it empty for the latest.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "query": { "type": "string" },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 12 }
                },
                "additionalProperties": false
            }
        },
        {
            "name": "stock_quotes",
            "description": "Live quotes for listed stocks, by default the crypto related watchlist (COIN, MSTR, HOOD and others): price, change and exchange.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "symbols": { "type": "array", "items": { "type": "string" }, "maxItems": 12, "description": "Ticker symbols such as COIN or NVDA." }
                },
                "additionalProperties": false
            }
        },
        {
            "name": "wallet_holdings",
            "description": "What a public wallet address holds right now (EVM chains or Solana): coins and major tokens with their value. Only use an address the user gave you.",
            "input_schema": {
                "type": "object",
                "properties": { "address": { "type": "string" } },
                "required": ["address"],
                "additionalProperties": false
            }
        },
        {
            "name": "contract_risk",
            "description": "Contract risk check for one token (GoPlus): honeypot flag, buy and sell tax, mint or freeze authority and other red flags, with a risk score where lower is safer.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "chain": { "type": "string", "enum": chains },
                    "address": { "type": "string", "description": "The token's contract address." }
                },
                "required": ["chain", "address"],
                "additionalProperties": false
            }
        }
    ])
}

fn text_field<'a>(input: &'a Value, key: &str) -> Option<&'a str> {
    input
        .get(key)
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
}

/// Runs one tool call within `time_left`. Returns the result, or an error
/// message the model can read and correct itself from.
pub async fn run(
    state: &Arc<AppState>,
    name: &str,
    input: &Value,
    time_left: Duration,
) -> Result<Value, String> {
    let now_ms = Utc::now().timestamp_millis();
    match name {
        "launchpad_feed" => {
            let chain = text_field(input, "chain").unwrap_or("solana");
            let pad = text_field(input, "launchpad").unwrap_or("all");
            let view = text_field(input, "view").unwrap_or("new");
            let limit = input
                .get("limit")
                .and_then(|v| v.as_u64())
                .map_or(10, |n| n as usize)
                .clamp(1, MAX_FEED_TOKENS);
            let checked_only = input
                .get("fully_checked_only")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let max_age_hours = input
                .get("max_age_hours")
                .and_then(|v| v.as_f64())
                .filter(|h| h.is_finite() && *h > 0.0);
            let young_enough = |t: &FeedToken| match (max_age_hours, t.created_at) {
                (Some(max), Some(at)) => ((now_ms - at) as f64) / 3_600_000.0 <= max,
                (Some(_), None) => false,
                (None, _) => true,
            };
            let mut feed = launchpad::feed(state, chain, Some(pad), Some(view))
                .await
                .map_err(|e| e.to_string())?;
            // Check the best candidates that have not been checked yet, then
            // score the same tokens again, so the answer rests on as much as possible.
            let candidates: Vec<String> = feed
                .tokens
                .iter()
                .filter(|t| !t.score.checked && !t.score.blocked && young_enough(t))
                .take(limit)
                .map(|t| t.address.clone())
                .collect();
            let room = CHECK_TIME.min(time_left.saturating_sub(Duration::from_secs(20)));
            let max_checks = if state.config.coingecko_api_key.is_some() {
                CHECKS_KEYED
            } else {
                CHECKS_PUBLIC
            };
            let checked_now = if candidates.is_empty() || room < Duration::from_secs(4) {
                0
            } else {
                launchpad::check_now(state, chain, &candidates, max_checks, room).await
            };
            if checked_now > 0 {
                if let Ok(fresh) =
                    launchpad::rescore_feed(state, chain, Some(pad), Some(view)).await
                {
                    feed = fresh;
                }
            }
            let fully_checked = feed.tokens.iter().filter(|t| t.score.checked).count();
            // Fully checked tokens first, each group best score first.
            let mut picked: Vec<&FeedToken> = feed
                .tokens
                .iter()
                .filter(|t| (!checked_only || t.score.checked) && young_enough(t))
                .collect();
            picked.sort_by(|a, b| {
                b.score
                    .checked
                    .cmp(&a.score.checked)
                    .then(b.score.total.cmp(&a.score.total))
            });
            let tokens: Vec<Value> = picked
                .into_iter()
                .take(limit)
                .map(|t| feed_token_view(t, now_ms))
                .collect();
            Ok(json!({
                "chain": feed.chain,
                "launchpad": feed.launchpad,
                "view": feed.view,
                "tokensInFeed": feed.tokens.len(),
                "fullyChecked": fully_checked,
                "checkedJustNow": checked_now,
                "developersOnRecord": feed.developers_known,
                "updatedAt": feed.updated_at,
                "note": "The top candidates were checked just now where time allowed. Checks run a few tokens at a time because the data provider limits calls. Tokens that are not fully checked still carry live demand, curve and age data. A developer's record covers launches Arctos has observed.",
                "tokens": tokens,
            }))
        }
        "search_tokens" => {
            let query = text_field(input, "query").ok_or("query is required")?;
            let chain = text_field(input, "chain");
            let found = sniper::search_tokens(state, query, chain)
                .await
                .map_err(|e| e.to_string())?;
            Ok(json!({
                "tokens": found.iter().map(|t| search_token_view(t, now_ms)).collect::<Vec<_>>(),
            }))
        }
        "contract_risk" => {
            let chain_key = text_field(input, "chain").ok_or("chain is required")?;
            let address = text_field(input, "address").ok_or("address is required")?;
            let chain = chain_info(chain_key).ok_or("unsupported chain")?;
            if !valid_address_for(chain.key, address) {
                return Err("that is not a valid contract address for this chain".into());
            }
            let security = sniper::security_for(state, chain, address).await;
            Ok(risk_view(&security))
        }
        "market_overview" => {
            let Json(overview) = market::get_overview(State(state.clone())).await;
            let mut v = clean(&overview, &["marketCapTrend"]);
            if let Some(history) = v
                .pointer_mut("/fearGreed/history")
                .and_then(|h| h.as_array_mut())
            {
                history.truncate(7);
            }
            Ok(v)
        }
        "coin_lookup" => {
            let query = text_field(input, "query").map(|q| q.to_ascii_lowercase());
            let limit = input
                .get("limit")
                .and_then(|v| v.as_u64())
                .map_or(10, |n| n as usize)
                .clamp(1, 20);
            let Json(list) = market::get_coins(
                State(state.clone()),
                Query(market::CoinsQuery { limit: Some(100) }),
            )
            .await
            .map_err(|e| e.to_string())?;
            let mut coins: Vec<&market::Coin> = list
                .coins
                .iter()
                .filter(|c| match &query {
                    None => true,
                    Some(q) => {
                        c.symbol.eq_ignore_ascii_case(q)
                            || c.id == *q
                            || c.name.to_ascii_lowercase().contains(q.as_str())
                    }
                })
                .collect();
            // An exact symbol match comes first.
            if let Some(q) = &query {
                coins.sort_by_key(|c| !c.symbol.eq_ignore_ascii_case(q));
            }
            let found: Vec<Value> = coins
                .into_iter()
                .take(limit)
                .map(|c| clean(c, &["image", "sparkline7d"]))
                .collect();
            let note = if found.is_empty() {
                "Not in the top 100 by market cap. Try search_tokens for smaller tokens."
            } else {
                ""
            };
            Ok(json!({ "coins": found, "note": note }))
        }
        "price_history" => {
            let symbol = pair(text_field(input, "symbol").ok_or("symbol is required")?);
            let interval = text_field(input, "interval").unwrap_or("1h");
            if !INTERVALS.contains(&interval) {
                return Err("interval must be 15m, 1h, 4h or 1d".into());
            }
            let count = input
                .get("candles")
                .and_then(|v| v.as_u64())
                .map_or(48, |n| n as u32)
                .clamp(10, 200);
            let Json(candles) = binance::get_klines(
                State(state.clone()),
                Query(binance::KlinesQuery {
                    symbol: symbol.clone(),
                    interval: Some(interval.into()),
                    limit: Some(count),
                }),
            )
            .await
            .map_err(|e| format!("{e}. The coin may not trade against USDT on Binance."))?;
            let (Some(first), Some(last)) = (candles.first(), candles.last()) else {
                return Err("no candles came back for that coin".into());
            };
            let high = candles.iter().map(|c| c.h).fold(f64::MIN, f64::max);
            let low = candles.iter().map(|c| c.l).fold(f64::MAX, f64::min);
            let avg_volume = candles.iter().map(|c| c.v).sum::<f64>() / candles.len() as f64;
            let closes: Vec<f64> = candles.iter().rev().take(12).rev().map(|c| c.c).collect();
            Ok(json!({
                "pair": symbol,
                "interval": interval,
                "candles": candles.len(),
                "from": chrono::DateTime::from_timestamp_millis(first.t),
                "to": chrono::DateTime::from_timestamp_millis(last.t),
                "open": first.o,
                "lastClose": last.c,
                "changePct": round((last.c / first.o - 1.0) * 100.0, 2),
                "high": high,
                "low": low,
                "averageVolume": round(avg_volume, 2),
                "lastCloses": closes,
            }))
        }
        "order_book" => {
            let symbol = pair(text_field(input, "symbol").ok_or("symbol is required")?);
            let Json(book) = binance::get_depth(
                State(state.clone()),
                Query(binance::DepthQuery {
                    symbol: symbol.clone(),
                    limit: Some(20),
                }),
            )
            .await
            .map_err(|e| format!("{e}. The coin may not trade against USDT on Binance."))?;
            let (Some(bid), Some(ask)) = (book.bids.first(), book.asks.first()) else {
                return Err("the order book came back empty".into());
            };
            let bid_usd: f64 = book.bids.iter().map(|[p, q]| p * q).sum();
            let ask_usd: f64 = book.asks.iter().map(|[p, q]| p * q).sum();
            Ok(json!({
                "pair": symbol,
                "bestBid": bid[0],
                "bestAsk": ask[0],
                "spreadPct": round((ask[0] - bid[0]) / ask[0] * 100.0, 4),
                "bidsUsdTop20": round(bid_usd, 0),
                "asksUsdTop20": round(ask_usd, 0),
                "buySidePct": round(bid_usd / (bid_usd + ask_usd).max(1e-9) * 100.0, 1),
            }))
        }
        "whale_activity" => {
            let chain = text_field(input, "chain");
            if chain.is_some_and(|c| !WHALE_CHAINS.contains(&c)) {
                return Err("unsupported chain for whale alerts".into());
            }
            let limit = input
                .get("limit")
                .and_then(|v| v.as_u64())
                .map_or(15, |n| n as usize)
                .clamp(1, 25);
            let Json(found) = whales::get_whales(
                State(state.clone()),
                Query(whales::WhaleQuery {
                    min_usd: input
                        .get("min_usd")
                        .and_then(|v| v.as_f64())
                        .filter(|v| v.is_finite()),
                    chain: chain.map(str::to_string),
                    address: None,
                    limit: Some(limit),
                }),
            )
            .await
            .map_err(|e| e.to_string())?;
            Ok(clean(&found, &["explorerUrl", "txHash", "block"]))
        }
        "news_search" => {
            let query = text_field(input, "query").map(|q| q.to_ascii_lowercase());
            if query.as_ref().is_some_and(|q| q.len() > 64) {
                return Err("keep the keyword under 64 characters".into());
            }
            let limit = input
                .get("limit")
                .and_then(|v| v.as_u64())
                .map_or(8, |n| n as usize)
                .clamp(1, 12);
            let Json(feed) = news::get_news(
                State(state.clone()),
                Query(news::NewsQuery { limit: Some(150) }),
            )
            .await;
            let all = clean(&feed, &["imageUrl", "feeds", "color"]);
            let articles: Vec<Value> = all["articles"]
                .as_array()
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .filter(|a| match &query {
                    None => true,
                    Some(q) => [a["title"].as_str(), a["excerpt"].as_str()]
                        .into_iter()
                        .flatten()
                        .any(|t| t.to_ascii_lowercase().contains(q.as_str())),
                })
                .take(limit)
                .collect();
            Ok(json!({ "articles": articles, "fetchedAt": all["fetchedAt"] }))
        }
        "stock_quotes" => {
            let symbols: Option<String> =
                input.get("symbols").and_then(|v| v.as_array()).map(|list| {
                    list.iter()
                        .filter_map(|s| s.as_str())
                        .take(12)
                        .map(|s| s.trim().to_ascii_uppercase())
                        .collect::<Vec<_>>()
                        .join(",")
                });
            let Json(quotes) =
                stocks::get_quotes(State(state.clone()), Query(stocks::StocksQuery { symbols }))
                    .await
                    .map_err(|e| e.to_string())?;
            Ok(clean(&quotes, &["sparkline"]))
        }
        "wallet_holdings" => {
            let address = text_field(input, "address").ok_or("address is required")?;
            let Json(holdings) =
                portfolio::get_portfolio(State(state.clone()), Path(address.to_string()))
                    .await
                    .map_err(|e| e.to_string())?;
            // Logos and exact base unit amounts help the swap panel, not the assistant.
            Ok(clean(&holdings, &["logo", "rawAmount"]))
        }
        other => Err(format!("there is no tool called {}", sanitize(other, 40))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_tool_has_a_closed_schema() {
        let defs = definitions();
        let names: Vec<&str> = defs
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["name"].as_str().unwrap())
            .collect();
        assert_eq!(
            names,
            [
                "launchpad_feed",
                "search_tokens",
                "market_overview",
                "coin_lookup",
                "price_history",
                "order_book",
                "whale_activity",
                "news_search",
                "stock_quotes",
                "wallet_holdings",
                "contract_risk"
            ]
        );
        for t in defs.as_array().unwrap() {
            assert_eq!(t["input_schema"]["additionalProperties"], false);
            assert!(t["description"].as_str().unwrap().len() > 40);
        }
        let feed = &defs[0]["description"].as_str().unwrap();
        assert!(feed.contains("pump-fun (Pump.fun)"), "{feed}");
        assert!(feed.contains("four-meme"), "{feed}");
    }

    #[test]
    fn symbols_become_usdt_pairs() {
        assert_eq!(pair("btc"), "BTCUSDT");
        assert_eq!(pair(" ETHUSDT "), "ETHUSDT");
    }

    #[test]
    fn outside_text_is_cleaned_and_heavy_fields_dropped() {
        let raw = json!({"title": "Big <b>news</b>\nnow", "imageUrl": "https://x", "items": [{"sparkline": [1, 2], "name": "a\u{7}b"}]});
        let v = clean(&raw, &["imageUrl", "sparkline"]);
        assert_eq!(
            v,
            json!({"title": "Big b news /b now", "items": [{"name": "a b"}]})
        );
    }

    #[test]
    fn ages_are_in_hours_and_never_negative() {
        let now = 10 * 3_600_000;
        assert_eq!(age_hours(Some(now - 5_400_000), now), Some(1.5));
        assert_eq!(age_hours(Some(now + 60_000), now), Some(0.0));
        assert_eq!(age_hours(None, now), None);
    }
}
