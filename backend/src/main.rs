use std::{net::SocketAddr, sync::Arc};

use arctos_backend::{build_router, build_state, spawn_background, Config};
use tokio::net::TcpListener;
use tracing::info;

#[tokio::main]
async fn main() {
    let _ = dotenv::dotenv();

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "arctos_backend=info,tower_http=warn".into()),
        )
        .init();

    let config = Config::from_env();
    let addr: SocketAddr = format!("{}:{}", config.host, config.port)
        .parse()
        .unwrap_or_else(|_| SocketAddr::from(([0, 0, 0, 0], 4000)));

    let state = build_state(config).await;
    spawn_background(Arc::clone(&state));
    let app = build_router(Arc::clone(&state));

    let listener = TcpListener::bind(addr)
        .await
        .unwrap_or_else(|e| panic!("cannot bind {addr}: {e}"));
    info!(
        "Arctos data service listening on http://{}",
        listener.local_addr().unwrap_or(addr)
    );

    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await
    .expect("server error");
}

async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut s) = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            s.recv().await;
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! { _ = ctrl_c => {}, _ = terminate => {} }
    info!("shutting down");
}
