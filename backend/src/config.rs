//! Runtime configuration, read once from the environment.
//!
//! Every upstream base URL is overridable so the whole service can be pointed
//! at a local fixture server in tests, and so operators can swap providers
//! without a code change.

use std::env;

#[derive(Debug, Clone)]
pub struct Config {
    pub host: String,
    pub port: u16,
    /// Optional. Only the waitlist needs a database.
    pub database_url: Option<String>,
    /// Comma separated list of allowed browser origins. Empty means "development mode".
    pub frontend_origins: Vec<String>,
    /// Trust `X-Forwarded-For` / `Fly-Client-IP` (set when running behind a proxy you control).
    pub trust_proxy: bool,

    // Mail (Brevo SMTP relay by default)
    pub mail_host: String,
    pub mail_port: u16,
    pub mail_username: String,
    pub mail_password: String,
    pub mail_from: String,
    pub mail_from_name: String,
    pub public_site_url: String,

    // AI
    pub anthropic_api_key: Option<String>,
    pub anthropic_model: String,
    pub anthropic_base: String,
    pub anthropic_effort: String,

    // Upstream endpoints
    pub coingecko_base: String,
    pub coingecko_api_key: Option<String>,
    pub binance_rest_bases: Vec<String>,
    pub binance_ws_url: String,
    pub fng_url: String,
    pub dexscreener_base: String,
    pub geckoterminal_base: String,
    pub goplus_base: String,
    pub blockchair_base: String,
    pub blockchair_api_key: Option<String>,
    pub yahoo_base: String,
    pub eth_rpc: String,
    pub bsc_rpc: String,
    pub base_rpc: String,
    pub arbitrum_rpc: String,
    pub solana_rpc: String,

    // Tuning
    pub tracked_symbols: Vec<String>,
    pub whale_min_usd: f64,
    pub news_feeds: Vec<(String, String)>,
    pub stock_watchlist: Vec<String>,
    /// Set to false in tests to avoid starting pollers.
    pub enable_pollers: bool,
}

