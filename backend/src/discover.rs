//! What is trending on DexScreener, for the sniper and the AI assistant: tokens with the most
//! boosts, the newest token profiles, community takeovers, and the trending metas (themes such
//! as AI or cats) with their tokens. Each list is priced with live pool data, cached briefly,
//! and only lists chains the sniper knows.

use std::{collections::HashMap, sync::Arc};

use axum::{
    extract::{Path, Query, State},
    Json,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::{
    error::{AppError, Result},
    sniper::{self, valid_address_for, SniperToken, CHAINS},
    upstream::UpstreamError,
    AppState,
};

/// The token lists, with DexScreener's endpoint for each.
pub const LISTS: &[(&str, &str)] = &[
    ("boosted", "/token-boosts/top/v1"),
    ("profiles", "/token-profiles/latest/v1"),
    ("takeovers", "/community-takeovers/latest/v1"),
];

const MAX_TOKENS: usize = 40;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverToken {
    #[serde(flatten)]
    pub token: SniperToken,
    /// Position in DexScreener's list, from 1.
    pub rank: usize,
    /// Boosts bought for the token, on the boosted list.
    pub boosts: Option<f64>,
    pub description: Option<String>,
    pub links: Vec<Link>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Link {
    pub kind: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Meta {
    pub slug: String,
    pub name: String,
    pub icon: Option<String>,
    pub description: Option<String>,
    pub market_cap: Option<f64>,
    pub liquidity: Option<f64>,
    pub volume: Option<f64>,
    pub token_count: Option<u64>,
    pub change_1h: Option<f64>,
    pub change_6h: Option<f64>,
    pub change_24h: Option<f64>,
}

fn num(v: Option<&Value>) -> Option<f64> {
    match v? {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().parse().ok(),
        _ => None,
    }
    .filter(|n: &f64| n.is_finite())
}

fn text(v: Option<&Value>, max: usize) -> Option<String> {
    let s = crate::ai::sanitize(v?.as_str()?, max);
    (!s.is_empty()).then_some(s)
}

fn https(v: Option<&Value>) -> Option<String> {
    let s = v?.as_str()?.trim();
    (s.starts_with("https://")
        && s.len() <= 300
        && !s
            .chars()
            .any(|c| c.is_whitespace() || c == '"' || c == '<' || c == '>'))
    .then(|| s.to_string())
}

/// One entry of a DexScreener token list, before it is priced.
#[derive(Debug, Clone, PartialEq)]
pub struct ListEntry {
    pub chain: &'static str,
    pub address: String,
    pub boosts: Option<f64>,
    pub description: Option<String>,
    pub links: Vec<Link>,
}

/// Reads a boosts, profiles or takeovers list, keeping known chains and valid addresses in order.
pub fn parse_list(v: &Value, only_chain: Option<&str>) -> Vec<ListEntry> {
    let Some(items) = v.as_array() else {
        return vec![];
    };
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for item in items.iter().take(120) {
        let Some(chain_id) = item.get("chainId").and_then(Value::as_str) else {
            continue;
        };
        let Some(chain) = CHAINS.iter().find(|c| c.dex_chain == chain_id) else {
            continue;
        };
        if only_chain.is_some_and(|o| o != chain.key) {
            continue;
        }
        let Some(address) = item
            .get("tokenAddress")
            .and_then(Value::as_str)
            .map(str::trim)
        else {
            continue;
        };
        if !valid_address_for(chain.key, address)
            || !seen.insert(sniper::token_id(chain.key, address))
        {
            continue;
        }
        let links = item
            .get("links")
            .and_then(Value::as_array)
            .map(|ls| {
                ls.iter()
                    .take(8)
                    .filter_map(|l| {
                        let url = https(l.get("url"))?;
                        let kind = text(l.get("type"), 16)
                            .or_else(|| text(l.get("label"), 16))
                            .unwrap_or_else(|| "link".into())
                            .to_ascii_lowercase();
                        Some(Link { kind, url })
                    })
                    .collect()
            })
            .unwrap_or_default();
        out.push(ListEntry {
            chain: chain.key,
            address: address.to_string(),
            boosts: num(item.get("totalAmount")).or_else(|| num(item.get("amount"))),
            description: text(item.get("description"), 200),
            links,
        });
    }
    out
}

/// Reads DexScreener's trending metas.
pub fn parse_metas(v: &Value) -> Vec<Meta> {
    v.as_array()
        .map(|items| items.iter().take(40).filter_map(parse_meta).collect())
        .unwrap_or_default()
}

pub fn parse_meta(m: &Value) -> Option<Meta> {
    let slug = m.get("slug").and_then(Value::as_str)?.trim();
    if !valid_slug(slug) {
        return None;
    }
    let icon = m
        .get("icon")
        .filter(|i| i.get("type").and_then(Value::as_str) == Some("emoji"))
        .and_then(|i| i.get("value"))
        .and_then(Value::as_str)
        .filter(|e| e.chars().count() <= 8 && !e.chars().any(|c| c.is_ascii()))
        .map(str::to_string);
    let change = |k: &str| num(m.get("marketCapChange").and_then(|c| c.get(k)));
    Some(Meta {
        slug: slug.to_string(),
        name: text(m.get("name"), 40).unwrap_or_else(|| slug.to_string()),
        icon,
        description: text(m.get("description"), 160),
        market_cap: num(m.get("marketCap")),
        liquidity: num(m.get("liquidity")),
        volume: num(m.get("volume")),
        token_count: m.get("tokenCount").and_then(Value::as_u64),
        change_1h: change("h1"),
        change_6h: change("h6"),
        change_24h: change("h24"),
    })
}

pub fn valid_slug(s: &str) -> bool {
    (1..=40).contains(&s.len())
        && s.bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

async fn dex(state: &AppState, path: &str) -> std::result::Result<Value, UpstreamError> {
    let url = format!("{}{}", state.config.dexscreener_base, path);
    state.up.get_json("dexscreener", &url).await
}

/// Prices a list's tokens with live pool data, keeping the list's order.
async fn price(state: &Arc<AppState>, entries: Vec<ListEntry>) -> Vec<DiscoverToken> {
    let mut by_chain: HashMap<&'static str, Vec<String>> = HashMap::new();
    for e in entries.iter().take(MAX_TOKENS * 2) {
        let list = by_chain.entry(e.chain).or_default();
        if list.len() < 30 {
            list.push(e.address.clone());
        }
    }
    let lookups = by_chain.into_iter().map(|(chain, addresses)| async move {
        sniper::market_for(state, chain, addresses)
            .await
            .unwrap_or_default()
    });
    let priced: HashMap<String, SniperToken> = futures_util::future::join_all(lookups)
        .await
        .into_iter()
        .flatten()
        .map(|t| (t.id.clone(), t))
        .collect();
    entries
        .into_iter()
        .enumerate()
        .filter_map(|(i, e)| {
            let token = priced.get(&sniper::token_id(e.chain, &e.address))?.clone();
            Some(DiscoverToken {
                token,
                rank: i + 1,
                boosts: e.boosts,
                description: e.description,
                links: e.links,
            })
        })
        .take(MAX_TOKENS)
        .collect()
}

/// A token list as JSON, cached for everyone for 45 seconds.
pub async fn list_json(state: &Arc<AppState>, list: &str, chain: Option<&str>) -> Result<Value> {
    let Some((name, path)) = LISTS.iter().find(|(n, _)| *n == list) else {
        return Err(AppError::BadRequest(format!(
            "list must be one of {}",
            LISTS.iter().map(|(n, _)| *n).collect::<Vec<_>>().join(", ")
        )));
    };
    if let Some(c) = chain {
        if sniper::chain_info(c).is_none() {
            return Err(AppError::BadRequest("unknown chain".into()));
        }
    }
    let key = format!("list:{name}:{}", chain.unwrap_or("all"));
    let st = state.clone();
    let only = chain.map(str::to_string);
    let v = state
        .discover_cache
        .get_or_fetch(&key, || async move {
            let raw = dex(&st, path).await?;
            let tokens = price(&st, parse_list(&raw, only.as_deref())).await;
            Ok::<_, UpstreamError>(json!({
                "list": name, "chain": only.as_deref().unwrap_or("all"), "tokens": tokens, "updatedAt": Utc::now(),
            }))
        })
        .await?;
    Ok(v)
}

/// The trending metas as JSON, cached for 60 seconds.
pub async fn metas_json(state: &Arc<AppState>) -> Result<Value> {
    let st = state.clone();
    let v = state
        .discover_cache
        .get_or_fetch("metas", || async move {
            let raw = dex(&st, "/metas/trending/v1").await?;
            Ok::<_, UpstreamError>(json!({ "metas": parse_metas(&raw), "updatedAt": Utc::now() }))
        })
        .await?;
    Ok(v)
}

/// One meta and its tokens on the sniper's chains, as JSON.
pub async fn meta_json(state: &Arc<AppState>, slug: &str) -> Result<Value> {
    if !valid_slug(slug) {
        return Err(AppError::BadRequest("invalid meta".into()));
    }
    let st = state.clone();
    let path = format!("/metas/meta/v1/{slug}");
    let v = state
        .discover_cache
        .get_or_fetch(&format!("meta:{slug}"), || async move {
            let raw = dex(&st, &path).await?;
            let meta =
                parse_meta(&raw).ok_or_else(|| UpstreamError::Parse("unknown meta".into()))?;
            let pairs =
                json!({ "pairs": raw.get("pairs").cloned().unwrap_or(Value::Array(vec![])) });
            let mut tokens = sniper::parse_dexscreener(&pairs.to_string(), None);
            tokens.sort_by(|a, b| {
                b.market_cap_usd
                    .partial_cmp(&a.market_cap_usd)
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
            tokens.truncate(MAX_TOKENS);
            Ok::<_, UpstreamError>(
                json!({ "meta": meta, "tokens": tokens, "updatedAt": Utc::now() }),
            )
        })
        .await?;
    Ok(v)
}

#[derive(Deserialize)]
pub struct ListQuery {
    list: String,
    chain: Option<String>,
}

pub async fn get_list(
    State(state): State<Arc<AppState>>,
    Query(q): Query<ListQuery>,
) -> Result<Json<Value>> {
    let chain = q.chain.as_deref().filter(|c| !c.is_empty() && *c != "all");
    Ok(Json(list_json(&state, &q.list, chain).await?))
}

pub async fn get_metas(State(state): State<Arc<AppState>>) -> Result<Json<Value>> {
    Ok(Json(metas_json(&state).await?))
}

pub async fn get_meta(
    State(state): State<Arc<AppState>>,
    Path(slug): Path<String>,
) -> Result<Json<Value>> {
    Ok(Json(meta_json(&state, &slug).await?))
}

#[cfg(test)]
mod tests {
    use super::*;

    const SOL_TOKEN: &str = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

    #[test]
    fn reads_a_list_in_order_and_drops_the_unknown() {
        let v = json!([
            {"chainId": "solana", "tokenAddress": SOL_TOKEN, "totalAmount": 500, "description": "A <b>cat</b>\nwith a hat",
             "links": [{"type": "twitter", "url": "https://x.com/cat"}, {"label": "Website", "url": "javascript:alert(1)"}]},
            {"chainId": "solana", "tokenAddress": SOL_TOKEN},
            {"chainId": "mars", "tokenAddress": SOL_TOKEN},
            {"chainId": "bsc", "tokenAddress": "not-an-address"},
            {"chainId": "bsc", "tokenAddress": "0x1111111111111111111111111111111111111111", "amount": 10}
        ]);
        let all = parse_list(&v, None);
        assert_eq!(
            all.len(),
            2,
            "duplicates, unknown chains and bad addresses are dropped"
        );
        assert_eq!(all[0].boosts, Some(500.0));
        let about = all[0].description.as_deref().unwrap();
        assert!(
            about.contains("cat") && !about.contains('<') && !about.contains('\n'),
            "{about}"
        );
        assert_eq!(
            all[0].links,
            vec![Link {
                kind: "twitter".into(),
                url: "https://x.com/cat".into()
            }]
        );
        assert_eq!(all[1].chain, "bsc");
        assert_eq!(parse_list(&v, Some("bsc")).len(), 1);
    }

    #[test]
    fn reads_metas() {
        let v = json!([
            {"name": "Cat", "slug": "cat", "icon": {"type": "emoji", "value": "🐈"}, "marketCap": 308078831, "liquidity": 30492423.51,
             "volume": 14337427.72, "tokenCount": 96, "marketCapChange": {"h1": 1.5, "h6": 0.7, "h24": -8.3}},
            {"name": "Bad", "slug": "../etc"},
            {"name": "Img", "slug": "img", "icon": {"type": "image", "value": "https://x/y.png"}}
        ]);
        let metas = parse_metas(&v);
        assert_eq!(metas.len(), 2);
        assert_eq!(metas[0].icon.as_deref(), Some("🐈"));
        assert_eq!(metas[0].token_count, Some(96));
        assert_eq!(metas[0].change_24h, Some(-8.3));
        assert_eq!(metas[1].icon, None);
        assert!(valid_slug("meme-hall-of-fame") && !valid_slug("Cat") && !valid_slug("a/b"));
    }
}
