//! Crypto news aggregation from public RSS feeds. No API keys involved.
//! Text is sanitised on the server so the browser never receives raw feed HTML.

use std::{
    collections::HashSet,
    sync::{Arc, RwLock},
    time::Duration,
};

use axum::{
    extract::{Query, State},
    Json,
};
use chrono::{DateTime, Utc};
use quick_xml::{
    events::{BytesStart, Event},
    Reader,
};
use serde::{Deserialize, Serialize};

use crate::AppState;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub name: String,
    pub color: &'static str,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Article {
    pub id: String,
    pub title: String,
    pub excerpt: String,
    pub source: Source,
    pub category: &'static str,
    pub impact: &'static str,
    pub published_at: DateTime<Utc>,
    pub image_url: Option<String>,
    pub url: String,
    pub trending: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedStatus {
    pub name: String,
    pub ok: bool,
    pub count: usize,
    pub error: Option<String>,
}

#[derive(Default)]
pub struct NewsStore {
    articles: RwLock<Vec<Article>>,
    feeds: RwLock<Vec<FeedStatus>>,
    fetched_at: RwLock<Option<DateTime<Utc>>>,
}

impl NewsStore {
    /// The newest `n` articles.
    pub fn top(&self, n: usize) -> Vec<Article> {
        self.articles
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .iter()
            .take(n)
            .cloned()
            .collect()
    }
}

// ── RSS parsing ──────────────────────────────────────────────────────────────

#[derive(Default, Debug)]
struct RawItem {
    title: String,
    link: String,
    description: String,
    content: String,
    pub_date: String,
    image: Option<String>,
}

fn attr(e: &BytesStart, key: &[u8]) -> Option<String> {
    e.attributes()
        .flatten()
        .find(|a| a.key.as_ref() == key)
        .and_then(|a| a.unescape_value().ok())
        .map(|v| v.into_owned())
}

fn parse_items(xml: &str) -> Vec<RawItem> {
    let mut reader = Reader::from_str(xml);
    let mut items: Vec<RawItem> = Vec::new();
    let mut current: Option<RawItem> = None;
    let mut tag: Vec<u8> = Vec::new();

    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => {
                let name = e.name().as_ref().to_vec();
                if name == b"item" || name == b"entry" {
                    current = Some(RawItem::default());
                } else if let Some(item) = current.as_mut() {
                    if name == b"link" {
                        // Atom style <link href="..."/> written as a start tag.
                        if let Some(h) = attr(&e, b"href") {
                            if item.link.is_empty() {
                                item.link = h;
                            }
                        }
                    }
                    if (name == b"media:content"
                        || name == b"media:thumbnail"
                        || name == b"enclosure")
                        && item.image.is_none()
                    {
                        item.image = attr(&e, b"url");
                    }
                    tag = name;
                }
            }
            Ok(Event::Empty(e)) => {
                if let Some(item) = current.as_mut() {
                    let name = e.name().as_ref().to_vec();
                    if name == b"link" && item.link.is_empty() {
                        if let Some(h) = attr(&e, b"href") {
                            item.link = h;
                        }
                    }
                    if (name == b"media:content"
                        || name == b"media:thumbnail"
                        || name == b"enclosure")
                        && item.image.is_none()
                    {
                        item.image = attr(&e, b"url");
                    }
                }
            }
            Ok(Event::Text(t)) => {
                if let (Some(item), Ok(text)) = (current.as_mut(), t.unescape()) {
                    push_text(item, &tag, &text);
                }
            }
            Ok(Event::CData(c)) => {
                if let Some(item) = current.as_mut() {
                    let text = String::from_utf8_lossy(&c.into_inner()).into_owned();
                    push_text(item, &tag, &text);
                }
            }
            Ok(Event::End(e)) => {
                let name = e.name().as_ref().to_vec();
                if name == b"item" || name == b"entry" {
                    if let Some(item) = current.take() {
                        items.push(item);
                    }
                }
                tag.clear();
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
        if items.len() >= 100 {
            break;
        }
    }
    items
}

