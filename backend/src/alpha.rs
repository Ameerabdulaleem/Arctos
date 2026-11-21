//! Alpha: what top crypto traders and founders post on X, and the coins in those posts.
//!
//! Posts come from TwitterAPI.io (pay as you go, about $0.15 per 1,000 posts) or the official X
//! API, with a key set on the server. Each post is scanned for contract addresses, launch and
//! chart links (pump.fun, DexScreener, Birdeye, GMGN, explorers) and $tickers. Those are looked
//! up on DexScreener, a ticker resolving to its most liquid, oldest token so copycats lose, and
//! the coins are ranked by how many different accounts called them. Coins launched right after
//! a post, named after a word in it, are listed apart: that is how word coins appear when a
//! famous account says something.

use std::{
    collections::{BTreeMap, HashMap, HashSet},
    sync::Arc,
    time::{Duration, Instant},
};

use axum::{extract::State, Json};
use chrono::Utc;
use serde::Serialize;
use serde_json::{json, Value};
use tokio::sync::Mutex;

use crate::{
    ai::sanitize,
    error::Result,
    sniper::{self, parse_dexscreener, valid_evm_address, valid_solana_address, SniperToken},
    upstream::{KeyedCache, UpstreamError},
    AppState,
};

/// Accounts followed when `ALPHA_ACCOUNTS` is not set: traders, founders and on chain sleuths
/// whose posts move memecoins.
pub const DEFAULT_ACCOUNTS: &[&str] = &[
    "blknoiz06",
    "cz_binance",
    "elonmusk",
    "MustStopMurad",
    "notthreadguy",
    "frankdegods",
    "theunipcs",
    "a1lon9",
    "Cupseyy",
    "CryptoKaleo",
    "HsakaTrades",
    "GiganticRebirth",
    "cobie",
    "Cented7",
    "orangie",
    "dingalingts",
    "0xSisyphus",
    "inversebrah",
    "aeyakovenko",
    "rajgokal",
    "lookonchain",
    "Ga__ke",
    "Loopifyyy",
    "beaniemaxi",
];

const WINDOW_SECS: i64 = 12 * 3600;
const REFRESH_EVERY: Duration = Duration::from_secs(60);
const MAX_POSTS: usize = 400;
const PAGES_PER_QUERY: usize = 4;
/// Calls to the X data source in one refresh. With the free tier's five second gap this keeps a
/// refresh under half a minute; later refreshes only ask for posts newer than the last one.
const MAX_CALLS_PER_REFRESH: usize = 4;
/// A search over two dozen accounts can take a while to answer.
const CALL_TIMEOUT: Duration = Duration::from_secs(25);
/// No new call starts after this, so a refresh fits in the hosted function's 60 seconds.
const REFRESH_BUDGET: Duration = Duration::from_secs(20);
const MAX_QUERY: usize = 480;

/// Majors are mentioned all day; they would drown out new coins.
const MAJORS: &[&str] = &[
    "BTC", "ETH", "SOL", "BNB", "XRP", "DOGE", "USDT", "USDC", "ADA", "TRX", "TON", "AVAX", "DOT",
    "LINK", "LTC", "MATIC", "POL", "SHIB", "SUI", "NEAR", "APT", "ARB", "OP", "HYPE", "USD",
    "USDE", "DAI", "WBTC", "WETH", "SPX", "NDX", "QQQ", "SPY", "NVDA", "TSLA", "AAPL", "MSTR",
    "COIN", "GOLD", "DXY",
];

/// All caps words that are slang or acronyms, never a coin a post just named.
const COMMON_WORDS: &[&str] = &[
    "GM", "GN", "LFG", "WAGMI", "NGMI", "USA", "CEO", "AI", "ETF", "SEC", "NFT", "DM", "RT", "LOL",
    "IMO", "ATH", "FUD", "FOMO", "DYOR", "TBH", "ICYMI", "BREAKING", "NEW", "JUST", "THE", "AND",
    "FOR", "YOU", "NOT", "WITH", "THIS", "THAT", "API", "APP", "CT", "OTC", "TVL", "APY", "APR",
    "DEX", "CEX", "KYC", "AMA", "IPO", "GDP", "CPI", "FED", "FOMC", "UK", "EU", "US", "PM", "AM",
    "UTC", "EST", "PST", "OK", "YES", "NO", "WTF", "OMG", "BTW", "FYI", "IRL", "PSA",
];

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AlphaAuthor {
    pub handle: String,
    pub name: String,
    pub avatar: Option<String>,
    pub followers: Option<u64>,
    pub verified: bool,
}

