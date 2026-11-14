//! Arctos data API as a Vercel function.
//!
//! `vercel.json` rewrites every `/api/*` request to this one function. It
//! builds the same Axum router the standalone server uses, switched to on
//! demand mode (no background pollers, no sockets), and hands each request to
//! it. Keeping the API on the same site as the web app means the browser needs
//! no extra configuration and no cross origin permissions.

use std::{
    future::Future,
    pin::Pin,
    task::{Context, Poll},
};

use arctos_backend::{build_router, build_state, serverless::normalize_uri, Config};
use axum::{body::Body, http::StatusCode, Router};
use tower::ServiceExt;
use vercel_runtime::{AppState, Error, Request, Response, ResponseBody};

/// Largest response this function will buffer. Real responses are far smaller.
const MAX_RESPONSE_BYTES: usize = 8 * 1024 * 1024;

/// Bridges the Vercel runtime's request type to the Axum router.
#[derive(Clone)]
struct Adapter {
    router: Router,
}

impl tower::Service<(AppState, Request)> for Adapter {
    type Response = Response<ResponseBody>;
    type Error = Error;
    type Future = Pin<Box<dyn Future<Output = Result<Self::Response, Self::Error>> + Send>>;

    fn poll_ready(&mut self, _cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        Poll::Ready(Ok(()))
    }

    fn call(&mut self, (_state, request): (AppState, Request)) -> Self::Future {
        let router = self.router.clone();
        Box::pin(async move {
            let (mut parts, body) = request.into_parts();
            // Undo the platform rewrite so the router sees the path the browser asked for.
            parts.uri = normalize_uri(&parts.uri);
            // The body is streamed, so the router's own size limits still apply.
            let request = axum::http::Request::from_parts(parts, Body::new(body));

            let response = match router.oneshot(request).await {
                Ok(response) => response,
                Err(never) => match never {},
            };
            let (parts, body) = response.into_parts();
            match axum::body::to_bytes(body, MAX_RESPONSE_BYTES).await {
                Ok(bytes) => Ok(Response::from_parts(parts, ResponseBody::from(bytes))),
                Err(error) => {
                    tracing::error!("could not read the response body: {error}");
                    let mut failed = Response::new(ResponseBody::from(
                        r#"{"error":"The data service could not build a response."}"#,
                    ));
                    *failed.status_mut() = StatusCode::INTERNAL_SERVER_ERROR;
                    failed.headers_mut().insert(
                        axum::http::header::CONTENT_TYPE,
                        axum::http::HeaderValue::from_static("application/json"),
                    );
                    failed.headers_mut().insert(
                        axum::http::header::CACHE_CONTROL,
                        axum::http::HeaderValue::from_static("no-store"),
                    );
                    Ok(failed)
                }
            }
        })
    }
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "arctos_backend=info,main=info".into()),
        )
        .with_ansi(false)
        .init();

    let config = Config::from_env().into_on_demand();
    let state = build_state(config).await;
    let router = build_router(state);
    vercel_runtime::run(Adapter { router }).await
}
