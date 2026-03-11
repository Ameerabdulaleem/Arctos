mod config;
mod db;
mod error;
mod handlers;
mod types;

use std::{collections::HashMap, env, net::SocketAddr, sync::Arc, time::Duration};

use axum::{
    routing::{get, post},
    Router,
};
use tokio::sync::{broadcast, RwLock};
use tower_http::cors::{Any, CorsLayer};
use tracing::info;

pub use config::Config;
pub use types::*;

// ── Application State ────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct AppState {
    pub latest_snapshot: Arc<RwLock<DashboardSnapshot>>,
    pub dashboard_tx: broadcast::Sender<DashboardSnapshot>,
    pub sniper_tx: broadcast::Sender<SniperUpdateEvent>,
    pub db: sqlx::SqlitePool,
    pub config: Arc<Config>,
}

// ── Entry Point ───────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    // Load .env if present (silently skip if missing)
    let _ = dotenv::dotenv();

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "arctos_backend=info,tower_http=info".into()),
        )
        .init();

    let cfg = Arc::new(Config::from_env());

    let db = db::init_pool(&cfg.database_url)
        .await
        .expect("Failed to initialise SQLite database");

    let initial_snapshot = build_snapshot(0);
    let (dashboard_tx, _) = broadcast::channel::<DashboardSnapshot>(64);
    let (sniper_tx, _) = broadcast::channel::<SniperUpdateEvent>(64);

    let state = Arc::new(AppState {
        latest_snapshot: Arc::new(RwLock::new(initial_snapshot)),
        dashboard_tx,
        sniper_tx,
        db,
        config: cfg.clone(),
    });

    // Spawn the dashboard live-data updater
    let updater_state = state.clone();
    tokio::spawn(async move {
        handlers::ws_dashboard::run_snapshot_updater(updater_state).await;
    });

    let app = build_router(state);

    let base_addr: SocketAddr = format!("{}:{}", cfg.host, cfg.port)
        .parse()
        .unwrap_or(SocketAddr::from(([0, 0, 0, 0], 4000)));

    let listener = bind_first_available(base_addr, 20).await;
    let local_addr = listener
        .local_addr()
        .unwrap_or(SocketAddr::from(([0, 0, 0, 0], cfg.port)));

    info!("Arctos backend listening on http://{}", local_addr);
    axum::serve(listener, app).await.unwrap();
}

// ── Router ───────────────────────────────────────────────────────────────────

fn build_router(state: Arc<AppState>) -> Router {
    Router::new()
        // Health
        .route("/health", get(health))
        // Root
        .route("/", get(root))
        // Dashboard REST + WebSocket
        .route(
            "/api/dashboard/overview",
            get(handlers::dashboard::get_dashboard_overview),
        )
        .route("/ws/dashboard", get(handlers::ws_dashboard::ws_dashboard))
        // Sniper REST
        .route("/api/sniper/tokens", get(handlers::sniper::get_tokens))
        .route(
            "/api/sniper/token-search",
            get(handlers::sniper::search_token),
        )
        .route("/api/sniper/config", post(handlers::sniper::save_config))
        .route("/api/sniper/state", post(handlers::sniper::set_state))
        .route("/api/sniper/snipe", post(handlers::sniper::execute_snipe))
        // Sniper WebSocket
        .route("/ws/sniper", get(handlers::ws_sniper::ws_sniper))
        // News
        .route("/api/news", get(handlers::news::get_news))
        // Tradebook
        .route(
            "/api/tradebook/trades",
            get(handlers::tradebook::get_trades).post(handlers::tradebook::save_trades),
        )
        // Email
        .route("/api/brevo", post(handlers::email::send_email))
        // Middleware
        .layer(build_cors_layer())
        .with_state(state)
}

// ── Simple handlers ───────────────────────────────────────────────────────────

async fn root() -> &'static str {
    "Arctos backend live sync server"
}

async fn health() -> &'static str {
    "OK"
}

// ── Snapshot builder (live-simulated data) ────────────────────────────────────

