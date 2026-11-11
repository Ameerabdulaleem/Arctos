//! Arctos live data service.
//!
//! One Rust process that pulls real market, chain, news and equity data,
//! keeps it hot in memory, and serves it to the web app over REST and
//! WebSockets. It also hosts the AI proxy (so the API key never reaches the
//! browser) and the waitlist.

pub mod ai;
pub mod binance;
pub mod config;
pub mod error;
pub mod market;
pub mod news;
pub mod portfolio;
pub mod ratelimit;
pub mod sniper;
pub mod stocks;
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
    extract::{DefaultBodyLimit, State, WebSocketUpgrade},
    http::{header, HeaderMap, HeaderName, HeaderValue, Method},
    middleware,
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
    pub db: Option<sqlx::PgPool>,
    pub market: market::MarketStore,
    pub binance: binance::BinanceStore,
    pub whales: whales::WhaleStore,
    pub sniper: sniper::SniperStore,
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
    let db = waitlist::connect(config.database_url.as_deref()).await;
    Arc::new(AppState {
        db,
        up: Upstream::new(),
        limiter: ratelimit::RateLimiter::new(),
        market: market::MarketStore::default(),
        binance: binance::BinanceStore::new(),
        whales: whales::WhaleStore::new(),
        sniper: sniper::SniperStore::new(),
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
    let limiter = state.clone();
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(300)).await;
            limiter.limiter.sweep();
        }
    });
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StatusResponse {
    version: &'static str,
    started_at: DateTime<Utc>,
    uptime_secs: u64,
    sources: Vec<SourceHealth>,
    database: DbStatus,
    ai: AiStatus,
    data: DataCounts,
}

#[derive(Serialize)]
struct DbStatus {
    configured: bool,
    connected: bool,
}

#[derive(Serialize)]
struct AiStatus {
    configured: bool,
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
        started_at: state.started_at,
        uptime_secs: state.started.elapsed().as_secs(),
        sources: state.up.snapshot(),
        database: DbStatus {
            configured: state.config.database_url.is_some(),
            connected: state.db.is_some(),
        },
        ai: AiStatus {
            configured: state.config.anthropic_api_key.is_some(),
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

fn cors_layer(config: &Config) -> CorsLayer {
    let base = CorsLayer::new()
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers([header::CONTENT_TYPE])
        .max_age(Duration::from_secs(600));
    if config.frontend_origins.is_empty() {
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
        .route("/api/sniper/new", get(sniper::get_new))
        .route("/api/sniper/search", get(sniper::search))
        .route("/api/sniper/tokens", get(sniper::refresh_tokens))
        .route("/api/sniper/security", get(sniper::security))
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
        .layer(static_header("cache-control", "no-store"))
        .layer(static_header(
            "content-security-policy",
            "default-src 'none'; frame-ancestors 'none'",
        ))
        .layer(CompressionLayer::new())
        .layer(TimeoutLayer::new(Duration::from_secs(100)))
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}
