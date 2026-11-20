//! Narrow proxies to the swap and bridge providers that need a key, used by
//! the swap and bridge panel in the trading terminal.
//!
//! Providers that work without a key (KyberSwap, Sushi, Jupiter and, without
//! a key, Relay) are called straight from the browser, so every visitor gets
//! their own rate limit. The providers below need a credential, so the browser
//! talks to `/api/<provider>/...` on this site instead and the proxy:
//!
//! * forwards only the paths and methods the swap flow uses,
//! * adds the credential from the server's environment, so it never reaches
//!   the browser,
//! * forwards nothing from the browser except the JSON body and the query
//!   (no cookies, no auth headers), never follows a redirect, and returns the
//!   provider's answer with its status.
//!
//! Nothing here signs or sends a transaction: every step is signed in the
//! user's own wallet.

use std::{sync::Arc, time::Duration};

use axum::{
    body::Bytes,
    extract::{Path, RawQuery, State},
    http::{header, HeaderMap, HeaderName, HeaderValue, Method, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;

use crate::{error::AppError, AppState};

pub const MAX_BODY: usize = 64 * 1024;
const MAX_PATH: usize = 200;
const MAX_QUERY: usize = 2000;
const TIMEOUT: Duration = Duration::from_secs(25);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Provider {
    Relay,
    ZeroX,
    Squid,
}

impl Provider {
    fn name(self) -> &'static str {
        match self {
            Provider::Relay => "relay",
            Provider::ZeroX => "0x",
            Provider::Squid => "squid",
        }
    }

    /// True for a path and method the swap flow uses with this provider.
    pub fn allows(self, method: &Method, path: &str) -> bool {
        if !plain_path(path) {
            return false;
        }
        let path = path.trim_start_matches('/');
        match self {
            // Quotes, status, token lookups and the SDK's execution helpers.
            Provider::Relay => {
                const ROOTS: &[&str] = &[
                    "chains",
                    "currencies",
                    "quote",
                    "intents",
                    "requests",
                    "execute",
                    "transactions",
                    "authorize",
                ];
                let root = path.split('/').next().unwrap_or("");
                (*method == Method::GET || *method == Method::POST) && ROOTS.contains(&root)
            }
            Provider::ZeroX => {
                *method == Method::GET
                    && matches!(
                        path,
                        "swap/allowance-holder/price" | "swap/allowance-holder/quote"
                    )
            }
            Provider::Squid => match path {
                "v2/route" => *method == Method::POST,
                "v2/status" => *method == Method::GET,
                _ => false,
            },
        }
    }

    fn base(self, state: &AppState) -> &str {
        match self {
            Provider::Relay => &state.config.relay_base,
            Provider::ZeroX => &state.config.zerox_base,
            Provider::Squid => &state.config.squid_base,
        }
    }

    /// The credential headers for this provider, or `None` when it is not
    /// set up. Relay also works without a key, at lower limits.
    fn credentials(self, state: &AppState) -> Option<Vec<(HeaderName, String)>> {
        let c = &state.config;
        match self {
            Provider::Relay => Some(
                c.relay_api_key
                    .iter()
                    .map(|k| (HeaderName::from_static("x-api-key"), k.clone()))
                    .collect(),
            ),
            Provider::ZeroX => c.zerox_api_key.as_ref().map(|k| {
                vec![
                    (HeaderName::from_static("0x-api-key"), k.clone()),
                    (HeaderName::from_static("0x-version"), "v2".to_string()),
                ]
            }),
            Provider::Squid => c
                .squid_integrator_id
                .as_ref()
                .map(|id| vec![(HeaderName::from_static("x-integrator-id"), id.clone())]),
        }
    }
}

/// Letters, digits and a few separators, with no way to climb out of the API.
fn plain_path(path: &str) -> bool {
    !path.is_empty()
        && path.len() <= MAX_PATH
        && !path.contains("..")
        && !path.contains("//")
        && path
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'/' | b'-' | b'_' | b'.'))
}

fn plain_query(query: &str) -> bool {
    query.len() <= MAX_QUERY && !query.bytes().any(|b| b.is_ascii_control() || b == b'#')
}

/// The same rule as the rest of the API: a request from another site is
/// refused. A same site GET may arrive without an Origin header.
fn origin_ok(state: &AppState, method: &Method, headers: &HeaderMap) -> bool {
    match headers.get(header::ORIGIN) {
        Some(_) => crate::origin_ok(&state.config, headers),
        None => *method == Method::GET || state.config.open_to_any_origin(),
    }
}