fn var(key: &str) -> Option<String> {
    env::var(key).ok().map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

fn var_or(key: &str, default: &str) -> String {
    var(key).unwrap_or_else(|| default.to_string())
}

fn list(key: &str, default: &[&str]) -> Vec<String> {
    match var(key) {
        Some(v) => v.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect(),
        None => default.iter().map(|s| s.to_string()).collect(),
    }
}

fn truthy(key: &str) -> bool {
    matches!(var(key).as_deref().map(str::to_ascii_lowercase).as_deref(), Some("1" | "true" | "yes"))
}

const DEFAULT_FEEDS: &[(&str, &str)] = &[
    ("CoinDesk", "https://www.coindesk.com/arc/outboundfeeds/rss/"),
    ("Cointelegraph", "https://cointelegraph.com/rss"),
    ("Decrypt", "https://decrypt.co/feed"),
    ("The Block", "https://www.theblock.co/rss.xml"),
    ("CryptoSlate", "https://cryptoslate.com/feed/"),
    ("Bitcoin Magazine", "https://bitcoinmagazine.com/.rss/full/"),
    ("BeInCrypto", "https://beincrypto.com/feed/"),
    ("U.Today", "https://u.today/rss"),
];

impl Config {
    pub fn from_env() -> Self {
        let news_feeds = match var("NEWS_FEEDS") {
            // Format: "Name|https://url,Other|https://url"
            Some(raw) => raw
                .split(',')
                .filter_map(|item| {
                    let (name, url) = item.split_once('|')?;
                    Some((name.trim().to_string(), url.trim().to_string()))
                })
                .collect(),
            None => DEFAULT_FEEDS.iter().map(|(n, u)| (n.to_string(), u.to_string())).collect(),
        };

        Self {
            host: var_or("HOST", "0.0.0.0"),
            port: var("PORT").and_then(|v| v.parse().ok()).unwrap_or(4000),
            database_url: var("DATABASE_URL"),
            frontend_origins: list("FRONTEND_ORIGINS", &[]),
            trust_proxy: truthy("TRUST_PROXY"),

            mail_host: var_or("MAIL_HOST", "smtp-relay.brevo.com"),
            mail_port: var("MAIL_PORT").and_then(|v| v.parse().ok()).unwrap_or(587),
            mail_username: var_or("MAIL_USERNAME", ""),
            mail_password: var_or("MAIL_PASSWORD", ""),
            mail_from: var_or("MAIL_FROM", "noreply@arctos.io"),
            mail_from_name: var_or("MAIL_FROM_NAME", "Arctos"),
            public_site_url: var_or("PUBLIC_SITE_URL", "https://arctos-fi.vercel.app"),

            anthropic_api_key: var("ANTHROPIC_API_KEY"),
            anthropic_model: var_or("ANTHROPIC_MODEL", "claude-opus-5-5"),
            anthropic_base: var_or("ANTHROPIC_BASE", "https://api.anthropic.com"),
            anthropic_effort: var_or("ANTHROPIC_EFFORT", "medium"),

            coingecko_base: var_or("COINGECKO_BASE", "https://api.coingecko.com/api/v3"),
            coingecko_api_key: var("COINGECKO_API_KEY"),
            binance_rest_bases: list(
                "BINANCE_REST_BASES",
                &["https://data-api.binance.vision", "https://api.binance.com"],
            ),
            binance_ws_url: var_or("BINANCE_WS_URL", "wss://stream.binance.com:9443/ws/!miniTicker@arr"),
            fng_url: var_or("FNG_URL", "https://api.alternative.me/fng/"),
            dexscreener_base: var_or("DEXSCREENER_BASE", "https://api.dexscreener.com"),
            geckoterminal_base: var_or("GECKOTERMINAL_BASE", "https://api.geckoterminal.com/api/v2"),
            goplus_base: var_or("GOPLUS_BASE", "https://api.gopluslabs.io/api/v1"),
            blockchair_base: var_or("BLOCKCHAIR_BASE", "https://api.blockchair.com"),
            blockchair_api_key: var("BLOCKCHAIR_API_KEY"),
            yahoo_base: var_or("YAHOO_BASE", "https://query1.finance.yahoo.com"),
            eth_rpc: var_or("ETH_RPC_URL", "https://ethereum-rpc.publicnode.com"),
            bsc_rpc: var_or("BSC_RPC_URL", "https://bsc-rpc.publicnode.com"),
            base_rpc: var_or("BASE_RPC_URL", "https://base-rpc.publicnode.com"),
            arbitrum_rpc: var_or("ARBITRUM_RPC_URL", "https://arbitrum-one-rpc.publicnode.com"),
            solana_rpc: var_or("SOLANA_RPC_URL", "https://api.mainnet-beta.solana.com"),

            tracked_symbols: list(
                "TRACKED_SYMBOLS",
                &[
                    "BTC", "ETH", "BNB", "SOL", "XRP", "DOGE", "ADA", "AVAX", "LINK", "ARB", "TON", "TRX", "DOT",
                    "LTC", "NEAR", "SUI",
                ],
            )
            .into_iter()
            .map(|s| s.to_ascii_uppercase())
            .collect(),
            whale_min_usd: var("WHALE_MIN_USD").and_then(|v| v.parse().ok()).unwrap_or(100_000.0),
            news_feeds,
            stock_watchlist: list(
                "STOCK_WATCHLIST",
                &["COIN", "MSTR", "HOOD", "CRCL", "MARA", "RIOT", "GLXY", "NVDA", "TSLA", "AAPL", "MSFT", "META"],
            )
            .into_iter()
            .map(|s| s.to_ascii_uppercase())
            .collect(),
            enable_pollers: !truthy("DISABLE_POLLERS"),
        }
    }

    /// Origin check used by the AI and waitlist endpoints.
    /// With no configured origins (local development) every origin is accepted.
    pub fn origin_allowed(&self, origin: Option<&str>) -> bool {
        if self.frontend_origins.is_empty() {
            return true;
        }
        match origin {
            Some(o) => self.frontend_origins.iter().any(|allowed| allowed == o),
            None => false,
        }
    }
}

#[cfg(test)]
impl Config {
    pub fn for_tests() -> Self {
        let mut c = Self::from_env();
        c.enable_pollers = false;
        c.frontend_origins = Vec::new();
        c.database_url = None;
        c
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn origin_rules() {
        let mut c = Config::for_tests();
        assert!(c.origin_allowed(None), "dev mode accepts anything");
        c.frontend_origins = vec!["https://app.example".into()];
        assert!(c.origin_allowed(Some("https://app.example")));
        assert!(!c.origin_allowed(Some("https://evil.example")));
        assert!(!c.origin_allowed(None), "a configured allow list rejects missing Origin");
    }
}
