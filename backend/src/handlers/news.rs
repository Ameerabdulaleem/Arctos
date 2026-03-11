use axum::{extract::State, Json};
use chrono::Utc;
use std::sync::Arc;
use uuid::Uuid;

use crate::{
    error::Result,
    types::{NewsArticle, NewsSource},
    AppState,
};

fn mock_news() -> Vec<NewsArticle> {
    let now = Utc::now().to_rfc3339();
    vec![
        NewsArticle {
            id: Uuid::new_v4().to_string(),
            title: "Bitcoin Surges Past $95K as Institutional Demand Hits Record High".to_string(),
            excerpt: "Bitcoin reached a new monthly high after major ETF inflows exceeded $1.2 billion in a single trading day, signalling renewed institutional appetite.".to_string(),
            source: NewsSource {
                name: "CoinDesk".to_string(),
                url: "https://www.coindesk.com".to_string(),
            },
            category: "Bitcoin".to_string(),
            impact: "high".to_string(),
            published_at: now.clone(),
            image_url: Some("https://images.unsplash.com/photo-1518546305927-5a555bb7020d?w=800".to_string()),
            url: "https://www.coindesk.com/markets/2026/03/11/bitcoin-surges-institutional".to_string(),
            trending: true,
        },
        NewsArticle {
            id: Uuid::new_v4().to_string(),
            title: "Ethereum Dencun Upgrade Reduces L2 Fees by 90% — Ecosystem Responds".to_string(),
            excerpt: "Transaction costs on major Ethereum Layer 2 networks like Arbitrum and Optimism dropped dramatically following the Dencun upgrade's proto-danksharding.".to_string(),
            source: NewsSource {
                name: "The Block".to_string(),
                url: "https://www.theblock.co".to_string(),
            },
            category: "Ethereum".to_string(),
            impact: "high".to_string(),
            published_at: now.clone(),
            image_url: Some("https://images.unsplash.com/photo-1639762681485-074b7f938ba0?w=800".to_string()),
            url: "https://www.theblock.co/post/ethereum-dencun-l2-fees".to_string(),
            trending: true,
        },
        NewsArticle {
            id: Uuid::new_v4().to_string(),
            title: "SEC Approves Spot Solana ETF Applications from Three Major Asset Managers".to_string(),
            excerpt: "The U.S. Securities and Exchange Commission has given a green light to spot SOL ETFs, opening the door for retail investors to gain direct Solana exposure.".to_string(),
            source: NewsSource {
                name: "Decrypt".to_string(),
                url: "https://decrypt.co".to_string(),
            },
            category: "Regulation".to_string(),
            impact: "high".to_string(),
            published_at: now.clone(),
            image_url: Some("https://images.unsplash.com/photo-1621501103258-9a7b2b6d4a9e?w=800".to_string()),
            url: "https://decrypt.co/sec-approves-solana-etf".to_string(),
            trending: true,
        },
        NewsArticle {
            id: Uuid::new_v4().to_string(),
            title: "DeFi TVL Climbs to $180B as Liquid Staking Protocols Lead Growth".to_string(),
            excerpt: "Total Value Locked across decentralised finance hit $180 billion, driven by a surge in liquid staking tokens on Ethereum and Solana.".to_string(),
            source: NewsSource {
                name: "DeFi Pulse".to_string(),
                url: "https://defipulse.com".to_string(),
            },
            category: "DeFi".to_string(),
            impact: "medium".to_string(),
            published_at: now.clone(),
            image_url: None,
            url: "https://defipulse.com/defi-tvl-180b".to_string(),
            trending: false,
        },
        NewsArticle {
            id: Uuid::new_v4().to_string(),
            title: "Memecoin Season 2.0? On-Chain Data Shows PEPE, BONK Volume Spiking".to_string(),
            excerpt: "On-chain analytics reveal a sharp uptick in memecoin trading volumes over the past 48 hours, with PEPE and BONK leading inflows across ETH and Solana.".to_string(),
            source: NewsSource {
                name: "CryptoSlate".to_string(),
                url: "https://cryptoslate.com".to_string(),
            },
            category: "Altcoins".to_string(),
            impact: "medium".to_string(),
            published_at: now.clone(),
            image_url: None,
            url: "https://cryptoslate.com/memecoin-season-pepe-bonk".to_string(),
            trending: false,
        },
    ]
}

