//! Arctos live data service.
//!
//! Rust code that pulls real market, chain, news and equity data, keeps it hot
//! in memory, and serves it to the web app. It also hosts the AI proxy (so the
//! API key never reaches the browser) and the waitlist.
//!
//! It runs in two ways from the same code:
//!
//! * **Server mode** (`src/main.rs`): one long lived process. Background
//!   pollers keep the caches fresh and WebSockets push live updates.
//! * **On demand mode** (`api/main.rs` at the repository root, a Vercel
//!   function): no pollers and no sockets. Each request refreshes what it
//!   needs behind short lived caches, and responses carry CDN cache headers.

pub mod ai;
pub mod ai_tools;
pub mod binance;
pub mod config;
pub mod db;
pub mod error;
pub mod keeper;
pub mod launchpad;
pub mod market;
pub mod news;
pub mod portfolio;
pub mod ratelimit;
pub mod records;
pub mod serverless;
pub mod sniper;
pub mod stocks;
pub mod swap_proxy;
pub mod upstream;
pub mod waitlist;
pub mod whales;
pub mod ws;

use std::{
    collections::HashSet,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use axum::{
    extract::{DefaultBodyLimit, Request, State, WebSocketUpgrade},
    http::{header, HeaderMap, HeaderName, HeaderValue, Method, StatusCode},
    middleware::{self, Next},
    response::Response,
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::Serialize;
use tokio::sync::Semaphore;
use tower_http::{
    compression::CompressionLayer,
    cors::{AllowOrigin, CorsLayer},
    set_header::SetResponseHeaderLayer,
    timeout::TimeoutLayer,
    trace::TraceLayer,
};

pub use config::Config;
use upstream::{KeyedCache, SourceHealth, Upstream};

pub struct AppState {
    pub config: Config,
    pub up: Upstream,
    pub limiter: ratelimit::RateLimiter,
    /// PostgreSQL, when one is configured. See `db.rs`.
    pub db: Option<Arc<db::Database>>,
    pub market: market::MarketStore,
    pub binance: binance::BinanceStore,
    pub whales: whales::WhaleStore,
    pub sniper: sniper::SniperStore,
    pub launchpad: launchpad::LaunchpadStore,
    pub keeper: keeper::Keeper,
    pub news: news::NewsStore,
    pub stock_cache: KeyedCache<stocks::Quote>,
    pub portfolio_cache: KeyedCache<portfolio::PortfolioResponse>,
    pub waitlist_count: KeyedCache<i64>,
    pub waitlist_mem: Mutex<HashSet<String>>,
    pub ws_slots: Arc<Semaphore>,
    pub ai_slots: Arc<Semaphore>,
    pub started: Instant,
    pub started_at: DateTime<Utc>,
}

pub async fn build_state(config: Config) -> Arc<AppState> {
    // Every TLS client in the process uses rustls with the ring provider.
    // Installing twice is harmless, so the error case is ignored.
    let _ = rustls::crypto::ring::default_provider().install_default();
    let db = db::connect(config.database_url.as_deref(), config.on_demand).await;
    Arc::new(AppState {
        keeper: keeper::Keeper::new(db.clone(), config.on_demand),
        db,
        up: Upstream::new(),
        limiter: ratelimit::RateLimiter::new(),
        market: market::MarketStore::default(),
        binance: binance::BinanceStore::new(),
        whales: whales::WhaleStore::new(),
        sniper: sniper::SniperStore::with_price_cache(Duration::from_millis(config.price_cache_ms)),
        launchpad: launchpad::LaunchpadStore::new(),
        news: news::NewsStore::default(),
        stock_cache: KeyedCache::new(Duration::from_secs(45), Duration::from_secs(600)),
        portfolio_cache: KeyedCache::new(Duration::from_secs(20), Duration::from_secs(120)),
        waitlist_count: KeyedCache::new(Duration::from_secs(30), Duration::from_secs(600)),
        waitlist_mem: Mutex::new(HashSet::new()),
        ws_slots: Arc::new(Semaphore::new(1500)),
        ai_slots: Arc::new(Semaphore::new(6)),
        started: Instant::now(),
        started_at: Utc::now(),
        config,
    })
}

/// Starts the pollers that keep the in memory caches fresh.
pub fn spawn_background(state: Arc<AppState>) {
    if !state.config.enable_pollers {
        return;
    }
    market::spawn_pollers(state.clone());
    binance::spawn_pollers(state.clone());
    whales::spawn_pollers(state.clone());
    sniper::spawn_pollers(state.clone());
    news::spawn_pollers(state.clone());
    keeper::spawn_loop(state.clone());
    let limiter = state.clone();
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(300)).await;
            limiter.limiter.sweep();
        }
    });
}