/// Something in a post that may point at a coin.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Mention {
    /// A token contract. `chain` is a hint from the link it came in, when there was one.
    Address {
        chain: Option<String>,
        address: String,
    },
    /// A pool address from a chart link.
    Pair {
        chain: String,
        address: String,
    },
    Ticker(String),
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlphaPost {
    pub id: String,
    pub url: String,
    pub text: String,
    pub quoted: Option<String>,
    /// Unix milliseconds.
    pub created_at: i64,
    pub author: AlphaAuthor,
    pub likes: u64,
    pub retweets: u64,
    pub replies: u64,
    pub views: u64,
    pub is_reply: bool,
    pub is_retweet: bool,
    /// Ids (chain:address) of the coins found in the post.
    pub coins: Vec<String>,
    #[serde(skip)]
    pub mentions: Vec<Mention>,
    #[serde(skip)]
    pub words: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlphaCoin {
    #[serde(flatten)]
    pub token: SniperToken,
    /// Accounts that posted it, most followed first.
    pub kols: Vec<String>,
    pub mentions: u32,
    pub first_seen: i64,
    pub last_seen: i64,
    pub posts: Vec<String>,
    /// "contract" when a post gave its address or link, "ticker" when only its $ticker.
    pub evidence: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchedCoin {
    #[serde(flatten)]
    pub token: SniperToken,
    pub word: String,
    pub post_id: String,
    pub kol: String,
    /// Minutes between the post and the coin's first pool.
    pub minutes_after: i64,
}

pub struct AlphaStore {
    posts: Mutex<BTreeMap<String, AlphaPost>>,
    /// When the next call to the X data source may go out.
    next_call: Mutex<Instant>,
    fetched: Mutex<Option<Instant>>,
    last_error: std::sync::Mutex<Option<String>>,
    resolved: KeyedCache<HashMap<String, SniperToken>>,
    view: KeyedCache<Value>,
}

impl Default for AlphaStore {
    fn default() -> Self {
        Self::new()
    }
}

impl AlphaStore {
    pub fn new() -> Self {
        Self {
            posts: Mutex::new(BTreeMap::new()),
            next_call: Mutex::new(Instant::now()),
            fetched: Mutex::new(None),
            last_error: std::sync::Mutex::new(None),
            resolved: KeyedCache::new(Duration::from_secs(120), Duration::from_secs(900)),
            view: KeyedCache::new(Duration::from_secs(30), Duration::from_secs(600)),
        }
    }
}

pub fn valid_handle(h: &str) -> bool {
    (1..=15).contains(&h.len()) && h.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
}

// ------------------------------------------------------------------ extraction

fn is_address_char(c: char) -> bool {
    c.is_ascii_alphanumeric()
}

/// A Solana address that is a real looking contract, not a long word.
fn looks_like_mint(s: &str) -> bool {
    valid_solana_address(s)
        && s.bytes().any(|b| b.is_ascii_uppercase())
        && s.bytes().any(|b| b.is_ascii_lowercase())
        && (s.len() >= 40 || s.bytes().any(|b| b.is_ascii_digit()))
}

/// The chain a link's host points at, when it says.
fn chain_hint(url: &str) -> Option<&'static str> {
    let u = url.to_ascii_lowercase();
    if u.contains("pump.fun")
        || u.contains("solscan.io")
        || u.contains("/sol/")
        || u.contains("/solana/")
        || u.contains("bonk.fun")
        || u.contains("jup.ag")
    {
        Some("solana")
    } else if u.contains("bscscan.com") || u.contains("four.meme") || u.contains("/bsc/") {
        Some("bsc")
    } else if u.contains("basescan.org") || u.contains("/base/") || u.contains("zora.co") {
        Some("base")
    } else if u.contains("etherscan.io") || u.contains("/ethereum/") || u.contains("/eth/") {
        Some("ethereum")
    } else {
        None
    }
}

/// Every coin pointer in a post's text and the links it carries.
pub fn extract(text: &str, urls: &[String]) -> Vec<Mention> {
    let mut out: Vec<Mention> = Vec::new();
    let mut push = |m: Mention| {
        if !out.contains(&m) {
            out.push(m);
        }
    };
    // Links first: they carry the chain.
    for url in urls {
        let lower = url.to_ascii_lowercase();
        let segments: Vec<&str> = url
            .split(['/', '?', '&', '=', '#', '-'])
            .filter(|s| !s.is_empty())
            .collect();
        let dexscreener = lower.contains("dexscreener.com/");
        for (i, seg) in segments.iter().enumerate() {
            if valid_evm_address(seg) || looks_like_mint(seg) {
                if dexscreener {
                    // dexscreener.com/<chain>/<pool>
                    let chain = segments
                        .get(i.wrapping_sub(1))
                        .map(|c| c.to_ascii_lowercase())
                        .unwrap_or_default();
                    if sniper::CHAINS.iter().any(|c| c.dex_chain == chain) {
                        push(Mention::Pair {
                            chain,
                            address: seg.to_string(),
                        });
                        continue;
                    }
                }
                push(Mention::Address {
                    chain: chain_hint(url).map(str::to_string),
                    address: seg.to_string(),
                });
            }
        }
    }
    // Then the text: contract addresses and $tickers.
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c == '$'
            && i + 1 < chars.len()
            && chars[i + 1].is_ascii_alphabetic()
            && (i == 0 || !chars[i - 1].is_ascii_alphanumeric())
        {
            let mut j = i + 1;
            while j < chars.len() && (chars[j].is_ascii_alphanumeric() || chars[j] == '_') {
                j += 1;
            }
            let tag: String = chars[i + 1..j]
                .iter()
                .collect::<String>()
                .to_ascii_uppercase();
            if (2..=15).contains(&tag.len()) && !MAJORS.contains(&tag.as_str()) {
                push(Mention::Ticker(tag));
            }
            i = j;
            continue;
        }
        if is_address_char(c) {
            let mut j = i;
            while j < chars.len() && is_address_char(chars[j]) {
                j += 1;
            }
            let word: String = chars[i..j].iter().collect();
            if valid_evm_address(&word) || looks_like_mint(&word) {
                push(Mention::Address {
                    chain: None,
                    address: word,
                });
            }
            i = j;
            continue;
        }
        i += 1;
    }
    out
}

