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
    /// On demand mode: no background pollers and no live streams. Every request
    /// refreshes what it needs (with short lived caches) before answering. This is
    /// how the service runs as a serverless function, for example on Vercel.
    pub on_demand: bool,
}

fn var(key: &str) -> Option<String> {
    env::var(key)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

fn var_or(key: &str, default: &str) -> String {
    var(key).unwrap_or_else(|| default.to_string())
}

fn list(key: &str, default: &[&str]) -> Vec<String> {
    match var(key) {
        Some(v) => v
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect(),
        None => default.iter().map(|s| s.to_string()).collect(),
    }
}

fn truthy(key: &str) -> bool {
    matches!(
        var(key).as_deref().map(str::to_ascii_lowercase).as_deref(),
        Some("1" | "true" | "yes")
    )
}

const DEFAULT_FEEDS: &[(&str, &str)] = &[
    (
        "CoinDesk",
        "https://www.coindesk.com/arc/outboundfeeds/rss/",
    ),
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
            None => DEFAULT_FEEDS
                .iter()
                .map(|(n, u)| (n.to_string(), u.to_string()))
                .collect(),
        };

        // Vercel sets VERCEL=1 for builds and functions.
        let on_demand = truthy("ARCTOS_ON_DEMAND") || truthy("VERCEL");

        Self {
            host: var_or("HOST", "0.0.0.0"),
            port: var("PORT").and_then(|v| v.parse().ok()).unwrap_or(4000),
            database_url: var("DATABASE_URL"),
            frontend_origins: list("FRONTEND_ORIGINS", &[]),
            // Vercel overwrites the forwarding headers itself, so they can be trusted there.
            trust_proxy: truthy("TRUST_PROXY") || truthy("VERCEL"),

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
            binance_ws_url: var_or(
                "BINANCE_WS_URL",
                "wss://stream.binance.com:9443/ws/!miniTicker@arr",
            ),
            fng_url: var_or("FNG_URL", "https://api.alternative.me/fng/"),
            dexscreener_base: var_or("DEXSCREENER_BASE", "https://api.dexscreener.com"),
            geckoterminal_base: var_or(
                "GECKOTERMINAL_BASE",
                "https://api.geckoterminal.com/api/v2",
            ),
            goplus_base: var_or("GOPLUS_BASE", "https://api.gopluslabs.io/api/v1"),
            blockchair_base: var_or("BLOCKCHAIR_BASE", "https://api.blockchair.com"),
            blockchair_api_key: var("BLOCKCHAIR_API_KEY"),
            yahoo_base: var_or("YAHOO_BASE", "https://query1.finance.yahoo.com"),
            eth_rpc: var_or("ETH_RPC_URL", "https://ethereum-rpc.publicnode.com"),
            bsc_rpc: var_or("BSC_RPC_URL", "https://bsc-rpc.publicnode.com"),
            base_rpc: var_or("BASE_RPC_URL", "https://base-rpc.publicnode.com"),
            arbitrum_rpc: var_or(
                "ARBITRUM_RPC_URL",
                "https://arbitrum-one-rpc.publicnode.com",
            ),
            solana_rpc: var_or("SOLANA_RPC_URL", "https://api.mainnet-beta.solana.com"),

            tracked_symbols: list(
                "TRACKED_SYMBOLS",
                &[
                    "BTC", "ETH", "BNB", "SOL", "XRP", "DOGE", "ADA", "AVAX", "LINK", "ARB", "TON",
                    "TRX", "DOT", "LTC", "NEAR", "SUI",
                ],
            )
            .into_iter()
            .map(|s| s.to_ascii_uppercase())
            .collect(),
            whale_min_usd: var("WHALE_MIN_USD")
                .and_then(|v| v.parse().ok())
                .unwrap_or(100_000.0),
            news_feeds,
            stock_watchlist: list(
                "STOCK_WATCHLIST",
                &[
                    "COIN", "MSTR", "HOOD", "CRCL", "MARA", "RIOT", "GLXY", "NVDA", "TSLA", "AAPL",
                    "MSFT", "META",
                ],
            )
            .into_iter()
            .map(|s| s.to_ascii_uppercase())
            .collect(),
            enable_pollers: !on_demand && !truthy("DISABLE_POLLERS"),
            on_demand,
        }
    }

    /// Switches to on demand mode (used by the serverless entry point).
    pub fn into_on_demand(mut self) -> Self {
        self.on_demand = true;
        self.enable_pollers = false;
        self.trust_proxy = true;
        self
    }

    /// True when browsers on any origin may call the API (local development only).
    pub fn open_to_any_origin(&self) -> bool {
        self.frontend_origins.is_empty() && !self.on_demand
    }

    /// Origin check used by the AI, waitlist and live stream endpoints.
    ///
    /// An origin is accepted when it is on the configured allow list, or when it
    /// is the very site the request was sent to (the web app and the API share
    /// one host). With no allow list outside on demand mode (local development)
    /// every origin is accepted.
    pub fn origin_allowed(&self, origin: Option<&str>, host: Option<&str>) -> bool {
        if self.open_to_any_origin() {
            return true;
        }
        match origin {
            Some(o) => {
                self.frontend_origins.iter().any(|allowed| allowed == o) || same_host(o, host)
            }
            None => false,
        }
    }
}

/// True when `origin` (scheme://host[:port]) points at `host` (a Host header value).
fn same_host(origin: &str, host: Option<&str>) -> bool {
    let Some(host) = host.map(str::trim).filter(|h| !h.is_empty()) else {
        return false;
    };
    let authority = origin
        .strip_prefix("https://")
        .or_else(|| origin.strip_prefix("http://"));
    match authority {
        Some(a) => !a.is_empty() && !a.contains('/') && a.eq_ignore_ascii_case(host),
        None => false,
    }
}

#[cfg(test)]
impl Config {
    pub fn for_tests() -> Self {
        let mut c = Self::from_env();
        c.enable_pollers = false;
        c.on_demand = false;
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
        assert!(c.origin_allowed(None, None), "dev mode accepts anything");
        c.frontend_origins = vec!["https://app.example".into()];
        assert!(c.origin_allowed(Some("https://app.example"), None));
        assert!(!c.origin_allowed(Some("https://evil.example"), None));
        assert!(
            !c.origin_allowed(None, None),
            "a configured allow list rejects missing Origin"
        );
    }

    #[test]
    fn same_site_requests_are_allowed_without_an_allow_list() {
        let c = Config::for_tests().into_on_demand();
        assert!(!c.open_to_any_origin());
        assert!(c.origin_allowed(Some("https://arctos.example"), Some("arctos.example")));
        assert!(c.origin_allowed(Some("https://Arctos.Example"), Some("arctos.example")));
        assert!(c.origin_allowed(Some("http://localhost:3000"), Some("localhost:3000")));
        assert!(!c.origin_allowed(Some("https://evil.example"), Some("arctos.example")));
        assert!(!c.origin_allowed(
            Some("https://arctos.example.evil.io"),
            Some("arctos.example")
        ));
        assert!(!c.origin_allowed(Some("https://arctos.example/x"), Some("arctos.example")));
        assert!(!c.origin_allowed(Some("null"), Some("arctos.example")));
        assert!(
            !c.origin_allowed(None, Some("arctos.example")),
            "a missing Origin is rejected"
        );
        assert!(!c.origin_allowed(Some("https://arctos.example"), None));
    }
}
