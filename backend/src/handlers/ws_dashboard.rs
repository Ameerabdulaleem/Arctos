use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    response::IntoResponse,
};
use std::sync::Arc;

use crate::{types::DashboardSnapshot, AppState};

pub async fn ws_dashboard(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_ws_connection(socket, state))
}

async fn handle_ws_connection(mut socket: WebSocket, state: Arc<AppState>) {
    let initial_snapshot = state.latest_snapshot.read().await.clone();
    if let Ok(text) = serde_json::to_string(&initial_snapshot) {
        if socket.send(Message::Text(text)).await.is_err() {
            return;
        }
    } else {
        return;
    }

    let mut rx = state.dashboard_tx.subscribe();

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

pub async fn run_snapshot_updater(state: Arc<AppState>) {
    let mut tick: u64 = 1;
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(3));

    loop {
        interval.tick().await;

        let next = crate::build_snapshot(tick);
        {
            let mut lock = state.latest_snapshot.write().await;
            *lock = next.clone();
        }

        let _ = state.dashboard_tx.send(next);
        tick = tick.saturating_add(1);
    }
}
