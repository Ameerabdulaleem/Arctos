use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    response::IntoResponse,
};
use std::sync::Arc;

use crate::{types::SniperToken, types::SniperUpdateEvent, AppState};

pub async fn ws_sniper(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_sniper_ws(socket, state))
}

async fn handle_sniper_ws(mut socket: WebSocket, state: Arc<AppState>) {
    // Send current tokens as initial token_update events
    let tokens: Vec<SniperToken> = match sqlx::query_as(
        "SELECT id, symbol, name, address, chain, price, liquidity_usd, market_cap_usd, holders, change_24h, status FROM sniper_tokens",
    )
    .fetch_all(&state.db)
    .await
    {
        Ok(rows) if !rows.is_empty() => rows,
        _ => crate::handlers::sniper::mock_tokens_pub(),
    };

    for token in tokens {
        let event = SniperUpdateEvent {
            r#type: "token_update".to_string(),
            token: Some(token),
            execution: None,
        };
        if let Ok(text) = serde_json::to_string(&event) {
            if socket.send(Message::Text(text)).await.is_err() {
                return;
            }
        }
    }

    let mut rx = state.sniper_tx.subscribe();

    loop {
        tokio::select! {
            msg = rx.recv() => {
                match msg {
                    Ok(event) => {
                        if let Ok(text) = serde_json::to_string(&event) {
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