/// Words a word coin could be named after: #hashtags, and names in capitals or quotes.
pub fn coin_words(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut add = |w: &str| {
        let w = w.trim_matches(|c: char| !c.is_ascii_alphanumeric());
        let upper = w.to_ascii_uppercase();
        if (3..=16).contains(&w.len())
            && w.chars().all(|c| c.is_ascii_alphanumeric())
            && !COMMON_WORDS.contains(&upper.as_str())
            && !MAJORS.contains(&upper.as_str())
            && !out.contains(&upper)
        {
            out.push(upper);
        }
    };
    for token in text.split_whitespace() {
        if let Some(tag) = token.strip_prefix('#') {
            add(tag);
        } else {
            let bare = token.trim_matches(|c: char| !c.is_ascii_alphanumeric());
            if bare.len() >= 3
                && bare
                    .chars()
                    .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
                && bare.chars().any(|c| c.is_ascii_uppercase())
            {
                add(bare);
            }
        }
    }
    // "Quoted names"
    let mut rest = text;
    while let Some(start) = rest.find('"') {
        let after = &rest[start + 1..];
        match after.find('"') {
            Some(end) if end <= 20 && !after[..end].contains(' ') => {
                add(&after[..end]);
                rest = &after[end + 1..];
            }
            _ => break,
        }
    }
    out.truncate(4);
    out
}

// ------------------------------------------------------------------ reading posts

fn num(v: &Value, key: &str) -> u64 {
    v.get(key).and_then(Value::as_u64).unwrap_or(0)
}

fn safe_avatar(v: Option<&Value>) -> Option<String> {
    let s = v?.as_str()?;
    (s.starts_with("https://pbs.twimg.com/") && s.len() < 300 && !s.contains(['"', '<', '>', ' ']))
        .then(|| s.to_string())
}

/// "Tue Dec 10 07:00:30 +0000 2024", or ISO 8601.
fn parse_time(s: &str) -> Option<i64> {
    chrono::DateTime::parse_from_str(s, "%a %b %d %H:%M:%S %z %Y")
        .or_else(|_| chrono::DateTime::parse_from_rfc3339(s))
        .ok()
        .map(|d| d.timestamp_millis())
}

fn urls_of(entities: Option<&Value>) -> Vec<String> {
    entities
        .and_then(|e| e.get("urls"))
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|u| u.get("expanded_url").and_then(Value::as_str))
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

/// One post from TwitterAPI.io's tweet shape.
pub fn parse_twitterapi_tweet(t: &Value) -> Option<AlphaPost> {
    let id = t.get("id").and_then(Value::as_str)?.to_string();
    if !id.bytes().all(|b| b.is_ascii_digit()) || id.len() > 25 {
        return None;
    }
    let a = t.get("author")?;
    let handle = a.get("userName").and_then(Value::as_str)?.to_string();
    if !valid_handle(&handle) {
        return None;
    }
    let created_at = parse_time(t.get("createdAt").and_then(Value::as_str)?)?;
    // A retweet's own text is cut short; the original holds the full post.
    let original = t.get("retweeted_tweet").filter(|r| r.is_object());
    let source = original.unwrap_or(t);
    let text = source
        .get("text")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let quoted = t.get("quoted_tweet").filter(|q| q.is_object());
    let quoted_text = quoted.and_then(|q| q.get("text")).and_then(Value::as_str);
    let mut urls = urls_of(source.get("entities"));
    if let Some(q) = quoted {
        urls.extend(urls_of(q.get("entities")));
    }
    let scan = format!("{text}\n{}", quoted_text.unwrap_or_default());
    Some(AlphaPost {
        url: format!("https://x.com/{handle}/status/{id}"),
        id,
        text: sanitize_keep_lines(text, 1200),
        quoted: quoted_text.map(|q| sanitize_keep_lines(q, 600)),
        created_at,
        author: AlphaAuthor {
            name: sanitize(a.get("name").and_then(Value::as_str).unwrap_or(&handle), 60),
            avatar: safe_avatar(a.get("profilePicture")),
            followers: a.get("followers").and_then(Value::as_u64),
            verified: a
                .get("isBlueVerified")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            handle,
        },
        likes: num(t, "likeCount"),
        retweets: num(t, "retweetCount"),
        replies: num(t, "replyCount"),
        views: num(t, "viewCount"),
        is_reply: t.get("isReply").and_then(Value::as_bool).unwrap_or(false),
        is_retweet: original.is_some(),
        coins: vec![],
        mentions: extract(&scan, &urls),
        words: coin_words(text),
    })
}