fn push_text(item: &mut RawItem, tag: &[u8], text: &str) {
    let target = match tag {
        b"title" => &mut item.title,
        b"link" => &mut item.link,
        b"description" | b"summary" => &mut item.description,
        b"content:encoded" | b"content" => &mut item.content,
        b"pubDate" | b"published" | b"updated" | b"dc:date" => &mut item.pub_date,
        _ => return,
    };
    if target.len() < 20_000 {
        target.push_str(text);
    }
}

// ── Sanitising and classification ────────────────────────────────────────────

/// Removes tags and scripts, decodes common entities and collapses whitespace.
pub fn clean_text(input: &str, max_chars: usize) -> String {
    let mut out = String::with_capacity(input.len().min(2000));
    let mut in_tag = false;
    for ch in input.chars() {
        match ch {
            '<' => in_tag = true,
            '>' if in_tag => {
                in_tag = false;
                out.push(' ');
            }
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    let decoded = decode_entities(&out);
    let collapsed: Vec<&str> = decoded.split_whitespace().collect();
    let mut text = collapsed.join(" ");
    if text.chars().count() > max_chars {
        text = text
            .chars()
            .take(max_chars.saturating_sub(1))
            .collect::<String>()
            .trim_end()
            .to_string()
            + "…";
    }
    text
}

fn decode_entities(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(pos) = rest.find('&') {
        out.push_str(&rest[..pos]);
        let tail = &rest[pos..];
        if let Some(end) = tail[..tail.len().min(12)].find(';') {
            let entity = &tail[1..end];
            let decoded = match entity {
                "amp" => Some('&'),
                "lt" => Some('<'),
                "gt" => Some('>'),
                "quot" => Some('"'),
                "apos" => Some('\''),
                "nbsp" => Some(' '),
                _ if entity.starts_with("#x") || entity.starts_with("#X") => {
                    u32::from_str_radix(&entity[2..], 16)
                        .ok()
                        .and_then(char::from_u32)
                }
                _ if entity.starts_with('#') => {
                    entity[1..].parse::<u32>().ok().and_then(char::from_u32)
                }
                _ => None,
            };
            if let Some(c) = decoded {
                out.push(c);
                rest = &tail[end + 1..];
                continue;
            }
        }
        out.push('&');
        rest = &tail[1..];
    }
    out.push_str(rest);
    out
}

fn words(text: &str) -> HashSet<String> {
    text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(String::from)
        .collect()
}

fn padded(text: &str) -> String {
    let joined: Vec<String> = text
        .to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(String::from)
        .collect();
    format!(" {} ", joined.join(" "))
}

fn any_word(set: &HashSet<String>, list: &[&str]) -> bool {
    list.iter().any(|w| set.contains(*w))
}

pub fn categorize(text: &str) -> &'static str {
    let w = words(text);
    if any_word(
        &w,
        &[
            "hack",
            "hacked",
            "hacker",
            "hackers",
            "exploit",
            "exploited",
            "drained",
            "breach",
            "phishing",
            "rug",
            "scam",
        ],
    ) {
        "Security"
    } else if any_word(
        &w,
        &[
            "sec",
            "regulation",
            "regulations",
            "regulator",
            "regulators",
            "regulatory",
            "lawsuit",
            "court",
            "ban",
            "banned",
            "congress",
            "senate",
            "cftc",
            "mica",
            "legislation",
            "lawmakers",
        ],
    ) {
        "Regulation"
    } else if any_word(&w, &["etf", "etfs"]) {
        "ETF"
    } else if any_word(&w, &["bitcoin", "btc"]) {
        "Bitcoin"
    } else if any_word(&w, &["ethereum", "eth", "ether"]) {
        "Ethereum"
    } else if any_word(&w, &["solana", "sol"]) {
        "Solana"
    } else if any_word(
        &w,
        &[
            "stablecoin",
            "stablecoins",
            "usdt",
            "usdc",
            "tether",
            "circle",
        ],
    ) {
        "Stablecoins"
    } else if any_word(
        &w,
        &[
            "defi",
            "dex",
            "yield",
            "liquidity",
            "staking",
            "lending",
            "amm",
        ],
    ) {
        "DeFi"
    } else if any_word(&w, &["nft", "nfts"]) {
        "NFT"
    } else if any_word(
        &w,
        &[
            "binance",
            "coinbase",
            "kraken",
            "okx",
            "bybit",
            "exchange",
            "exchanges",
        ],
    ) {
        "Exchange"
    } else if any_word(
        &w,
        &[
            "fed",
            "inflation",
            "rates",
            "cpi",
            "fomc",
            "tariff",
            "tariffs",
            "economy",
            "treasury",
            "dollar",
            "recession",
        ],
    ) {
        "Macro"
    } else {
        "Market"
    }
}

pub fn impact_of(text: &str) -> &'static str {
    let w = words(text);
    let p = padded(text);
    const HIGH: &[&str] = &[
        "hack",
        "hacked",
        "exploit",
        "exploited",
        "drained",
        "breach",
        "lawsuit",
        "sues",
        "sued",
        "ban",
        "banned",
        "bankruptcy",
        "insolvent",
        "liquidations",
        "liquidated",
        "crash",
        "crashes",
        "plunge",
        "plunges",
        "collapse",
        "sec",
        "etf",
        "approval",
        "approves",
        "approved",
        "halving",
        "sanctions",
        "seized",
        "arrested",
    ];
    const MEDIUM: &[&str] = &[
        "launch",
        "launches",
        "partnership",
        "upgrade",
        "integration",
        "mainnet",
        "airdrop",
        "listing",
        "lists",
        "surge",
        "surges",
        "rally",
        "rallies",
        "soars",
        "jumps",
        "tumbles",
        "acquires",
        "acquisition",
        "raises",
        "funding",
        "adoption",
    ];
    if any_word(&w, HIGH)
        || p.contains(" rate cut ")
        || p.contains(" rate hike ")
        || p.contains(" all time high ")
    {
        "high"
    } else if any_word(&w, MEDIUM) {
        "medium"
    } else {
        "low"
    }
}

