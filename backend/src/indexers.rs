//! Wallet indexers: services that list every token and NFT a wallet holds,
//! which plain chain RPC cannot do.
//!
//! * Alchemy's Portfolio API (optional `ALCHEMY_API_KEY`, free tier): every
//!   token, priced, on the main EVM chains, and NFTs on the chains it indexes.
//! * Magic Eden's public API (no key): NFTs in a Solana wallet.
//!
//! The parsers are pure functions so they can be tested against recorded
//! answers. Everything a provider says is checked and trimmed before use.

use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};

use crate::{news::clean_text, upstream::UpstreamError, AppState};

/// EVM networks Alchemy indexes, with the chain key and name Arctos uses.
pub(crate) const ALCHEMY_NETWORKS: &[(&str, &str, &str, &str)] = &[
    // (alchemy network, chain key, chain name, native symbol)
    ("eth-mainnet", "ethereum", "Ethereum", "ETH"),
    ("bnb-mainnet", "bsc", "BNB Chain", "BNB"),
    ("base-mainnet", "base", "Base", "ETH"),
    ("arb-mainnet", "arbitrum", "Arbitrum", "ETH"),
    ("opt-mainnet", "optimism", "Optimism", "ETH"),
    ("matic-mainnet", "polygon", "Polygon", "POL"),
    ("avax-mainnet", "avalanche", "Avalanche", "AVAX"),
    ("linea-mainnet", "linea", "Linea", "ETH"),
    ("sonic-mainnet", "sonic", "Sonic", "S"),
];
/// Networks Alchemy's NFT index covers (it has no BNB Chain or Sonic NFTs).
const ALCHEMY_NFT_NETWORKS: &[&str] = &[
    "eth-mainnet",
    "base-mainnet",
    "arb-mainnet",
    "opt-mainnet",
    "matic-mainnet",
    "avax-mainnet",
    "linea-mainnet",
];
/// Alchemy takes at most five networks per address in one request.
const NETWORKS_PER_REQUEST: usize = 5;
const MAX_PAGES: usize = 3;
pub(crate) const MAX_NFTS: usize = 60;
const TIMEOUT: Duration = Duration::from_secs(12);

fn network(slug: &str) -> Option<(&'static str, &'static str, &'static str)> {
    ALCHEMY_NETWORKS
        .iter()
        .find(|(n, ..)| *n == slug)
        .map(|(_, key, name, native)| (*key, *name, *native))
}

/// One token balance from an indexer, before it is turned into a holding.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct IndexedToken {
    pub chain: &'static str,
    pub chain_name: &'static str,
    /// `None` for the chain's native coin.
    pub address: Option<String>,
    pub symbol: String,
    pub name: String,
    pub decimals: u8,
    pub raw: u128,
    pub price_usd: Option<f64>,
    pub logo: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Nft {
    pub chain: String,
    pub chain_name: String,
    /// The NFT contract (EVM) or mint (Solana).
    pub contract: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token_id: Option<String>,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub collection: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
    pub standard: String,
}