/// Posts from the official X API v2 recent search answer.
pub fn parse_x_api(v: &Value) -> Vec<AlphaPost> {
    let users: HashMap<&str, &Value> = v
        .get("includes")
        .and_then(|i| i.get("users"))
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|u| Some((u.get("id")?.as_str()?, u)))
                .collect()
        })
        .unwrap_or_default();
    let Some(data) = v.get("data").and_then(Value::as_array) else {
        return vec![];
    };
    data.iter()
        .filter_map(|t| {
            let id = t.get("id")?.as_str()?.to_string();
            let user = users.get(t.get("author_id")?.as_str()?)?;
            let handle = user.get("username")?.as_str()?.to_string();
            if !valid_handle(&handle) || !id.bytes().all(|b| b.is_ascii_digit()) {
                return None;
            }
            let text = t.get("text").and_then(Value::as_str).unwrap_or_default();
            let metrics = t.get("public_metrics").cloned().unwrap_or(Value::Null);
            let refs = t.get("referenced_tweets").and_then(Value::as_array);
            let kind = |k: &str| {
                refs.is_some_and(|r| {
                    r.iter()
                        .any(|x| x.get("type").and_then(Value::as_str) == Some(k))
                })
            };
            let mut mentions = extract(text, &urls_of(t.get("entities")));
            for tag in t
                .get("entities")
                .and_then(|e| e.get("cashtags"))
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                if let Some(s) = tag.get("tag").and_then(Value::as_str) {
                    let s = s.to_ascii_uppercase();
                    let m = Mention::Ticker(s.clone());
                    if (2..=15).contains(&s.len())
                        && !MAJORS.contains(&s.as_str())
                        && !mentions.contains(&m)
                    {
                        mentions.push(m);
                    }
                }
            }
            Some(AlphaPost {
                url: format!("https://x.com/{handle}/status/{id}"),
                id,
                text: sanitize_keep_lines(text, 1200),
                quoted: None,
                created_at: parse_time(t.get("created_at")?.as_str()?)?,
                author: AlphaAuthor {
                    name: sanitize(
                        user.get("name").and_then(Value::as_str).unwrap_or(&handle),
                        60,
                    ),
                    avatar: safe_avatar(user.get("profile_image_url")),
                    followers: user
                        .get("public_metrics")
                        .and_then(|m| m.get("followers_count"))
                        .and_then(Value::as_u64),
                    verified: user
                        .get("verified")
                        .and_then(Value::as_bool)
                        .unwrap_or(false),
                    handle,
                },
                likes: num(&metrics, "like_count"),
                retweets: num(&metrics, "retweet_count"),
                replies: num(&metrics, "reply_count"),
                views: num(&metrics, "impression_count"),
                is_reply: kind("replied_to"),
                is_retweet: kind("retweeted"),
                coins: vec![],
                mentions,
                words: coin_words(text),
            })
        })
        .collect()
}

/// Printable text with line breaks kept; control characters dropped.
fn sanitize_keep_lines(s: &str, max: usize) -> String {
    s.chars()
        .filter(|c| *c == '\n' || !c.is_control())
        .take(max)
        .collect()
}

/// `(from:a OR from:b ...)` queries short enough for the search API.
pub fn queries(accounts: &[String], since: i64) -> Vec<String> {
    let suffix = format!(" since_time:{since}");
    let mut out = Vec::new();
    let mut cur: Vec<String> = Vec::new();
    for a in accounts {
        let next = format!("from:{a}");
        let len = cur.iter().map(|c| c.len() + 4).sum::<usize>() + next.len() + suffix.len() + 2;
        if !cur.is_empty() && len > MAX_QUERY {
            out.push(format!("({}){suffix}", cur.join(" OR ")));
            cur.clear();
        }
        cur.push(next);
    }
    if !cur.is_empty() {
        out.push(format!("({}){suffix}", cur.join(" OR ")));
    }
    out
}

pub fn source(state: &AppState) -> Option<&'static str> {
    if state.config.twitterapi_key.is_some() {
        Some("twitterapi.io")
    } else if state.config.x_bearer_token.is_some() {
        Some("x")
    } else {
        None
    }
}

/// Waits until the X data source may be called again.
async fn turn(state: &AppState) {
    let mut next = state.alpha.next_call.lock().await;
    let now = Instant::now();
    if *next > now {
        tokio::time::sleep(*next - now).await;
    }
    *next = Instant::now() + Duration::from_millis(state.config.alpha_call_spacing_ms);
}

/// Posts read, and the error that stopped the reading early, if any. Posts read before a
/// refusal are kept.
async fn fetch_posts(state: &AppState, since: i64) -> (Vec<AlphaPost>, Option<UpstreamError>) {
    let mut posts = Vec::new();
    let mut calls = 0usize;
    let started = Instant::now();
    let out_of_time = |calls: usize| {
        calls >= MAX_CALLS_PER_REFRESH || (calls > 0 && started.elapsed() > REFRESH_BUDGET)
    };
    for query in queries(&state.config.alpha_accounts, since) {
        if out_of_time(calls) {
            break;
        }
        if let Some(key) = state.config.twitterapi_key.as_deref() {
            let url = format!(
                "{}/twitter/tweet/advanced_search",
                state.config.twitterapi_base
            );
            let mut cursor = String::new();
            for _ in 0..PAGES_PER_QUERY {
                if out_of_time(calls) {
                    break;
                }
                let q = [
                    ("query", query.clone()),
                    ("queryType", "Latest".to_string()),
                    ("cursor", cursor.clone()),
                ];
                turn(state).await;
                calls += 1;
                let v: Value = match state
                    .up
                    .get_json_slow("twitterapi", &url, &q, &[("x-api-key", key)], CALL_TIMEOUT)
                    .await
                {
                    Ok(v) => v,
                    Err(e) => return (posts, Some(e)),
                };
                if let Some(list) = v.get("tweets").and_then(Value::as_array) {
                    posts.extend(list.iter().filter_map(parse_twitterapi_tweet));
                }
                match (
                    v.get("has_next_page").and_then(Value::as_bool),
                    v.get("next_cursor").and_then(Value::as_str),
                ) {
                    (Some(true), Some(c)) if !c.is_empty() => cursor = c.to_string(),
                    _ => break,
                }
            }
        } else if let Some(token) = state.config.x_bearer_token.as_deref() {
            let url = format!("{}/2/tweets/search/recent", state.config.x_api_base);
            let start = chrono::DateTime::from_timestamp(since, 0)
                .unwrap_or_else(Utc::now)
                .to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
            let plain = query
                .rsplit_once(" since_time:")
                .map_or(query.as_str(), |(q, _)| q)
                .to_string();
            let q = [
                ("query", plain),
                ("max_results", "100".to_string()),
                ("start_time", start),
                (
                    "tweet.fields",
                    "created_at,public_metrics,entities,author_id,referenced_tweets".to_string(),
                ),
                ("expansions", "author_id".to_string()),
                (
                    "user.fields",
                    "username,name,profile_image_url,public_metrics,verified".to_string(),
                ),
            ];
            let auth = format!("Bearer {token}");
            turn(state).await;
            calls += 1;
            match state
                .up
                .get_json_slow::<Value>(
                    "x-api",
                    &url,
                    &q,
                    &[("authorization", auth.as_str())],
                    CALL_TIMEOUT,
                )
                .await
            {
                Ok(v) => posts.extend(parse_x_api(&v)),
                Err(e) => return (posts, Some(e)),
            }
        }
    }
    (posts, None)
}