pub fn build_snapshot(tick: u64) -> DashboardSnapshot {
    let phase = (tick % 40) as f64;
    let portfolio_base = 128_456.32;
    let portfolio_drift = (phase - 20.0) * 215.0;
    let portfolio_value = (portfolio_base + portfolio_drift).max(50_000.0);

    let portfolio_change_percent = ((phase - 20.0) / 20.0) * 4.8;
    let portfolio_change_value = portfolio_value * (portfolio_change_percent / 100.0);

    let altseason_index = (67_i64 + (tick as i64 % 8) - 4).clamp(0, 100) as u32;
    let fear_greed_index = (72_i64 + (tick as i64 % 10) - 5).clamp(0, 100) as u32;

    let btc_dominance = 51.2 + ((tick % 6) as f64 - 3.0) * 0.12;
    let eth_dominance = 18.7 + ((tick % 5) as f64 - 2.0) * 0.1;
    let usdt = 5.8;
    let bnb = 3.9;
    let sol = 3.3;
    let others = (100.0 - (btc_dominance + eth_dominance + usdt + bnb + sol)).max(0.0);

    let total_market_cap = 2.41e12 + ((tick % 12) as f64 - 6.0) * 8.5e9;
    let market_cap_change_percent = ((tick % 10) as f64 - 5.0) * 0.36;

    let dominance_map = HashMap::from([
        ("BTC".to_string(), round2(btc_dominance)),
        ("ETH".to_string(), round2(eth_dominance)),
        ("USDT".to_string(), usdt),
        ("BNB".to_string(), bnb),
        ("SOL".to_string(), sol),
        ("OTHERS".to_string(), round2(others)),
    ]);

    DashboardSnapshot {
        metrics: DashboardMetrics {
            portfolio_value: round2(portfolio_value),
            portfolio_change_percent: round2(portfolio_change_percent),
            portfolio_change_value: round2(portfolio_change_value),
            altseason_index,
            altseason_trend: vec![42, 45, 48, 52, 57, 60, 63, altseason_index],
            btc_dominance: round2(btc_dominance),
            eth_dominance: round2(eth_dominance),
            dominance_map,
            total_market_cap,
            market_cap_change_percent: round2(market_cap_change_percent),
            market_cap_trend: vec![
                2.22,
                2.24,
                2.27,
                2.31,
                2.28,
                2.35,
                2.39,
                round2(total_market_cap / 1e12),
            ],
            fear_greed_index,
        },
        recent_activities: vec![
            RecentActivity {
                action: "Bought ETH".to_string(),
                amount: "+2.456 ETH".to_string(),
                value: "$4,856.78".to_string(),
                time: "just now".to_string(),
                chain: "ETH".to_string(),
                chain_color: "bg-blue-500".to_string(),
                r#type: "buy".to_string(),
            },
            RecentActivity {
                action: "Staked SOL".to_string(),
                amount: "125 SOL".to_string(),
                value: "$9,234.56".to_string(),
                time: "2 mins ago".to_string(),
                chain: "SOL".to_string(),
                chain_color: "bg-purple-500".to_string(),
                r#type: "stake".to_string(),
            },
            RecentActivity {
                action: "Sold BNB".to_string(),
                amount: "-12.5 BNB".to_string(),
                value: "$3,456.78".to_string(),
                time: "5 mins ago".to_string(),
                chain: "BNB".to_string(),
                chain_color: "bg-yellow-500".to_string(),
                r#type: "sell".to_string(),
            },
            RecentActivity {
                action: "Swapped USDT".to_string(),
                amount: "500 USDT → TON".to_string(),
                value: "$500.00".to_string(),
                time: "12 mins ago".to_string(),
                chain: "TON".to_string(),
                chain_color: "bg-blue-600".to_string(),
                r#type: "swap".to_string(),
            },
            RecentActivity {
                action: "Received NFT".to_string(),
                amount: "Mad Lad #8234".to_string(),
                value: "$9,234.50".to_string(),
                time: "26 mins ago".to_string(),
                chain: "SOL".to_string(),
                chain_color: "bg-purple-500".to_string(),
                r#type: "receive".to_string(),
            },
            RecentActivity {
                action: "Claimed Rewards".to_string(),
                amount: "+45.67 CAKE".to_string(),
                value: "$234.56".to_string(),
                time: "44 mins ago".to_string(),
                chain: "BNB".to_string(),
                chain_color: "bg-yellow-500".to_string(),
                r#type: "claim".to_string(),
            },
        ],
        assets: DashboardAssets {
            tokens: vec![
                AssetItem {
                    name: "Ethereum".to_string(),
                    symbol: "ETH".to_string(),
                    chain: "ETH".to_string(),
                    amount: "12.84".to_string(),
                    value: "$25,217.31".to_string(),
                    change24h: 2.4,
                },
                AssetItem {
                    name: "Solana".to_string(),
                    symbol: "SOL".to_string(),
                    chain: "SOL".to_string(),
                    amount: "326.1".to_string(),
                    value: "$61,492.20".to_string(),
                    change24h: 6.1,
                },
                AssetItem {
                    name: "BNB".to_string(),
                    symbol: "BNB".to_string(),
                    chain: "BNB".to_string(),
                    amount: "54.7".to_string(),
                    value: "$17,231.53".to_string(),
                    change24h: -1.2,
                },
                AssetItem {
                    name: "Tether".to_string(),
                    symbol: "USDT".to_string(),
                    chain: "ETH".to_string(),
                    amount: "4,500".to_string(),
                    value: "$4,500.00".to_string(),
                    change24h: 0.0,
                },
            ],
            defi: vec![
                AssetItem {
                    name: "Jito Staked SOL".to_string(),
                    symbol: "JITOSOL".to_string(),
                    chain: "SOL".to_string(),
                    amount: "18.2".to_string(),
                    value: "$3,410.74".to_string(),
                    change24h: 4.9,
                },
                AssetItem {
                    name: "Pancake LP".to_string(),
                    symbol: "CAKE-LP".to_string(),
                    chain: "BNB".to_string(),
                    amount: "11.7".to_string(),
                    value: "$2,107.33".to_string(),
                    change24h: 1.6,
                },
            ],
            nfts: vec![
                AssetItem {
                    name: "Mad Lads".to_string(),
                    symbol: "MADLAD".to_string(),
                    chain: "SOL".to_string(),
                    amount: "1".to_string(),
                    value: "$9,234.50".to_string(),
                    change24h: 12.2,
                },
                AssetItem {
                    name: "Azuki".to_string(),
                    symbol: "AZUKI".to_string(),
                    chain: "ETH".to_string(),
                    amount: "1".to_string(),
                    value: "$14,122.00".to_string(),
                    change24h: -2.3,
                },
            ],
        },
        updated_at: now_iso_string(),
    }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

pub fn round2(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

fn now_iso_string() -> String {
    chrono::Utc::now().to_rfc3339()
}

pub fn build_cors_layer() -> CorsLayer {
    let origins = env::var("FRONTEND_ORIGINS").unwrap_or_default();
    if origins.trim().is_empty() {
        return CorsLayer::new()
            .allow_origin(Any)
            .allow_methods(Any)
            .allow_headers(Any);
    }

    let allowed = origins
        .split(',')
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .filter_map(|v| v.parse().ok())
        .collect::<Vec<_>>();

    if allowed.is_empty() {
        CorsLayer::new()
            .allow_origin(Any)
            .allow_methods(Any)
            .allow_headers(Any)
    } else {
        CorsLayer::new()
            .allow_origin(allowed)
            .allow_methods(Any)
            .allow_headers(Any)
    }
}

pub async fn bind_first_available(
    base_addr: SocketAddr,
    max_port_offset: u16,
) -> tokio::net::TcpListener {
    for offset in 0..=max_port_offset {
        let candidate =
            SocketAddr::new(base_addr.ip(), base_addr.port().saturating_add(offset));
        if let Ok(listener) = tokio::net::TcpListener::bind(candidate).await {
            return listener;
        }
    }

    panic!(
        "Failed to bind server on {} or the next {} ports",
        base_addr, max_port_offset
    );
}