/// An image address the page may load: https, IPFS or Arweave (through a
/// public gateway), or a small inline image. Anything else is dropped.
pub(crate) fn safe_image(url: &str) -> Option<String> {
    let url = url.trim();
    // Inline images: raster or base64 only, and not too large.
    if url.starts_with("data:image/") {
        let plain_svg = url.starts_with("data:image/svg+xml") && !url.contains(";base64,");
        return (!plain_svg && url.len() <= 100_000).then(|| url.to_string());
    }
    if url.len() > 2048 {
        return None;
    }
    if let Some(rest) = url.strip_prefix("ipfs://") {
        let rest = rest.trim_start_matches("ipfs/");
        return (!rest.is_empty() && rest.bytes().all(|b| b.is_ascii_graphic()))
            .then(|| format!("https://ipfs.io/ipfs/{rest}"));
    }
    if let Some(rest) = url.strip_prefix("ar://") {
        return (!rest.is_empty()
            && rest
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'))
        .then(|| format!("https://arweave.net/{rest}"));
    }
    if url.starts_with("https://") && url.bytes().all(|b| b.is_ascii_graphic()) {
        return Some(url.to_string());
    }
    None
}

fn hex_u128(s: &str) -> Option<u128> {
    let s = s.strip_prefix("0x").unwrap_or(s);
    if s.is_empty() {
        return Some(0);
    }
    if s.len() > 32 {
        // More than fits in 128 bits: only spam tokens claim balances this large.
        return None;
    }
    u128::from_str_radix(s, 16).ok()
}

fn evm_address(v: &Value) -> Option<String> {
    v.as_str()
        .filter(|a| {
            a.len() == 42 && a.starts_with("0x") && a[2..].bytes().all(|b| b.is_ascii_hexdigit())
        })
        .map(|a| a.to_ascii_lowercase())
}

/// Reads one page of Alchemy's tokens by wallet answer.
pub(crate) fn parse_alchemy_tokens(
    reply: &Value,
) -> (Vec<IndexedToken>, Vec<String>, Option<String>) {
    let mut out = Vec::new();
    let tokens = reply
        .pointer("/data/tokens")
        .and_then(|t| t.as_array())
        .map(|a| a.as_slice())
        .unwrap_or(&[]);
    for t in tokens {
        if t.get("error").is_some_and(|e| !e.is_null()) {
            continue;
        }
        let Some((chain, chain_name, native)) =
            t.get("network").and_then(|n| n.as_str()).and_then(network)
        else {
            continue;
        };
        let Some(raw) = t
            .get("tokenBalance")
            .and_then(|b| b.as_str())
            .and_then(hex_u128)
        else {
            continue;
        };
        if raw == 0 {
            continue;
        }
        let address = match t.get("tokenAddress") {
            Some(Value::Null) | None => None,
            Some(a) => match evm_address(a) {
                Some(a) => Some(a),
                None => continue,
            },
        };
        let meta = t.get("tokenMetadata").cloned().unwrap_or(Value::Null);
        let decimals = meta
            .get("decimals")
            .and_then(|d| d.as_u64())
            .filter(|d| *d <= 36)
            .unwrap_or(if address.is_none() { 18 } else { 255 });
        if decimals > 36 {
            continue;
        }
        let text = |k: &str, max: usize| {
            meta.get(k)
                .and_then(|v| v.as_str())
                .map(|s| clean_text(s, max))
                .unwrap_or_default()
        };
        let mut symbol = text("symbol", 16);
        let mut name = text("name", 48);
        if address.is_none() {
            if symbol.is_empty() {
                symbol = native.to_string();
            }
            if name.is_empty() {
                name = chain_name.to_string();
            }
        }
        let price_usd = t
            .get("tokenPrices")
            .and_then(|p| p.as_array())
            .and_then(|prices| {
                prices
                    .iter()
                    .find(|p| p.get("currency").and_then(|c| c.as_str()) == Some("usd"))
            })
            .and_then(|p| p.get("value"))
            .and_then(|v| {
                v.as_str()
                    .and_then(|s| s.parse::<f64>().ok())
                    .or_else(|| v.as_f64())
            })
            .filter(|p| p.is_finite() && *p >= 0.0);
        out.push(IndexedToken {
            chain,
            chain_name,
            address,
            symbol,
            name,
            decimals: decimals as u8,
            raw,
            price_usd,
            logo: meta
                .get("logo")
                .and_then(|l| l.as_str())
                .and_then(safe_image)
                .filter(|l| l.starts_with("https://")),
        });
    }
    let failed = reply
        .pointer("/error/partialErrors")
        .and_then(|e| e.as_array())
        .map(|list| {
            list.iter()
                .filter_map(|e| e.get("network").and_then(|n| n.as_str()))
                .filter_map(network)
                .map(|(key, ..)| key.to_string())
                .collect()
        })
        .unwrap_or_default();
    let page = reply
        .pointer("/data/pageKey")
        .and_then(|p| p.as_str())
        .filter(|p| !p.is_empty() && p.len() <= 512)
        .map(str::to_owned);
    (out, failed, page)
}

/// Reads one page of Alchemy's NFTs by wallet answer.
pub(crate) fn parse_alchemy_nfts(reply: &Value) -> (Vec<Nft>, Option<String>) {
    let mut out = Vec::new();
    let items = reply
        .pointer("/data/ownedNfts")
        .and_then(|t| t.as_array())
        .map(|a| a.as_slice())
        .unwrap_or(&[]);
    for n in items {
        let Some((chain, chain_name, _)) =
            n.get("network").and_then(|v| v.as_str()).and_then(network)
        else {
            continue;
        };
        let Some(contract) = n.pointer("/contract/address").and_then(evm_address) else {
            continue;
        };
        let standard = n
            .pointer("/contract/tokenType")
            .or_else(|| n.get("tokenType"))
            .and_then(|t| t.as_str())
            .unwrap_or("");
        if standard != "ERC721" && standard != "ERC1155" {
            continue;
        }
        if n.pointer("/contract/isSpam").and_then(|s| s.as_bool()) == Some(true) {
            continue;
        }
        let image = [
            "/image/thumbnailUrl",
            "/image/cachedUrl",
            "/image/pngUrl",
            "/image/originalUrl",
            "/raw/metadata/image",
        ]
        .iter()
        .filter_map(|p| n.pointer(p).and_then(|v| v.as_str()))
        .find_map(safe_image);
        let collection = n
            .pointer("/contract/openseaMetadata/collectionName")
            .or_else(|| n.pointer("/contract/name"))
            .and_then(|v| v.as_str())
            .map(|s| clean_text(s, 60))
            .filter(|s| !s.is_empty());
        let token_id = n
            .get("tokenId")
            .and_then(|v| v.as_str())
            .filter(|t| t.len() <= 80 && t.bytes().all(|b| b.is_ascii_digit()))
            .map(str::to_owned);
        let name = n
            .get("name")
            .and_then(|v| v.as_str())
            .map(|s| clean_text(s, 80))
            .filter(|s| !s.is_empty())
            .or_else(|| {
                collection.clone().map(|c| match &token_id {
                    Some(id) if id.len() <= 12 => format!("{c} #{id}"),
                    _ => c,
                })
            });
        // Without a name or a picture there is nothing worth showing, and it is usually spam.
        let Some(name) = name else { continue };
        if image.is_none() && collection.is_none() {
            continue;
        }
        out.push(Nft {
            chain: chain.into(),
            chain_name: chain_name.into(),
            contract,
            token_id,
            name,
            collection,
            image,
            standard: standard.into(),
        });
    }
    let page = reply
        .pointer("/data/pageKey")
        .and_then(|p| p.as_str())
        .filter(|p| !p.is_empty() && p.len() <= 512)
        .map(str::to_owned);
    (out, page)
}

/// Reads Magic Eden's list of NFTs in a Solana wallet.
pub(crate) fn parse_magiceden_nfts(reply: &Value) -> Vec<Nft> {
    let mut out = Vec::new();
    for n in reply.as_array().map(|a| a.as_slice()).unwrap_or(&[]) {
        let Some(mint) = n
            .get("mintAddress")
            .and_then(|m| m.as_str())
            .filter(|m| crate::sniper::valid_solana_address(m))
        else {
            continue;
        };
        let Some(name) = n
            .get("name")
            .and_then(|v| v.as_str())
            .map(|s| clean_text(s, 80))
            .filter(|s| !s.is_empty())
        else {
            continue;
        };
        let collection = n
            .get("collectionName")
            .or_else(|| n.get("collection"))
            .and_then(|v| v.as_str())
            .map(|s| clean_text(s, 60))
            .filter(|s| !s.is_empty());
        let image = n.get("image").and_then(|v| v.as_str()).and_then(safe_image);
        // Nothing to show and no collection: usually spam.
        if image.is_none() && collection.is_none() {
            continue;
        }
        let standard = if n.get("isCompressed").and_then(|c| c.as_bool()) == Some(true) {
            "Compressed NFT"
        } else {
            "Solana NFT"
        };
        out.push(Nft {
            chain: "solana".into(),
            chain_name: "Solana".into(),
            contract: mint.into(),
            token_id: None,
            name,
            collection,
            image,
            standard: standard.into(),
        });
    }
    out
}

fn alchemy_url(state: &AppState, path: &str) -> Option<String> {
    let key = state.config.alchemy_api_key.as_deref()?;
    Some(format!(
        "{}/{key}/{path}",
        state.config.alchemy_base.trim_end_matches('/')
    ))
}

/// Every token in an EVM wallet on Alchemy's networks. Returns the tokens and
/// the chains that could not be read. `None` when no key is set.
pub(crate) async fn alchemy_tokens(
    state: &AppState,
    wallet: &str,
) -> Option<Result<(Vec<IndexedToken>, Vec<String>), UpstreamError>> {
    let url = alchemy_url(state, "assets/tokens/by-address")?;
    let chunks: Vec<Vec<&str>> = ALCHEMY_NETWORKS
        .chunks(NETWORKS_PER_REQUEST)
        .map(|c| c.iter().map(|(n, ..)| *n).collect())
        .collect();
    let calls = chunks.into_iter().map(|networks| {
        let url = url.clone();
        async move {
            let mut tokens = Vec::new();
            let mut failed = Vec::new();
            let mut page: Option<String> = None;
            for _ in 0..MAX_PAGES {
                let mut body = json!({
                    "addresses": [{"address": wallet, "networks": networks}],
                    "withMetadata": true,
                    "withPrices": true,
                    "includeNativeTokens": true,
                    "includeErc20Tokens": true,
                });
                if let Some(p) = &page {
                    body["pageKey"] = json!(p);
                }
                let reply: Value = state
                    .up
                    .post_json("alchemy", &url, &body, &[], Some(TIMEOUT))
                    .await?;
                let (t, f, next) = parse_alchemy_tokens(&reply);
                tokens.extend(t);
                failed.extend(f);
                match next {
                    Some(n) => page = Some(n),
                    None => break,
                }
            }
            Ok::<_, UpstreamError>((tokens, failed))
        }
    });
    let results = futures_util::future::join_all(calls).await;
    let mut tokens = Vec::new();
    let mut failed = Vec::new();
    let mut last_err = None;
    let mut any_ok = false;
    for (i, r) in results.into_iter().enumerate() {
        match r {
            Ok((t, f)) => {
                any_ok = true;
                tokens.extend(t);
                failed.extend(f);
            }
            Err(e) => {
                last_err = Some(e);
                let chunk = &ALCHEMY_NETWORKS[i * NETWORKS_PER_REQUEST
                    ..((i + 1) * NETWORKS_PER_REQUEST).min(ALCHEMY_NETWORKS.len())];
                failed.extend(chunk.iter().map(|(_, key, ..)| key.to_string()));
            }
        }
    }
    if !any_ok {
        return Some(Err(
            last_err.unwrap_or_else(|| UpstreamError::Network("alchemy".into()))
        ));
    }
    failed.sort();
    failed.dedup();
    Some(Ok((tokens, failed)))
}

/// NFTs in an EVM wallet. Empty without a key or when the index cannot be reached.
pub(crate) async fn alchemy_nfts(state: &AppState, wallet: &str) -> Vec<Nft> {
    let Some(url) = alchemy_url(state, "assets/nfts/by-address") else {
        return Vec::new();
    };
    let calls = ALCHEMY_NFT_NETWORKS
        .chunks(NETWORKS_PER_REQUEST)
        .map(|networks| {
            let url = url.clone();
            async move {
                let body = json!({
                    "addresses": [{"address": wallet, "networks": networks}],
                    "withMetadata": true,
                    "pageSize": 50,
                });
                state
                    .up
                    .post_json::<Value>("alchemy", &url, &body, &[], Some(TIMEOUT))
                    .await
                    .map(|reply| parse_alchemy_nfts(&reply).0)
                    .unwrap_or_default()
            }
        });
    let mut out: Vec<Nft> = futures_util::future::join_all(calls)
        .await
        .into_iter()
        .flatten()
        .collect();
    out.truncate(MAX_NFTS);
    out
}

/// NFTs in a Solana wallet, from Magic Eden. Empty when it cannot be reached.
pub(crate) async fn solana_nfts(state: &AppState, wallet: &str) -> Vec<Nft> {
    let url = format!(
        "{}/wallets/{wallet}/tokens",
        state.config.magiceden_base.trim_end_matches('/')
    );
    match state
        .up
        .get_json_with::<Value>(
            "magiceden",
            &url,
            &[("offset", "0".into()), ("limit", "100".into())],
            &[],
        )
        .await
    {
        Ok(reply) => {
            let mut nfts = parse_magiceden_nfts(&reply);
            nfts.truncate(MAX_NFTS);
            nfts
        }
        Err(_) => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn images_are_made_safe() {
        assert_eq!(
            safe_image("ipfs://QmAbc/1.png").as_deref(),
            Some("https://ipfs.io/ipfs/QmAbc/1.png")
        );
        assert_eq!(
            safe_image("ipfs://ipfs/QmAbc").as_deref(),
            Some("https://ipfs.io/ipfs/QmAbc")
        );
        assert_eq!(
            safe_image("ar://abc-DEF_1").as_deref(),
            Some("https://arweave.net/abc-DEF_1")
        );
        assert_eq!(
            safe_image("https://x.example/a.png").as_deref(),
            Some("https://x.example/a.png")
        );
        assert!(safe_image("http://x.example/a.png").is_none());
        assert!(safe_image("javascript:alert(1)").is_none());
        assert!(safe_image("https://x.example/a b.png").is_none());
        assert!(safe_image("data:text/html,<script>").is_none());
        assert!(safe_image("data:image/png;base64,AAAA").is_some());
    }

    #[test]
    fn reads_alchemy_tokens_with_natives_prices_and_failures() {
        let reply = json!({
            "data": {
                "tokens": [
                    {"address": "0x1", "network": "eth-mainnet", "tokenAddress": null, "tokenBalance": "0x0de0b6b3a7640000",
                     "tokenMetadata": {"decimals": 18, "symbol": "ETH", "name": "Ethereum", "logo": "https://static.example/eth.png"},
                     "tokenPrices": [{"currency": "usd", "value": "3000.5", "lastUpdatedAt": "2026-01-01T00:00:00Z"}]},
                    {"address": "0x1", "network": "bnb-mainnet", "tokenAddress": "0x0E09FABB73BD3ADE0A17ECC321FD13A19E81CE82", "tokenBalance": "0x3635c9adc5dea00000",
                     "tokenMetadata": {"decimals": 18, "symbol": "Cake", "name": "PancakeSwap Token", "logo": "javascript:x"}, "tokenPrices": []},
                    {"address": "0x1", "network": "base-mainnet", "tokenAddress": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", "tokenBalance": "0x0"},
                    {"address": "0x1", "network": "eth-mainnet", "tokenAddress": "0xbad", "tokenBalance": "0x1"},
                    {"address": "0x1", "network": "unknown-mainnet", "tokenAddress": null, "tokenBalance": "0x1"},
                    {"address": "0x1", "network": "eth-mainnet", "tokenAddress": "0x1111111111111111111111111111111111111111", "tokenBalance": "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"}
                ],
                "pageKey": "next-page"
            },
            "error": {"message": "Failed to fetch tokens on certain networks", "partialErrors": [{"network": "sonic-mainnet", "message": "timeout"}]}
        });
        let (tokens, failed, page) = parse_alchemy_tokens(&reply);
        assert_eq!(tokens.len(), 2);
        assert_eq!(tokens[0].chain, "ethereum");
        assert_eq!(tokens[0].address, None);
        assert_eq!(tokens[0].raw, 1_000_000_000_000_000_000);
        assert_eq!(tokens[0].price_usd, Some(3000.5));
        assert_eq!(
            tokens[0].logo.as_deref(),
            Some("https://static.example/eth.png")
        );
        assert_eq!(tokens[1].chain, "bsc");
        assert_eq!(
            tokens[1].address.as_deref(),
            Some("0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82")
        );
        assert_eq!(tokens[1].price_usd, None);
        assert_eq!(tokens[1].logo, None);
        assert_eq!(failed, vec!["sonic".to_string()]);
        assert_eq!(page.as_deref(), Some("next-page"));
    }

    #[test]
    fn reads_alchemy_nfts_and_drops_spam() {
        let reply = json!({"data": {"ownedNfts": [
            {"network": "eth-mainnet", "contract": {"address": "0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D", "tokenType": "ERC721", "openseaMetadata": {"collectionName": "Bored Ape Yacht Club"}},
             "tokenId": "1234", "name": "", "image": {"thumbnailUrl": "https://nft-cdn.example/1234.png"}},
            {"network": "base-mainnet", "contract": {"address": "0x2222222222222222222222222222222222222222", "tokenType": "ERC1155", "isSpam": true},
             "tokenId": "1", "name": "Claim your reward", "image": {"cachedUrl": "https://spam.example/a.png"}},
            {"network": "eth-mainnet", "contract": {"address": "0x3333333333333333333333333333333333333333", "tokenType": "ERC721"}, "tokenId": "5"},
            {"network": "opt-mainnet", "contract": {"address": "0x4444444444444444444444444444444444444444", "tokenType": "ERC721", "name": "Zora"},
             "tokenId": "7", "name": "Sunset", "raw": {"metadata": {"image": "ipfs://QmSun"}}}
        ]}});
        let (nfts, page) = parse_alchemy_nfts(&reply);
        assert_eq!(nfts.len(), 2);
        assert_eq!(nfts[0].name, "Bored Ape Yacht Club #1234");
        assert_eq!(
            nfts[0].contract,
            "0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d"
        );
        assert_eq!(nfts[1].image.as_deref(), Some("https://ipfs.io/ipfs/QmSun"));
        assert_eq!(nfts[1].chain, "optimism");
        assert!(page.is_none());
    }

    #[test]
    fn reads_magic_eden_nfts() {
        let reply = json!([
            {"mintAddress": "7tUh6q172wHmPJzM2HC111Wc7v5845kGcBXqi6UHBySd", "name": "Codino #0110 \"Kone\"", "collectionName": "codino", "image": "https://img.example/c.png"},
            {"mintAddress": "not a mint", "name": "x"},
            {"mintAddress": "8tUh6q172wHmPJzM2HC111Wc7v5845kGcBXqi6UHBySd", "name": ""}
        ]);
        let nfts = parse_magiceden_nfts(&reply);
        assert_eq!(nfts.len(), 1);
        assert_eq!(nfts[0].collection.as_deref(), Some("codino"));
        assert_eq!(nfts[0].standard, "Solana NFT");
    }
}