/// Fetches new posts at most once a minute; concurrent callers share one fetch.
async fn refresh(state: &Arc<AppState>) {
    let mut fetched = state.alpha.fetched.lock().await;
    if fetched.is_some_and(|t| t.elapsed() < REFRESH_EVERY) {
        return;
    }
    let now = Utc::now().timestamp();
    let since = {
        let posts = state.alpha.posts.lock().await;
        posts
            .values()
            .map(|p| p.created_at / 1000)
            .max()
            .map_or(now - WINDOW_SECS, |newest| {
                (newest - 1).max(now - WINDOW_SECS)
            })
    };
    let (new, error) = fetch_posts(state, since).await;
    let read = new.len();
    if read > 0 || error.is_none() {
        let mut posts = state.alpha.posts.lock().await;
        for p in new {
            posts.insert(p.id.clone(), p);
        }
        let cutoff = (now - WINDOW_SECS) * 1000;
        posts.retain(|_, p| p.created_at >= cutoff);
        while posts.len() > MAX_POSTS {
            let oldest = posts
                .iter()
                .min_by_key(|(_, p)| p.created_at)
                .map(|(k, _)| k.clone());
            match oldest {
                Some(k) => posts.remove(&k),
                None => break,
            };
        }
        state.alpha.view.invalidate("view");
    }
    let message = error.map(|e| {
        tracing::warn!("alpha posts (kept {read} read before it): {e}");
        match &e {
            UpstreamError::Http {
                status: 401 | 403, ..
            } => "The X data key was refused. Check it in the server settings.".to_string(),
            UpstreamError::Http { status: 402, .. } => {
                "The X data account is out of credits. Top it up to see new posts.".to_string()
            }
            UpstreamError::Http { status: 429, .. } => {
                "The X data source is rate limiting. New posts will follow shortly.".to_string()
            }
            UpstreamError::Network(_) => {
                "The X data source is slow to answer right now. New posts will follow shortly."
                    .to_string()
            }
            _ => "New posts could not be read right now.".to_string(),
        }
    });
    *state
        .alpha
        .last_error
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = message;
    *fetched = Some(Instant::now());
}

// ------------------------------------------------------------------ resolving coins

async fn dex_tokens(state: &Arc<AppState>, path: String) -> Vec<SniperToken> {
    let url = format!("{}{}", state.config.dexscreener_base, path);
    match state.up.get_json::<Value>("dexscreener", &url).await {
        Ok(v) => {
            let wrapped = if v.is_array() {
                json!({ "pairs": v })
            } else if v.get("pair").is_some() {
                json!({ "pairs": [v["pair"].clone()] })
            } else {
                v
            };
            parse_dexscreener(&wrapped.to_string(), None)
        }
        Err(_) => vec![],
    }
}

/// Looks every mention up on DexScreener. Keys are the mention, values the token it means.
async fn resolve(state: &Arc<AppState>, mentions: &[Mention]) -> HashMap<Mention, SniperToken> {
    let mut out = HashMap::new();
    let addresses: Vec<String> = mentions
        .iter()
        .filter_map(|m| match m {
            Mention::Address { address, .. } => Some(address.clone()),
            _ => None,
        })
        .collect();
    for chunk in addresses.chunks(30) {
        let key = format!("a:{}", chunk.join(","));
        let st = state.clone();
        let path = format!("/latest/dex/tokens/{}", chunk.join(","));
        let found = state
            .alpha
            .resolved
            .get_or_fetch(&key, || async move {
                let tokens = dex_tokens(&st, path).await;
                Ok::<_, UpstreamError>(
                    tokens
                        .into_iter()
                        .map(|t| (t.address.to_ascii_lowercase(), t))
                        .collect(),
                )
            })
            .await
            .unwrap_or_default();
        for m in mentions {
            if let Mention::Address { address, chain } = m {
                if let Some(t) = found.get(&address.to_ascii_lowercase()) {
                    if chain.as_deref().is_none_or(|c| c == t.chain) || chain.is_some() {
                        out.insert(m.clone(), t.clone());
                    }
                }
            }
        }
    }
    let lookups = mentions
        .iter()
        .filter(|m| !matches!(m, Mention::Address { .. }))
        .map(|m| {
            let st = state.clone();
            let m = m.clone();
            async move {
                let (key, path, symbol) = match &m {
                    Mention::Pair { chain, address } => (
                        format!("p:{chain}:{address}"),
                        format!("/latest/dex/pairs/{chain}/{address}"),
                        None,
                    ),
                    Mention::Ticker(t) => (
                        format!("t:{t}"),
                        format!("/latest/dex/search?q={t}"),
                        Some(t.clone()),
                    ),
                    Mention::Address { .. } => unreachable!(),
                };
                let st2 = st.clone();
                let found = st
                    .alpha
                    .resolved
                    .get_or_fetch(&key, || async move {
                        let tokens = dex_tokens(&st2, path).await;
                        // A ticker means its original: the matching token with the most liquidity, then the oldest.
                        let best = tokens
                            .into_iter()
                            .filter(|t| {
                                symbol
                                    .as_ref()
                                    .is_none_or(|s| t.symbol.eq_ignore_ascii_case(s))
                            })
                            .max_by(|a, b| {
                                a.liquidity_usd
                                    .partial_cmp(&b.liquidity_usd)
                                    .unwrap_or(std::cmp::Ordering::Equal)
                                    .then_with(|| {
                                        b.created_at
                                            .unwrap_or(i64::MAX)
                                            .cmp(&a.created_at.unwrap_or(i64::MAX))
                                    })
                            });
                        Ok::<_, UpstreamError>(
                            best.map(|t| HashMap::from([(String::new(), t)]))
                                .unwrap_or_default(),
                        )
                    })
                    .await
                    .unwrap_or_default();
                found.get("").cloned().map(|t| (m, t))
            }
        });
    for (m, t) in futures_util::future::join_all(lookups)
        .await
        .into_iter()
        .flatten()
    {
        out.insert(m, t);
    }
    out
}