fn is_trending(published: DateTime<Utc>, impact: &str, text: &str, now: DateTime<Utc>) -> bool {
    let fresh = now.signed_duration_since(published) <= chrono::Duration::hours(4);
    let hot = any_word(&words(text), &["breaking", "urgent", "record"]);
    (fresh && impact != "low") || hot
}

fn source_color(name: &str) -> &'static str {
    match name {
        "CoinDesk" => "#FF6B00",
        "Cointelegraph" => "#FDB022",
        "Decrypt" => "#00C2A8",
        "The Block" => "#00B4D8",
        "CryptoSlate" => "#4F46E5",
        "Bitcoin Magazine" => "#F7931A",
        "BeInCrypto" => "#EC4899",
        "U.Today" => "#22C55E",
        _ => "#94A3B8",
    }
}

fn fnv_hex(s: &str) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in s.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("{h:016x}")
}

fn parse_date(s: &str) -> Option<DateTime<Utc>> {
    let s = s.trim();
    DateTime::parse_from_rfc2822(s)
        .or_else(|_| DateTime::parse_from_rfc3339(s))
        .ok()
        .map(|d| d.with_timezone(&Utc))
}

fn http_url(u: &str) -> Option<String> {
    let u = u.trim();
    (u.starts_with("https://") || u.starts_with("http://")).then(|| u.to_string())
}

pub fn articles_from_feed(source_name: &str, xml: &str, now: DateTime<Utc>) -> Vec<Article> {
    parse_items(xml)
        .into_iter()
        .filter_map(|item| {
            let title = clean_text(&item.title, 200);
            let url = http_url(&item.link)?;
            if title.is_empty() {
                return None;
            }
            let body = if item.description.trim().is_empty() {
                &item.content
            } else {
                &item.description
            };
            let excerpt = clean_text(body, 280);
            // Feeds without a date would otherwise look brand new every poll, so skip them.
            let published = parse_date(&item.pub_date)?;
            if published > now + chrono::Duration::hours(1)
                || now.signed_duration_since(published) > chrono::Duration::days(7)
            {
                return None;
            }
            let text = format!("{title} {excerpt}");
            let impact = impact_of(&text);
            Some(Article {
                id: fnv_hex(&url),
                title,
                category: categorize(&text),
                impact,
                trending: is_trending(published, impact, &text, now),
                excerpt,
                source: Source {
                    name: source_name.to_string(),
                    color: source_color(source_name),
                },
                published_at: published,
                image_url: item.image.as_deref().and_then(http_url),
                url,
            })
        })
        .collect()
}

