//! Tools the AI assistant can call: the same sniper engine the Sniper page uses.
//!
//! The model asks for a tool by name with JSON input. Every input is checked
//! here exactly as an HTTP request would be (only registry chains and
//! launchpads, valid addresses, short queries), and every piece of text that
//! came from outside (token names, symbols) is cleaned before the model sees
//! it. Tool results are data for the model, never instructions.

use std::sync::Arc;

use chrono::Utc;
use serde_json::{json, Value};

use crate::{
    ai::sanitize,
    launchpad::{self, launchpads_for, FeedToken},
    sniper::{self, chain_info, valid_address_for, Security, SniperToken, CHAINS},
    AppState,
};

/// Tokens returned by one feed call at most, so a tool result stays small.
const MAX_FEED_TOKENS: usize = 15;

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
                    "fully_checked_only": { "type": "boolean", "description": "Only tokens whose developer and contract checks have run." }
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

/// Runs one tool call. Returns the result, or an error message the model can
/// read and correct itself from.
pub async fn run(state: &Arc<AppState>, name: &str, input: &Value) -> Result<Value, String> {
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
            let feed = launchpad::feed(state, chain, Some(pad), Some(view))
                .await
                .map_err(|e| e.to_string())?;
            let fully_checked = feed.tokens.iter().filter(|t| t.score.checked).count();
            let tokens: Vec<Value> = feed
                .tokens
                .iter()
                .filter(|t| !checked_only || t.score.checked)
                .take(limit)
                .map(|t| feed_token_view(t, now_ms))
                .collect();
            Ok(json!({
                "chain": feed.chain,
                "launchpad": feed.launchpad,
                "view": feed.view,
                "tokensInFeed": feed.tokens.len(),
                "fullyChecked": fully_checked,
                "developersOnRecord": feed.developers_known,
                "updatedAt": feed.updated_at,
                "note": "Checks run a few tokens at a time because the data provider limits calls, so the share of fully checked tokens grows as the feed is used. A developer's record covers launches Arctos has observed.",
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
        assert_eq!(names, ["launchpad_feed", "search_tokens", "contract_risk"]);
        for t in defs.as_array().unwrap() {
            assert_eq!(t["input_schema"]["additionalProperties"], false);
            assert!(t["description"].as_str().unwrap().len() > 40);
        }
        let feed = &defs[0]["description"].as_str().unwrap();
        assert!(feed.contains("pump-fun (Pump.fun)"), "{feed}");
        assert!(feed.contains("four-meme"), "{feed}");
    }

    #[test]
    fn ages_are_in_hours_and_never_negative() {
        let now = 10 * 3_600_000;
        assert_eq!(age_hours(Some(now - 5_400_000), now), Some(1.5));
        assert_eq!(age_hours(Some(now + 60_000), now), Some(0.0));
        assert_eq!(age_hours(None, now), None);
    }
}