async fn forward(
    state: Arc<AppState>,
    provider: Provider,
    method: Method,
    path: String,
    query: Option<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Response, AppError> {
    if !origin_ok(&state, &method, &headers) {
        return Err(AppError::Forbidden("Origin is not allowed.".into()));
    }
    if !provider.allows(&method, &path) {
        return Err(AppError::NotFound(format!(
            "not a {} path this site forwards",
            provider.name()
        )));
    }
    let Some(credentials) = provider.credentials(&state) else {
        return Err(AppError::Unavailable(format!(
            "{} is not set up on this site",
            provider.name()
        )));
    };
    let query = query.unwrap_or_default();
    if !plain_query(&query) {
        return Err(AppError::BadRequest("query is too long".into()));
    }
    if body.len() > MAX_BODY {
        return Err(AppError::BadRequest("request is too large".into()));
    }
    let mut url = format!(
        "{}/{}",
        provider.base(&state).trim_end_matches('/'),
        path.trim_start_matches('/')
    );
    if !query.is_empty() {
        url.push('?');
        url.push_str(&query);
    }
    let mut request = state
        .up
        .keyed_client()
        .request(method.clone(), &url)
        .timeout(TIMEOUT)
        .header(header::ACCEPT, "application/json");
    if method == Method::POST {
        request = request
            .header(header::CONTENT_TYPE, "application/json")
            .body(body);
    }
    for (name, value) in credentials {
        request = request.header(name, value);
    }
    let source = provider.name();
    let upstream = request.send().await.map_err(|e| {
        let why = e.without_url().to_string();
        state.up.note(source, Err(why.clone()));
        AppError::Upstream(format!("{source}: {why}"))
    })?;
    let status =
        StatusCode::from_u16(upstream.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    // Squid's status lookups need the request id of the route they belong to.
    let request_id = upstream
        .headers()
        .get("x-request-id")
        .and_then(|v| v.to_str().ok())
        .filter(|v| v.len() <= 128 && v.bytes().all(|b| b.is_ascii_graphic()))
        .map(str::to_owned);
    let bytes = upstream
        .bytes()
        .await
        .map_err(|e| AppError::Upstream(format!("{source} body: {}", e.without_url())))?;
    if status.is_server_error() {
        state.up.note(source, Err(format!("http {status}")));
    } else {
        state.up.note(source, Ok(()));
    }
    let mut response = (status, bytes).into_response();
    let h = response.headers_mut();
    h.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );
    if let Some(id) = request_id.and_then(|v| HeaderValue::from_str(&v).ok()) {
        h.insert(HeaderName::from_static("x-request-id"), id);
    }
    Ok(response)
}

macro_rules! routes {
    ($get:ident, $post:ident, $provider:expr) => {
        pub async fn $get(
            State(state): State<Arc<AppState>>,
            Path(path): Path<String>,
            RawQuery(query): RawQuery,
            headers: HeaderMap,
        ) -> Result<Response, AppError> {
            forward(
                state,
                $provider,
                Method::GET,
                path,
                query,
                headers,
                Bytes::new(),
            )
            .await
        }

        pub async fn $post(
            State(state): State<Arc<AppState>>,
            Path(path): Path<String>,
            RawQuery(query): RawQuery,
            headers: HeaderMap,
            body: Bytes,
        ) -> Result<Response, AppError> {
            forward(state, $provider, Method::POST, path, query, headers, body).await
        }
    };
}

routes!(relay_get, relay_post, Provider::Relay);
routes!(zerox_get, zerox_post, Provider::ZeroX);
routes!(squid_get, squid_post, Provider::Squid);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProvidersResponse {
    /// Relay calls go through this site with a key. Without one the browser
    /// calls Relay directly.
    relay_keyed: bool,
    zerox: bool,
    squid: bool,
}

/// Which keyed providers this site has set up. Says nothing about the keys.
pub async fn providers(State(state): State<Arc<AppState>>) -> Json<ProvidersResponse> {
    let c = &state.config;
    Json(ProvidersResponse {
        relay_keyed: c.relay_api_key.is_some(),
        zerox: c.zerox_api_key.is_some(),
        squid: c.squid_integrator_id.is_some(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_swap_flow_paths_are_forwarded() {
        let get = Method::GET;
        let post = Method::POST;
        for ok in [
            "chains",
            "quote/v2",
            "currencies/v2",
            "intents/status/v3",
            "requests/v3",
            "execute/permits",
            "transactions/single",
        ] {
            assert!(Provider::Relay.allows(&post, ok), "{ok}");
        }
        assert!(Provider::ZeroX.allows(&get, "swap/allowance-holder/quote"));
        assert!(!Provider::ZeroX.allows(&post, "swap/allowance-holder/quote"));
        assert!(!Provider::ZeroX.allows(&get, "swap/permit2/quote"));
        assert!(Provider::Squid.allows(&post, "v2/route"));
        assert!(Provider::Squid.allows(&get, "v2/status"));
        assert!(!Provider::Squid.allows(&get, "v2/route"));
        assert!(!Provider::Squid.allows(&get, "v2/sdk-info"));
        for bad in [
            "",
            "admin",
            "access-tokens",
            "../secrets",
            "quote/../../admin",
            "quote//v2",
            "quote/v2?x=1",
            "chains%2F..",
            "chains\nHost: evil",
            &"chains/".repeat(60),
        ] {
            assert!(!Provider::Relay.allows(&get, bad), "{bad:?}");
        }
        assert!(!Provider::Relay.allows(&Method::DELETE, "chains"));
    }

    #[test]
    fn queries_are_bounded() {
        assert!(plain_query("requestId=0xabc&user=0xdef"));
        assert!(!plain_query(&"a".repeat(MAX_QUERY + 1)));
        assert!(!plain_query("a=1\r\nb=2"));
    }
}