fn dedupe_key(a: &Article) -> String {
    a.title
        .to_lowercase()
        .chars()
        .filter(|c| c.is_alphanumeric())
        .take(80)
        .collect()
}

pub fn merge_articles(mut all: Vec<Article>) -> Vec<Article> {
    all.sort_by_key(|a| std::cmp::Reverse(a.published_at));
    let mut seen_title: HashSet<String> = HashSet::new();
    let mut seen_url: HashSet<String> = HashSet::new();
    all.retain(|a| seen_url.insert(a.url.clone()) && seen_title.insert(dedupe_key(a)));
    all.truncate(150);
    all
}

// ── Poller ───────────────────────────────────────────────────────────────────

async fn refresh(state: &Arc<AppState>) {
    let now = Utc::now();
    let fetches = state.config.news_feeds.iter().map(|(name, url)| {
        let st = state.clone();
        let name = name.clone();
        let url = url.clone();
        async move {
            let result = st.up.get_text(&format!("news:{name}"), &url).await;
            (name, result)
        }
    });
    let results = futures_util::future::join_all(fetches).await;
    let mut all: Vec<Article> = Vec::new();
    let mut statuses: Vec<FeedStatus> = Vec::new();
    for (name, result) in results {
        match result {
            Ok(xml) => {
                let items = articles_from_feed(&name, &xml, now);
                statuses.push(FeedStatus {
                    name,
                    ok: !items.is_empty(),
                    count: items.len(),
                    error: items
                        .is_empty()
                        .then(|| "feed had no usable items".to_string()),
                });
                all.extend(items);
            }
            Err(e) => statuses.push(FeedStatus {
                name,
                ok: false,
                count: 0,
                error: Some(e.to_string().chars().take(120).collect()),
            }),
        }
    }
    if !all.is_empty() {
        *state
            .news
            .articles
            .write()
            .unwrap_or_else(|e| e.into_inner()) = merge_articles(all);
        *state
            .news
            .fetched_at
            .write()
            .unwrap_or_else(|e| e.into_inner()) = Some(now);
    }
    *state.news.feeds.write().unwrap_or_else(|e| e.into_inner()) = statuses;
}

pub fn spawn_pollers(state: Arc<AppState>) {
    tokio::spawn(async move {
        loop {
            refresh(&state).await;
            tokio::time::sleep(Duration::from_secs(120)).await;
        }
    });
}

// ── Handler ──────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct NewsQuery {
    limit: Option<usize>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NewsResponse {
    articles: Vec<Article>,
    fetched_at: Option<DateTime<Utc>>,
    feeds: Vec<FeedStatus>,
}