/// Coins launched after a post and named after a word in it.
async fn launched_after(state: &Arc<AppState>, posts: &[AlphaPost]) -> Vec<LaunchedCoin> {
    let now = Utc::now().timestamp_millis();
    let mut seen = HashSet::new();
    let jobs: Vec<(String, AlphaPost)> = posts
        .iter()
        .filter(|p| now - p.created_at < 6 * 3_600_000 && !p.is_retweet)
        .flat_map(|p| p.words.iter().map(move |w| (w.clone(), p.clone())))
        .filter(|(w, _)| seen.insert(w.clone()))
        .take(8)
        .collect();
    let found = futures_util::future::join_all(jobs.into_iter().map(|(word, post)| {
        let st = state.clone();
        async move {
            let st2 = st.clone();
            let w = word.clone();
            let tokens = st
                .alpha
                .resolved
                .get_or_fetch(&format!("w:{word}"), || async move {
                    let list = dex_tokens(&st2, format!("/latest/dex/search?q={w}")).await;
                    Ok::<_, UpstreamError>(list.into_iter().map(|t| (t.id.clone(), t)).collect())
                })
                .await
                .unwrap_or_default();
            tokens
                .into_values()
                .filter(|t| {
                    let named = t.symbol.eq_ignore_ascii_case(&word)
                        || t.name
                            .to_ascii_uppercase()
                            .split_whitespace()
                            .any(|n| n == word);
                    named
                        && t.liquidity_usd >= 3_000.0
                        && t.created_at.is_some_and(|c| {
                            c >= post.created_at - 120_000 && c - post.created_at < 6 * 3_600_000
                        })
                })
                .max_by(|a, b| {
                    a.volume_24h_usd
                        .partial_cmp(&b.volume_24h_usd)
                        .unwrap_or(std::cmp::Ordering::Equal)
                })
                .map(|t| LaunchedCoin {
                    minutes_after: (t.created_at.unwrap_or(post.created_at) - post.created_at)
                        / 60_000,
                    token: t,
                    word: word.clone(),
                    post_id: post.id.clone(),
                    kol: post.author.handle.clone(),
                })
        }
    }))
    .await;
    let mut out: Vec<LaunchedCoin> = found.into_iter().flatten().collect();
    out.sort_by(|a, b| {
        b.token
            .volume_24h_usd
            .partial_cmp(&a.token.volume_24h_usd)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    out
}

/// A coin while ranking: the token, who called it, mentions, first and last post time, the
/// posts, and whether any post gave its contract.
type Tally = (
    SniperToken,
    HashSet<String>,
    u32,
    i64,
    i64,
    Vec<String>,
    bool,
);

/// Ranks coins by how many different accounts called them, then mentions, then recency.
pub fn rank(posts: &mut [AlphaPost], resolved: &HashMap<Mention, SniperToken>) -> Vec<AlphaCoin> {
    let followers: HashMap<String, u64> = posts
        .iter()
        .map(|p| (p.author.handle.clone(), p.author.followers.unwrap_or(0)))
        .collect();
    let mut coins: BTreeMap<String, Tally> = BTreeMap::new();
    for p in posts.iter_mut() {
        let mut ids = Vec::new();
        for m in &p.mentions {
            let Some(t) = resolved.get(m) else { continue };
            let contract = !matches!(m, Mention::Ticker(_));
            if ids.contains(&t.id) {
                // A post that names the ticker and gives the contract counts once, as a contract.
                if let Some(e) = coins.get_mut(&t.id) {
                    e.6 |= contract;
                }
                continue;
            }
            ids.push(t.id.clone());
            let e = coins.entry(t.id.clone()).or_insert_with(|| {
                (
                    t.clone(),
                    HashSet::new(),
                    0,
                    p.created_at,
                    p.created_at,
                    vec![],
                    false,
                )
            });
            e.1.insert(p.author.handle.clone());
            e.2 += 1;
            e.3 = e.3.min(p.created_at);
            e.4 = e.4.max(p.created_at);
            e.5.push(p.id.clone());
            e.6 |= contract;
        }
        p.coins = ids;
    }
    let mut out: Vec<AlphaCoin> = coins
        .into_values()
        .map(|(token, kols, mentions, first, last, posts, contract)| {
            let mut kols: Vec<String> = kols.into_iter().collect();
            kols.sort_by_key(|k| std::cmp::Reverse(followers.get(k).copied().unwrap_or(0)));
            AlphaCoin {
                token,
                kols,
                mentions,
                first_seen: first,
                last_seen: last,
                posts,
                evidence: if contract { "contract" } else { "ticker" },
            }
        })
        .collect();
    out.sort_by(|a, b| {
        b.kols
            .len()
            .cmp(&a.kols.len())
            .then(b.mentions.cmp(&a.mentions))
            .then(b.last_seen.cmp(&a.last_seen))
    });
    out.truncate(60);
    out
}

async fn build_view(state: &Arc<AppState>) -> Value {
    let mut posts: Vec<AlphaPost> = state.alpha.posts.lock().await.values().cloned().collect();
    posts.sort_by_key(|p| std::cmp::Reverse(p.created_at));
    let mentions: Vec<Mention> = {
        let mut all: Vec<Mention> = posts
            .iter()
            .flat_map(|p| p.mentions.iter().cloned())
            .collect();
        all.sort();
        all.dedup();
        all.truncate(120);
        all
    };
    let resolved = resolve(state, &mentions).await;
    let coins = rank(&mut posts, &resolved);
    let launched = launched_after(state, &posts).await;
    let error = state
        .alpha
        .last_error
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    json!({
        "configured": true,
        "source": source(state),
        "accounts": state.config.alpha_accounts,
        "posts": posts.iter().take(150).collect::<Vec<_>>(),
        "coins": coins,
        "launched": launched,
        "updatedAt": Utc::now(),
        "error": error,
    })
}

pub async fn alpha_json(state: &Arc<AppState>) -> Value {
    if source(state).is_none() {
        return json!({ "configured": false, "source": null, "accounts": state.config.alpha_accounts, "posts": [], "coins": [], "launched": [] });
    }
    refresh(state).await;
    let st = state.clone();
    state
        .alpha
        .view
        .get_or_fetch("view", || async move {
            Ok::<_, UpstreamError>(build_view(&st).await)
        })
        .await
        .unwrap_or_else(|_| json!({ "configured": true, "posts": [], "coins": [], "launched": [] }))
}

pub async fn get_alpha(State(state): State<Arc<AppState>>) -> Result<Json<Value>> {
    Ok(Json(alpha_json(&state).await))
}

/// Server mode: keep posts fresh in the background.
pub fn spawn_pollers(state: Arc<AppState>) {
    if source(&state).is_none() {
        return;
    }
    tokio::spawn(async move {
        loop {
            let _ = alpha_json(&state).await;
            tokio::time::sleep(REFRESH_EVERY).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    const MINT: &str = "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr";
    const EVM: &str = "0x6982508145454Ce325dDbE47a25d4ec3d2311933";

    #[test]
    fn finds_contracts_links_and_tickers() {
        let text = format!("Aped $wif and $POPCAT, CA {MINT}\nalso {EVM}. $BTC to 200k. Not an address: abcdefghijkmnopqrstuvwxyzabcdefghijk");
        let urls = vec![
            "https://pump.fun/coin/9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin".to_string(),
            "https://dexscreener.com/solana/HzrEstnLfzsijpzNAHDHk7b9hHLmb1LZEbXd2Kx5jK5r"
                .to_string(),
        ];
        let m = extract(&text, &urls);
        assert!(m.contains(&Mention::Address {
            chain: Some("solana".into()),
            address: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin".into()
        }));
        assert!(m.contains(&Mention::Pair {
            chain: "solana".into(),
            address: "HzrEstnLfzsijpzNAHDHk7b9hHLmb1LZEbXd2Kx5jK5r".into()
        }));
        assert!(m.contains(&Mention::Address {
            chain: None,
            address: MINT.into()
        }));
        assert!(m.contains(&Mention::Address {
            chain: None,
            address: EVM.into()
        }));
        assert!(m.contains(&Mention::Ticker("WIF".into())));
        assert!(m.contains(&Mention::Ticker("POPCAT".into())));
        assert!(
            !m.contains(&Mention::Ticker("BTC".into())),
            "majors are skipped"
        );
        assert_eq!(m.len(), 6, "{m:?}");
    }

    #[test]
    fn prices_in_dollars_are_not_tickers() {
        assert!(extract("bought at $0.004 and sold $20k", &[]).is_empty());
    }

    #[test]
    fn word_coin_candidates() {
        assert_eq!(
            coin_words("My dog is called BROCCOLI. #Kekius \"Pengu\" gm GM AI"),
            vec!["BROCCOLI", "KEKIUS", "PENGU"]
        );
    }

    #[test]
    fn reads_a_twitterapi_post() {
        let t = json!({
            "type": "tweet", "id": "1866332878329102336", "url": "https://x.com/blknoiz06/status/1866332878329102336",
            "text": "this one is cooking $FARTCOIN", "createdAt": "Tue Dec 10 07:00:30 +0000 2024",
            "likeCount": 1200, "retweetCount": 80, "replyCount": 300, "viewCount": 250000, "isReply": false,
            "author": {"userName": "blknoiz06", "name": "Ansem 🐂🀄️", "profilePicture": "https://pbs.twimg.com/profile_images/1/x.jpg", "followers": 800000, "isBlueVerified": true},
            "entities": {"urls": [{"expanded_url": format!("https://dexscreener.com/solana/{MINT}")}]},
            "quoted_tweet": {"text": "CA: 9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin", "entities": {}}
        });
        let p = parse_twitterapi_tweet(&t).unwrap();
        assert_eq!(p.author.handle, "blknoiz06");
        assert_eq!(p.created_at, 1_733_814_030_000);
        assert_eq!(p.url, "https://x.com/blknoiz06/status/1866332878329102336");
        assert_eq!(
            p.author.avatar.as_deref(),
            Some("https://pbs.twimg.com/profile_images/1/x.jpg")
        );
        assert!(p.mentions.contains(&Mention::Ticker("FARTCOIN".into())));
        assert!(p.mentions.iter().any(|m| matches!(m, Mention::Pair { .. })));
        assert!(
            p.mentions.iter().any(
                |m| matches!(m, Mention::Address { address, .. } if address.starts_with("9xQe"))
            ),
            "quoted posts count"
        );
        // Bad handles and ids are refused, and avatars only come from X's image host.
        assert!(parse_twitterapi_tweet(&json!({"id": "1", "createdAt": "Tue Dec 10 07:00:30 +0000 2024", "author": {"userName": "bad name"}})).is_none());
        let mut evil = t.clone();
        evil["author"]["profilePicture"] = json!("javascript:alert(1)");
        assert_eq!(parse_twitterapi_tweet(&evil).unwrap().author.avatar, None);
    }

    #[test]
    fn reads_the_official_x_api() {
        let v = json!({
            "data": [{"id": "190000000000000001", "author_id": "44196397", "text": "$DOGE to the moon and $KEKIUS", "created_at": "2026-11-20T10:00:00.000Z",
                "public_metrics": {"like_count": 5, "retweet_count": 1, "reply_count": 2, "impression_count": 900},
                "entities": {"cashtags": [{"tag": "Kekius"}]}}],
            "includes": {"users": [{"id": "44196397", "username": "elonmusk", "name": "Elon Musk", "public_metrics": {"followers_count": 200000000}}]}
        });
        let p = &parse_x_api(&v)[0];
        assert_eq!(p.author.handle, "elonmusk");
        // DOGE is a major, so only the new coin is kept.
        assert_eq!(p.mentions, vec![Mention::Ticker("KEKIUS".into())]);
        assert_eq!(p.views, 900);
    }

    #[test]
    fn queries_stay_short() {
        let accounts: Vec<String> = (0..60).map(|i| format!("account_{i:02}")).collect();
        let q = queries(&accounts, 1_800_000_000);
        assert!(q.len() > 1);
        assert!(
            q.iter()
                .all(|x| x.len() <= MAX_QUERY + 30 && x.ends_with(" since_time:1800000000")),
            "{q:?}"
        );
        assert_eq!(
            q.iter().map(|x| x.matches("from:").count()).sum::<usize>(),
            60
        );
    }

    fn token(id: &str, symbol: &str) -> SniperToken {
        SniperToken {
            id: format!("solana:{id}"),
            symbol: symbol.into(),
            name: symbol.into(),
            address: id.into(),
            chain: "solana".into(),
            pair_address: String::new(),
            dex: String::new(),
            price_usd: 1.0,
            liquidity_usd: 1.0,
            market_cap_usd: 1.0,
            volume_24h_usd: 1.0,
            change_5m: None,
            change_1h: None,
            change_24h: None,
            buys_24h: 0,
            sells_24h: 0,
            created_at: None,
            url: String::new(),
            image_url: None,
        }
    }

    #[test]
    fn ranks_by_how_many_accounts_called_it() {
        let post = |id: &str, who: &str, m: Vec<Mention>, at: i64| AlphaPost {
            id: id.into(),
            url: String::new(),
            text: String::new(),
            quoted: None,
            created_at: at,
            author: AlphaAuthor {
                handle: who.into(),
                name: who.into(),
                avatar: None,
                followers: Some(10),
                verified: false,
            },
            likes: 0,
            retweets: 0,
            replies: 0,
            views: 0,
            is_reply: false,
            is_retweet: false,
            coins: vec![],
            mentions: m,
            words: vec![],
        };
        let a = Mention::Ticker("AAA".into());
        let b = Mention::Address {
            chain: None,
            address: MINT.into(),
        };
        let mut posts = vec![
            post("1", "ansem", vec![a.clone()], 1),
            post("2", "ansem", vec![a.clone()], 2),
            post("3", "cz", vec![b.clone()], 3),
            post("4", "murad", vec![b.clone(), a.clone()], 4),
        ];
        let resolved = HashMap::from([(a, token("AAAA", "AAA")), (b.clone(), token(MINT, "BBB"))]);
        let ranked = rank(&mut posts, &resolved);
        // Both called by two accounts; AAA was mentioned more.
        assert_eq!(ranked[0].token.symbol, "AAA");
        assert_eq!(ranked[0].kols.len(), 2);
        assert_eq!(ranked[0].mentions, 3);
        assert_eq!(ranked[0].evidence, "ticker");
        assert_eq!(ranked[1].evidence, "contract");
        assert_eq!(posts[3].coins.len(), 2);

        // "$CCC, CA <mint>" names the ticker first, then the contract: it counts once, as a contract.
        let c = Mention::Ticker("CCC".into());
        let mut posts = vec![post("5", "ansem", vec![c.clone(), b.clone()], 5)];
        let resolved = HashMap::from([(c, token(MINT, "CCC")), (b, token(MINT, "CCC"))]);
        let ranked = rank(&mut posts, &resolved);
        assert_eq!(ranked.len(), 1);
        assert_eq!(ranked[0].mentions, 1);
        assert_eq!(ranked[0].evidence, "contract");
    }
}