/// The host the browser addressed, used to recognise same site requests.
pub fn request_host(headers: &HeaderMap, trust_proxy: bool) -> Option<&str> {
    let pick = |name: &str| {
        headers
            .get(name)
            .and_then(|v| v.to_str().ok())
            .map(str::trim)
            .filter(|v| !v.is_empty())
    };
    if trust_proxy {
        if let Some(host) = pick("x-forwarded-host") {
            return Some(host);
        }
    }
    pick("host")
}

/// Origin check shared by the endpoints that change state or cost money.
pub fn origin_ok(config: &Config, headers: &HeaderMap) -> bool {
    let origin = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok());
    config.origin_allowed(origin, request_host(headers, config.trust_proxy))
}

/// On demand mode: refreshes everything the AI prompt is built from. A no op when pollers run.
pub async fn ensure_live_context(state: &Arc<AppState>) {
    if !state.config.on_demand {
        return;
    }
    tokio::join!(
        binance::ensure_tickers(state),
        market::ensure_fresh(state),
        news::ensure_fresh(state),
    );
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StatusResponse {
    version: &'static str,
    /// "server" (pollers and live streams) or "on_demand" (serverless function).
    mode: &'static str,
    /// True when the WebSocket streams are available.
    realtime: bool,
    started_at: DateTime<Utc>,
    uptime_secs: u64,
    sources: Vec<SourceHealth>,
    database: DbStatus,
    ai: AiStatus,
    keeper: KeeperStatus,
    data: DataCounts,
}

#[derive(Serialize)]
struct DbStatus {
    configured: bool,
    /// True once the service has reached the database and its schema is ready.
    connected: bool,
}

#[derive(Serialize)]
struct AiStatus {
    configured: bool,
}

#[derive(Serialize)]
struct KeeperStatus {
    /// True when open snipes are managed with nobody online.
    offline: bool,
    /// True when they also survive a restart of the service.
    durable: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DataCounts {
    tickers: usize,
    tickers_source: &'static str,
    coins: usize,
    news_articles: usize,
    whale_events: usize,
}

async fn status(State(state): State<Arc<AppState>>) -> Json<StatusResponse> {
    Json(StatusResponse {
        version: env!("CARGO_PKG_VERSION"),
        mode: if state.config.on_demand {
            "on_demand"
        } else {
            "server"
        },
        realtime: !state.config.on_demand,
        started_at: state.started_at,
        uptime_secs: state.started.elapsed().as_secs(),
        sources: state.up.snapshot(),
        database: DbStatus {
            configured: state.config.database_url.is_some(),
            connected: db_connected(&state).await,
        },
        ai: AiStatus {
            configured: state.config.anthropic_api_key.is_some(),
        },
        keeper: KeeperStatus {
            offline: state.keeper.offline(),
            durable: state.keeper.durable(),
        },
        data: DataCounts {
            tickers: state
                .binance
                .tickers
                .read()
                .unwrap_or_else(|e| e.into_inner())
                .len(),
            tickers_source: *state
                .binance
                .tickers_source
                .read()
                .unwrap_or_else(|e| e.into_inner()),
            coins: state
                .market
                .coins
                .read()
                .unwrap_or_else(|e| e.into_inner())
                .len(),
            news_articles: state.news.top(1000).len(),
            whale_events: state.whales.recent(1000, 0.0).len(),
        },
    })
}

/// Reaches the database if that has not happened yet, so the status page
/// reports the truth. It answers within a few seconds either way.
async fn db_connected(state: &AppState) -> bool {
    let Some(db) = &state.db else {
        return false;
    };
    if db.is_ready() {
        return true;
    }
    matches!(
        tokio::time::timeout(Duration::from_secs(6), db.pool()).await,
        Ok(Ok(_))
    )
}

async fn health() -> &'static str {
    "ok"
}

async fn ws_market(
    upgrade: WebSocketUpgrade,
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
) -> Response {
    ws::upgrade(upgrade, headers, state, ws::Channel::Market).await
}

async fn ws_whales(
    upgrade: WebSocketUpgrade,
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
) -> Response {
    ws::upgrade(upgrade, headers, state, ws::Channel::Whales).await
}

async fn ws_sniper(
    upgrade: WebSocketUpgrade,
    headers: HeaderMap,
    State(state): State<Arc<AppState>>,
) -> Response {
    ws::upgrade(upgrade, headers, state, ws::Channel::Sniper).await
}

/// How long a CDN may keep a successful GET response, as `(fresh, stale)` seconds.
/// Fast moving data gets a short life and no stale window. Slow data may be served
/// stale while the CDN refreshes it in the background.
pub fn cdn_cache_policy(path: &str) -> Option<(u32, u32)> {
    Some(match path {
        "/api/market/tickers" => (2, 0),
        "/api/market/depth" | "/api/market/trades" => (1, 0),
        "/api/market/klines" => (3, 0),
        "/api/market/overview" | "/api/market/coins" => (30, 120),
        "/api/whales" => (10, 60),
        "/api/sniper/new" | "/api/sniper/feed" => (10, 60),
        "/api/sniper/chains" => (3600, 86400),
        "/api/relay/chains" => (300, 3600),
        "/api/swap/providers" => (60, 300),
        "/api/sniper/search" => (15, 60),
        "/api/sniper/tokens" => (5, 30),
        "/api/sniper/security" => (300, 3600),
        "/api/news" => (60, 600),
        "/api/stocks" => (30, 120),
        "/api/waitlist/count" => (30, 120),
        p if p.starts_with("/api/portfolio/") => (15, 60),
        _ => return None,
    })
}

/// Sets `Cache-Control` on every response. In on demand mode successful GETs
/// of public data may be cached by the CDN in front of the function, which
/// keeps the site fast and the function mostly idle. Everything else, and
/// every response in server mode, is `no-store`.
async fn cache_headers(State(state): State<Arc<AppState>>, req: Request, next: Next) -> Response {
    let policy = (state.config.on_demand && req.method() == Method::GET)
        .then(|| cdn_cache_policy(req.uri().path()))
        .flatten();
    let mut response = next.run(req).await;
    let value = match policy {
        Some((fresh, stale)) if response.status() == StatusCode::OK => {
            let mut v = format!("public, max-age=0, s-maxage={fresh}");
            if stale > 0 {
                v.push_str(&format!(", stale-while-revalidate={stale}"));
            }
            HeaderValue::from_str(&v).unwrap_or(HeaderValue::from_static("no-store"))
        }
        _ => HeaderValue::from_static("no-store"),
    };
    response.headers_mut().insert(header::CACHE_CONTROL, value);
    response
}

fn cors_layer(config: &Config) -> CorsLayer {
    let base = CorsLayer::new()
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers([header::CONTENT_TYPE, header::AUTHORIZATION])
        .max_age(Duration::from_secs(600));
    if config.open_to_any_origin() {
        tracing::warn!("FRONTEND_ORIGINS is not set: accepting any origin. Set it in production.");
        return base.allow_origin(AllowOrigin::any());
    }
    let origins: Vec<HeaderValue> = config
        .frontend_origins
        .iter()
        .filter_map(|o| o.parse().ok())
        .collect();
    base.allow_origin(origins)
}

pub fn build_router(state: Arc<AppState>) -> Router {
    let api = Router::new()
        .route("/health", get(health))
        .route("/api/health", get(health))
        .route("/api/status", get(status))
        // Market
        .route("/api/market/overview", get(market::get_overview))
        .route("/api/market/coins", get(market::get_coins))
        .route("/api/market/tickers", get(binance::get_tickers))
        .route("/api/market/klines", get(binance::get_klines))
        .route("/api/market/depth", get(binance::get_depth))
        .route("/api/market/trades", get(binance::get_trades))
        // On chain
        .route("/api/whales", get(whales::get_whales))
        .route("/api/portfolio/:address", get(portfolio::get_portfolio))
        // Sniper discovery
        .route("/api/sniper/chains", get(launchpad::get_chains))
        .route("/api/sniper/feed", get(launchpad::get_feed))
        .route("/api/sniper/new", get(sniper::get_new))
        .route("/api/sniper/search", get(sniper::search))
        .route("/api/sniper/tokens", get(sniper::refresh_tokens))
        .route("/api/sniper/security", get(sniper::security))
        // Trade keeper: exit plans for open snipes
        .route(
            "/api/sniper/keeper/sync",
            post(keeper::sync).layer(DefaultBodyLimit::max(64 * 1024)),
        )
        .route(
            "/api/sniper/keeper/tick",
            get(keeper::tick).post(keeper::tick),
        )
        // Swaps and bridges (Relay), signed in the user's own wallet
        .route("/api/swap/providers", get(swap_proxy::providers))
        .route(
            "/api/relay/*path",
            get(swap_proxy::relay_get)
                .post(swap_proxy::relay_post)
                .layer(DefaultBodyLimit::max(swap_proxy::MAX_BODY)),
        )
        .route(
            "/api/zerox/*path",
            get(swap_proxy::zerox_get)
                .post(swap_proxy::zerox_post)
                .layer(DefaultBodyLimit::max(swap_proxy::MAX_BODY)),
        )
        .route(
            "/api/squid/*path",
            get(swap_proxy::squid_get)
                .post(swap_proxy::squid_post)
                .layer(DefaultBodyLimit::max(swap_proxy::MAX_BODY)),
        )
        // Content
        .route("/api/news", get(news::get_news))
        .route("/api/stocks", get(stocks::get_quotes))
        // AI and waitlist
        .route("/api/ai/status", get(ai::status))
        .route(
            "/api/ai/chat",
            post(ai::chat).layer(DefaultBodyLimit::max(48 * 1024)),
        )
        .route("/api/waitlist", post(waitlist::join))
        .route("/api/waitlist/count", get(waitlist::count))
        // Live streams
        .route("/ws/market", get(ws_market))
        .route("/ws/whales", get(ws_whales))
        .route("/ws/sniper", get(ws_sniper));

    let static_header = |name: &'static str, value: &'static str| {
        SetResponseHeaderLayer::if_not_present(
            HeaderName::from_static(name),
            HeaderValue::from_static(value),
        )
    };

    api.layer(DefaultBodyLimit::max(8 * 1024))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            ratelimit::middleware,
        ))
        .layer(cors_layer(&state.config))
        .layer(static_header("x-content-type-options", "nosniff"))
        .layer(static_header("referrer-policy", "no-referrer"))
        .layer(middleware::from_fn_with_state(state.clone(), cache_headers))
        .layer(static_header(
            "content-security-policy",
            "default-src 'none'; frame-ancestors 'none'",
        ))
        .layer(CompressionLayer::new())
        .layer(TimeoutLayer::new(Duration::from_secs(100)))
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_public_market_data_is_cacheable() {
        assert_eq!(cdn_cache_policy("/api/market/tickers"), Some((2, 0)));
        assert_eq!(cdn_cache_policy("/api/news"), Some((60, 600)));
        assert_eq!(cdn_cache_policy("/api/portfolio/0xabc"), Some((15, 60)));
        for private in [
            "/api/status",
            "/api/ai/status",
            "/api/ai/chat",
            "/api/waitlist",
            "/api/sniper/keeper/sync",
            "/api/sniper/keeper/tick",
            "/health",
            "/ws/market",
        ] {
            assert_eq!(cdn_cache_policy(private), None, "{private}");
        }
    }

    #[test]
    fn forwarded_host_is_only_used_behind_a_trusted_proxy() {
        let mut h = HeaderMap::new();
        h.insert("host", "internal:3000".parse().unwrap());
        h.insert("x-forwarded-host", "arctos.example".parse().unwrap());
        assert_eq!(request_host(&h, false), Some("internal:3000"));
        assert_eq!(request_host(&h, true), Some("arctos.example"));
        h.remove("x-forwarded-host");
        assert_eq!(request_host(&h, true), Some("internal:3000"));
    }
}