pub async fn get_news(
    State(state): State<Arc<AppState>>,
    Query(q): Query<NewsQuery>,
) -> Json<NewsResponse> {
    let limit = q.limit.unwrap_or(100).clamp(1, 150);
    let articles: Vec<Article> = state
        .news
        .articles
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .iter()
        .take(limit)
        .cloned()
        .collect();
    Json(NewsResponse {
        articles,
        fetched_at: *state
            .news
            .fetched_at
            .read()
            .unwrap_or_else(|e| e.into_inner()),
        feeds: state
            .news
            .feeds
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn now() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 1, 2, 12, 0, 0).unwrap()
    }

    const FEED: &str = r#"<?xml version="1.0"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:media="http://search.yahoo.com/mrss/">
<channel><title>Example</title>
<item>
  <title><![CDATA[SEC approves new Bitcoin ETF &amp; options]]></title>
  <link>https://example.com/a</link>
  <description><![CDATA[<p>The <b>regulator</b> signed off today.<script>alert(1)</script></p>]]></description>
  <pubDate>Fri, 02 Jan 2026 11:00:00 +0000</pubDate>
  <media:content url="https://example.com/a.jpg" medium="image"/>
</item>
<item>
  <title>Javascript link should be dropped</title>
  <link>javascript:alert(1)</link>
  <pubDate>Fri, 02 Jan 2026 11:00:00 +0000</pubDate>
</item>
<item>
  <title>No date means skipped</title>
  <link>https://example.com/nodate</link>
</item>
<item>
  <title>Old story</title>
  <link>https://example.com/old</link>
  <pubDate>Mon, 01 Dec 2025 11:00:00 +0000</pubDate>
</item>
</channel></rss>"#;

    #[test]
    fn parses_cleans_and_filters() {
        let a = articles_from_feed("CoinDesk", FEED, now());
        assert_eq!(a.len(), 1);
        assert_eq!(a[0].title, "SEC approves new Bitcoin ETF & options");
        assert_eq!(
            a[0].excerpt, "The regulator signed off today. alert(1)",
            "tags are stripped, text kept"
        );
        assert!(!a[0].excerpt.contains('<'));
        assert_eq!(a[0].url, "https://example.com/a");
        assert_eq!(a[0].image_url.as_deref(), Some("https://example.com/a.jpg"));
        assert_eq!(a[0].impact, "high");
        assert_eq!(a[0].category, "Regulation");
        assert!(a[0].trending, "fresh and high impact");
        assert_eq!(a[0].source.name, "CoinDesk");
    }

    #[test]
    fn word_matching_avoids_substring_false_positives() {
        assert_eq!(
            categorize("A new solution for together we grow"),
            "Market",
            "sol/eth inside words must not match"
        );
        assert_eq!(categorize("Solana validators upgrade"), "Solana");
        assert_eq!(categorize("Ether staking yields rise"), "Ethereum");
        assert_eq!(
            impact_of("Second quarter second look"),
            "low",
            "'sec' must not match 'second'"
        );
        assert_eq!(impact_of("Fed signals a rate cut"), "high");
        assert_eq!(impact_of("Exchange announces new listing"), "medium");
        assert_eq!(
            categorize("Exploit drains $10M from lending protocol"),
            "Security"
        );
    }

    #[test]
    fn clean_text_handles_entities_and_truncation() {
        assert_eq!(
            clean_text("Tom &amp; Jerry &#8217;s &lt;b&gt; &#x41;", 100),
            "Tom & Jerry ’s <b> A"
        );
        assert_eq!(clean_text("  a   b\n c ", 100), "a b c");
        let long = "word ".repeat(100);
        let c = clean_text(&long, 20);
        assert!(c.chars().count() <= 20 && c.ends_with('…'));
        assert_eq!(
            clean_text("broken &entity; and & alone", 100),
            "broken &entity; and & alone"
        );
    }

    #[test]
    fn merge_dedupes_by_url_and_title() {
        let mk = |title: &str, url: &str, mins: i64| Article {
            id: fnv_hex(url),
            title: title.into(),
            excerpt: String::new(),
            source: Source {
                name: "x".into(),
                color: "#000",
            },
            category: "Market",
            impact: "low",
            published_at: now() - chrono::Duration::minutes(mins),
            image_url: None,
            url: url.into(),
            trending: false,
        };
        let merged = merge_articles(vec![
            mk("Bitcoin hits a high", "https://a/1", 30),
            mk("Bitcoin Hits A High!", "https://b/2", 10), // same story from another outlet
            mk("Different story", "https://a/3", 20),
            mk("Different story again", "https://a/3", 5), // same URL
        ]);
        assert_eq!(merged.len(), 2);
        assert_eq!(
            merged[0].title, "Different story again",
            "newest first, and the older copy with the same URL is dropped"
        );
        assert_eq!(
            merged[1].url, "https://b/2",
            "the newest copy of the duplicated headline survives"
        );
    }

    #[test]
    fn atom_style_links_are_supported() {
        let atom = r#"<feed><entry><title>Atom item</title><link href="https://example.com/atom"/>
            <updated>2026-01-02T11:30:00Z</updated><summary>hello</summary></entry></feed>"#;
        let a = articles_from_feed("U.Today", atom, now());
        assert_eq!(a.len(), 1);
        assert_eq!(a[0].url, "https://example.com/atom");
    }
}
