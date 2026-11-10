use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("not found: {0}")]
    NotFound(String),

    #[error("bad request: {0}")]
    BadRequest(String),

    #[error("rate limited")]
    TooManyRequests,

    /// A feature that needs configuration which is missing (for example no API key).
    #[error("unavailable: {0}")]
    Unavailable(String),

    #[error("upstream error: {0}")]
    Upstream(String),

    #[error("forbidden: {0}")]
    Forbidden(String),

    #[error("internal error: {0}")]
    Internal(String),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        // Messages that reach the client are deliberately generic for anything
        // that could leak internals (database, upstream bodies, keys).
        let (status, message) = match &self {
            AppError::NotFound(m) => (StatusCode::NOT_FOUND, m.clone()),
            AppError::BadRequest(m) => (StatusCode::BAD_REQUEST, m.clone()),
            AppError::Forbidden(m) => (StatusCode::FORBIDDEN, m.clone()),
            AppError::Unavailable(m) => (StatusCode::SERVICE_UNAVAILABLE, m.clone()),
            AppError::TooManyRequests => (
                StatusCode::TOO_MANY_REQUESTS,
                "Too many requests. Please slow down and try again shortly.".to_string(),
            ),
            AppError::Upstream(m) => {
                tracing::warn!("upstream failure: {m}");
                (StatusCode::BAD_GATEWAY, "The upstream data provider is not responding right now.".to_string())
            }
            AppError::Internal(m) => {
                tracing::error!("internal error: {m}");
                (StatusCode::INTERNAL_SERVER_ERROR, "Something went wrong on our side.".to_string())
            }
        };
        (status, Json(json!({ "error": message }))).into_response()
    }
}

pub type Result<T> = std::result::Result<T, AppError>;
