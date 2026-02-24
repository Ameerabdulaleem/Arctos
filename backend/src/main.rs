use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    env,
    net::SocketAddr,
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::sync::{broadcast, RwLock};
use tower_http::cors::{Any, CorsLayer};

#[derive(Clone)]
struct AppState {
    latest_snapshot: Arc<RwLock<DashboardSnapshot>>,
    tx: broadcast::Sender<DashboardSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DashboardSnapshot {
    metrics: DashboardMetrics,
    recent_activities: Vec<RecentActivity>,
    assets: DashboardAssets,
    updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DashboardMetrics {
    portfolio_value: f64,
    portfolio_change_percent: f64,
    portfolio_change_value: f64,
    altseason_index: u32,
    altseason_trend: Vec<u32>,
    btc_dominance: f64,
    eth_dominance: f64,
    dominance_map: HashMap<String, f64>,
    total_market_cap: f64,
    market_cap_change_percent: f64,
    market_cap_trend: Vec<f64>,
    fear_greed_index: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecentActivity {
    action: String,
    amount: String,
    value: String,
    time: String,
    chain: String,
    chain_color: String,
    r#type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DashboardAssets {
    tokens: Vec<AssetItem>,
    defi: Vec<AssetItem>,
    nfts: Vec<AssetItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AssetItem {
    name: String,
    symbol: String,
    chain: String,
    amount: String,
    value: String,
    change24h: f64,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let initial_snapshot = build_snapshot(0);
    let (tx, _) = broadcast::channel::<DashboardSnapshot>(64);
    let state = AppState {
        latest_snapshot: Arc::new(RwLock::new(initial_snapshot.clone())),
        tx: tx.clone(),
    };

    let updater_state = state.clone();
    tokio::spawn(async move {
        run_snapshot_updater(updater_state).await;
    });

    let app = Router::new()
        .route("/", get(root))
        .route("/api/dashboard/overview", get(get_dashboard_overview))
        .route("/ws/dashboard", get(ws_dashboard))
        .layer(build_cors_layer())
        .with_state(state);

    let host = env::var("BACKEND_HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
    let port = env::var("BACKEND_PORT")
        .ok()
        .and_then(|v| v.parse::<u16>().ok())
        .unwrap_or(4000);
    let addr: SocketAddr = format!("{}:{}", host, port)
        .parse()
        .unwrap_or(SocketAddr::from(([127, 0, 0, 1], 4000)));

    println!("Starting server at http://{}", addr);
    axum::Server::bind(&addr)
        .serve(app.into_make_service())
        .await
        .unwrap();
}

async fn root() -> &'static str {
    "Arctos backend live sync server"
}

async fn get_dashboard_overview(State(state): State<AppState>) -> Json<DashboardSnapshot> {
    let snapshot = state.latest_snapshot.read().await.clone();
    Json(snapshot)
}

async fn ws_dashboard(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_ws_connection(socket, state))
}

async fn handle_ws_connection(mut socket: WebSocket, state: AppState) {
    let initial_snapshot = state.latest_snapshot.read().await.clone();
    if let Ok(initial_text) = serde_json::to_string(&initial_snapshot) {
        if socket.send(Message::Text(initial_text)).await.is_err() {
            return;
        }
    } else {
        return;
    }

    let mut rx = state.tx.subscribe();

    loop {
        tokio::select! {
            msg = rx.recv() => {
                match msg {
                    Ok(snapshot) => {
                        if let Ok(text) = serde_json::to_string(&snapshot) {
                            if socket.send(Message::Text(text)).await.is_err() {
                                break;
                            }
                        }
                    }
                    Err(_) => break,
                }
            }
            incoming = socket.recv() => {
                match incoming {
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(_)) => {}
                    Some(Err(_)) => break,
                }
            }
        }
    }
}

async fn run_snapshot_updater(state: AppState) {
    let mut tick: u64 = 1;
    let mut interval = tokio::time::interval(Duration::from_secs(3));

    loop {
        interval.tick().await;

        let next = build_snapshot(tick);
        {
            let mut lock = state.latest_snapshot.write().await;
            *lock = next.clone();
        }

        let _ = state.tx.send(next);
        tick = tick.saturating_add(1);
    }
}

fn build_snapshot(tick: u64) -> DashboardSnapshot {
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
            market_cap_trend: vec![2.22, 2.24, 2.27, 2.31, 2.28, 2.35, 2.39, round2(total_market_cap / 1e12)],
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

fn round2(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

fn now_iso_string() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn build_cors_layer() -> CorsLayer {
    let origins = env::var("FRONTEND_ORIGINS").unwrap_or_default();
    if origins.trim().is_empty() {
        return CorsLayer::new().allow_origin(Any).allow_methods(Any).allow_headers(Any);
    }

    let allowed = origins
        .split(',')
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .filter_map(|v| v.parse().ok())
        .collect::<Vec<_>>();

    if allowed.is_empty() {
        CorsLayer::new().allow_origin(Any).allow_methods(Any).allow_headers(Any)
    } else {
        CorsLayer::new()
            .allow_origin(allowed)
            .allow_methods(Any)
            .allow_headers(Any)
    }
}