fn infer_category(title: &str) -> String {
    let lower = title.to_lowercase();
    if lower.contains("bitcoin") || lower.contains("btc") {
        "Bitcoin".to_string()
    } else if lower.contains("ethereum") || lower.contains("eth") {
        "Ethereum".to_string()
    } else if lower.contains("solana") || lower.contains("sol") {
        "Solana".to_string()
    } else if lower.contains("defi") || lower.contains("staking") || lower.contains("lending") {
        "DeFi".to_string()
    } else if lower.contains("sec") || lower.contains("regulat") || lower.contains("law") || lower.contains("ban") {
        "Regulation".to_string()
    } else if lower.contains("nft") || lower.contains("metaverse") {
        "NFT".to_string()
    } else if lower.contains("meme") || lower.contains("pepe") || lower.contains("doge") || lower.contains("shib") {
        "Altcoins".to_string()
    } else {
        "Market".to_string()
    }
}

fn infer_impact(title: &str) -> String {
    let lower = title.to_lowercase();
    if lower.contains("surge")
        || lower.contains("crash")
        || lower.contains("ban")
        || lower.contains("approve")
        || lower.contains("record")
        || lower.contains("etf")
    {
        "high".to_string()
    } else if lower.contains("rise")
        || lower.contains("fall")
        || lower.contains("update")
        || lower.contains("launch")
    {
        "medium".to_string()
    } else {
        "low".to_string()
    }
}

#[derive(serde::Deserialize)]
struct GNewsResponse {
    articles: Vec<GNewsArticle>,
}

#[derive(serde::Deserialize)]
struct GNewsArticle {
    title: String,
    description: Option<String>,
    url: String,
    image: Option<String>,
    #[serde(rename = "publishedAt")]
    published_at: String,
    source: GNewsSource,
}

#[derive(serde::Deserialize)]
struct GNewsSource {
    name: String,
    url: String,
}

async fn fetch_from_gnews(api_key: &str) -> anyhow::Result<Vec<NewsArticle>> {
    let url = format!(
        "https://gnews.io/api/v4/search?q=crypto+OR+bitcoin+OR+ethereum&lang=en&max=20&sortby=publishedAt&apikey={}",
        api_key
    );

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()?;

    let resp = client.get(&url).send().await?;
    if !resp.status().is_success() {
        anyhow::bail!("GNews returned status {}", resp.status());
    }

    let gnews: GNewsResponse = resp.json().await?;

    let articles = gnews
        .articles
        .into_iter()
        .enumerate()
        .map(|(i, a)| NewsArticle {
            id: Uuid::new_v4().to_string(),
            title: a.title.clone(),
            excerpt: a.description.unwrap_or_else(|| a.title.clone()),
            source: NewsSource {
                name: a.source.name,
                url: a.source.url,
            },
            category: infer_category(&a.title),
            impact: infer_impact(&a.title),
            published_at: a.published_at,
            image_url: a.image,
            url: a.url,
            trending: i < 3,
        })
        .collect();

    Ok(articles)
}

pub async fn get_news(State(state): State<Arc<AppState>>) -> Result<Json<Vec<NewsArticle>>> {
    if let Some(key) = &state.config.gnews_api_key {
        match fetch_from_gnews(key).await {
            Ok(articles) if !articles.is_empty() => return Ok(Json(articles)),
            Ok(_) => {}
            Err(e) => {
                tracing::warn!("GNews fetch failed: {}. Falling back to mock data.", e);
            }
        }
    }

    Ok(Json(mock_news()))
}
