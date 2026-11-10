//! Generic fan out of pre serialised JSON messages to WebSocket clients.

use std::{sync::Arc, time::Duration};

use axum::{
    extract::ws::{Message, WebSocket, WebSocketUpgrade},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use tokio::sync::{broadcast, broadcast::error::RecvError, OwnedSemaphorePermit};

use crate::AppState;

#[derive(Clone, Copy)]
pub enum Channel {
    Market,
    Whales,
    Sniper,
}

pub async fn upgrade(
    ws: WebSocketUpgrade,
    headers: HeaderMap,
    state: Arc<AppState>,
    channel: Channel,
) -> Response {
    let origin = headers.get("origin").and_then(|v| v.to_str().ok());
    if !state.config.origin_allowed(origin) {
        return (StatusCode::FORBIDDEN, "origin not allowed").into_response();
    }
    let Ok(permit) = state.ws_slots.clone().try_acquire_owned() else {
        return (StatusCode::SERVICE_UNAVAILABLE, "too many live connections").into_response();
    };
    let (rx, initial) = match channel {
        Channel::Market => {
            let snapshot = current_tickers_message(&state);
            (state.binance.tx.subscribe(), snapshot)
        }
        Channel::Whales => (state.whales.tx.subscribe(), None),
        Channel::Sniper => (state.sniper.tx.subscribe(), None),
    };
    ws.max_message_size(4 * 1024)
        .on_upgrade(move |socket| relay(socket, rx, initial, permit))
}

fn current_tickers_message(state: &AppState) -> Option<String> {
    let map = state.binance.tickers.read().unwrap_or_else(|e| e.into_inner());
    let data: Vec<_> = state
        .config
        .tracked_symbols
        .iter()
        .filter_map(|s| map.get(&format!("{s}USDT")))
        .collect();
    if data.is_empty() {
        return None;
    }
    let source = *state.binance.tickers_source.read().unwrap_or_else(|e| e.into_inner());
    Some(serde_json::json!({ "type": "tickers", "source": source, "data": data }).to_string())
}

async fn relay(
    mut socket: WebSocket,
    mut rx: broadcast::Receiver<String>,
    initial: Option<String>,
    _permit: OwnedSemaphorePermit,
) {
    if let Some(first) = initial {
        if socket.send(Message::Text(first)).await.is_err() {
            return;
        }
    }
    let mut ping = tokio::time::interval(Duration::from_secs(25));
    ping.tick().await;
    loop {
        tokio::select! {
            msg = rx.recv() => match msg {
                Ok(text) => {
                    if socket.send(Message::Text(text)).await.is_err() {
                        break;
                    }
                }
                Err(RecvError::Lagged(_)) => continue,
                Err(RecvError::Closed) => break,
            },
            incoming = socket.recv() => match incoming {
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                Some(Ok(_)) => {}
            },
            _ = ping.tick() => {
                if socket.send(Message::Ping(Vec::new())).await.is_err() {
                    break;
                }
            }
        }
    }
}
