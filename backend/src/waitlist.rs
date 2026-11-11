//! Waitlist: real positions stored in PostgreSQL, welcome email sent from the server.
//! The client can never choose the email subject or body.

use std::{str::FromStr, sync::Arc, time::Duration};

use axum::{extract::State, http::HeaderMap, Json};
use lettre::{
    message::{header::ContentType, MultiPart, SinglePart},
    transport::smtp::authentication::Credentials,
    AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor,
};
use serde::{Deserialize, Serialize};
use sqlx::{
    postgres::{PgConnectOptions, PgPoolOptions},
    PgPool,
};

use crate::{
    error::{AppError, Result},
    AppState,
};

pub fn normalize_database_url(database_url: &str) -> String {
    let mut normalized = database_url.trim().to_string();
    if normalized.starts_with("postgres://") {
        normalized = normalized.replacen("postgres://", "postgresql://", 1);
    }
    if normalized.contains("sslmode=") {
        return normalized;
    }
    normalized.push(if normalized.contains('?') { '&' } else { '?' });
    normalized.push_str("sslmode=require");
    normalized
}

/// Connects to Postgres if configured. Failure is logged and the service keeps running without it.
pub async fn connect(database_url: Option<&str>) -> Option<PgPool> {
    let url = database_url?;
    let options = match PgConnectOptions::from_str(&normalize_database_url(url)) {
        // Works with connection poolers in transaction mode (Supabase pooler).
        Ok(o) => o.statement_cache_capacity(0),
        Err(e) => {
            tracing::error!("DATABASE_URL is not valid: {e}");
            return None;
        }
    };
    let pool = match PgPoolOptions::new()
        .max_connections(5)
        .acquire_timeout(Duration::from_secs(8))
        .connect_with(options)
        .await
    {
        Ok(p) => p,
        Err(e) => {
            tracing::error!(
                "could not connect to PostgreSQL, waitlist will run without persistence: {e}"
            );
            return None;
        }
    };
    let migrated = sqlx::query(
        "CREATE TABLE IF NOT EXISTS waitlist (
            id BIGSERIAL PRIMARY KEY,
            email TEXT NOT NULL UNIQUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )",
    )
    .execute(&pool)
    .await;
    match migrated {
        Ok(_) => {
            tracing::info!("PostgreSQL ready (waitlist)");
            Some(pool)
        }
        Err(e) => {
            tracing::error!("waitlist migration failed: {e}");
            None
        }
    }
}

pub fn valid_email(email: &str) -> bool {
    if !(6..=254).contains(&email.len()) {
        return false;
    }
    let mut parts = email.split('@');
    let (Some(local), Some(domain), None) = (parts.next(), parts.next(), parts.next()) else {
        return false;
    };
    if local.is_empty()
        || local.len() > 64
        || local.starts_with('.')
        || local.ends_with('.')
        || local.contains("..")
    {
        return false;
    }
    let local_ok = local
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b".!#$%&'*+/=?^_`{|}~-".contains(&b));
    if !local_ok
        || !domain.contains('.')
        || domain.starts_with('.')
        || domain.ends_with('.')
        || domain.contains("..")
    {
        return false;
    }
    domain.split('.').all(|label| {
        !label.is_empty()
            && label.len() <= 63
            && !label.starts_with('-')
            && !label.ends_with('-')
            && label
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-')
    })
}

fn welcome_email(site_url: &str, position: Option<i64>) -> (String, String) {
    let place = match position {
        Some(p) => format!("You are number {p} on the list."),
        None => "You are on the list.".to_string(),
    };
    let text = format!(
        "Welcome to Arctos.\n\n{place}\n\nWe are building a trading platform that brings live market data, whale activity, \
fundamental news and an AI assistant into one place. We will email you when early access opens.\n\n{site_url}\n\n\
You are receiving this because you joined the Arctos waitlist. Nothing here is financial advice.\n"
    );
    // Only fixed text and an integer are interpolated, so no user input reaches the HTML.
    let html = format!(
        "<div style=\"font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111827\">\
<h1 style=\"font-size:22px;margin:0 0 12px\">Welcome to Arctos</h1>\
<p style=\"font-size:16px;margin:0 0 12px\"><strong>{place}</strong></p>\
<p style=\"font-size:15px;line-height:1.6;margin:0 0 16px\">We are building a trading platform that brings live market data, whale activity, \
fundamental news and an AI assistant into one place. We will email you when early access opens.</p>\
<p style=\"margin:0 0 20px\"><a href=\"{site_url}\" style=\"background:#2563eb;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none\">Visit Arctos</a></p>\
<p style=\"font-size:12px;color:#6b7280\">You are receiving this because you joined the Arctos waitlist. Nothing here is financial advice.</p></div>"
    );
    (text, html)
}

async fn send_welcome(state: Arc<AppState>, email: String, position: Option<i64>) {
    let cfg = &state.config;
    if cfg.mail_username.is_empty() || cfg.mail_password.is_empty() {
        tracing::warn!("SMTP is not configured, skipping the welcome email");
        return;
    }
    let (text, html) = welcome_email(&cfg.public_site_url, position);
    let built = (|| -> std::result::Result<Message, String> {
        Message::builder()
            .from(
                format!("{} <{}>", cfg.mail_from_name, cfg.mail_from)
                    .parse()
                    .map_err(|e| format!("from address: {e}"))?,
            )
            .to(email.parse().map_err(|e| format!("to address: {e}"))?)
            .subject("You're on the Arctos waitlist")
            .multipart(
                MultiPart::alternative()
                    .singlepart(
                        SinglePart::builder()
                            .header(ContentType::TEXT_PLAIN)
                            .body(text),
                    )
                    .singlepart(
                        SinglePart::builder()
                            .header(ContentType::TEXT_HTML)
                            .body(html),
                    ),
            )
            .map_err(|e| format!("message: {e}"))
    })();
    let message = match built {
        Ok(m) => m,
        Err(e) => {
            tracing::error!("could not build welcome email: {e}");
            return;
        }
    };
    let builder = if cfg.mail_port == 465 {
        AsyncSmtpTransport::<Tokio1Executor>::relay(&cfg.mail_host)
    } else {
        AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&cfg.mail_host)
    };
    let mailer = match builder {
        Ok(b) => b
            .port(cfg.mail_port)
            .credentials(Credentials::new(
                cfg.mail_username.clone(),
                cfg.mail_password.clone(),
            ))
            .build(),
        Err(e) => {
            tracing::error!("SMTP setup failed: {e}");
            return;
        }
    };
    if let Err(e) = mailer.send(message).await {
        tracing::error!("welcome email failed: {e}");
    }
}

#[derive(Deserialize)]
pub struct JoinRequest {
    email: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinResponse {
    ok: bool,
    position: Option<i64>,
    already_joined: bool,
    persisted: bool,
}

pub async fn join(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(req): Json<JoinRequest>,
) -> Result<Json<JoinResponse>> {
    let origin = headers.get("origin").and_then(|v| v.to_str().ok());
    if !state.config.origin_allowed(origin) {
        return Err(AppError::Forbidden("origin not allowed".into()));
    }
    let email = req.email.trim().to_ascii_lowercase();
    if !valid_email(&email) {
        return Err(AppError::BadRequest(
            "Please enter a valid email address.".into(),
        ));
    }

    let Some(pool) = &state.db else {
        // Without a database we cannot give a real position, so we do not invent one.
        let first_time = state
            .waitlist_mem
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(email.clone());
        if first_time {
            tokio::spawn(send_welcome(state.clone(), email, None));
        }
        return Ok(Json(JoinResponse {
            ok: true,
            position: None,
            already_joined: !first_time,
            persisted: false,
        }));
    };

    let inserted: Option<(i64,)> = sqlx::query_as(
        "INSERT INTO waitlist (email) VALUES ($1) ON CONFLICT (email) DO NOTHING RETURNING id",
    )
    .bind(&email)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::Internal(format!("waitlist insert: {e}")))?;
    let (id, already) = match inserted {
        Some((id,)) => (id, false),
        None => {
            let existing: (i64,) = sqlx::query_as("SELECT id FROM waitlist WHERE email = $1")
                .bind(&email)
                .fetch_one(pool)
                .await
                .map_err(|e| AppError::Internal(format!("waitlist lookup: {e}")))?;
            (existing.0, true)
        }
    };
    let (position,): (i64,) = sqlx::query_as("SELECT COUNT(*) FROM waitlist WHERE id <= $1")
        .bind(id)
        .fetch_one(pool)
        .await
        .map_err(|e| AppError::Internal(format!("waitlist position: {e}")))?;

    // Only the first signup triggers an email, so the endpoint cannot be used to spam an inbox.
    if !already {
        tokio::spawn(send_welcome(state.clone(), email, Some(position)));
    }
    Ok(Json(JoinResponse {
        ok: true,
        position: Some(position),
        already_joined: already,
        persisted: true,
    }))
}

#[derive(Serialize)]
pub struct CountResponse {
    count: Option<i64>,
}

pub async fn count(State(state): State<Arc<AppState>>) -> Result<Json<CountResponse>> {
    let Some(pool) = state.db.clone() else {
        return Ok(Json(CountResponse { count: None }));
    };
    let count = state
        .waitlist_count
        .get_or_fetch("count", || async move {
            let row: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM waitlist")
                .fetch_one(&pool)
                .await
                .map_err(|e| e.to_string())?;
            Ok::<_, String>(row.0)
        })
        .await
        .ok();
    Ok(Json(CountResponse { count }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn email_validation() {
        for ok in ["a@b.co", "first.last+tag@sub.example.com", "x_y@example.io"] {
            assert!(valid_email(ok), "{ok} should be valid");
        }
        for bad in [
            "plain",
            "a@b",
            "@example.com",
            "a@@example.com",
            "a b@example.com",
            "a@exa mple.com",
            "a@example.com\r\nBcc: victim@example.com",
            "a\n@example.com",
            ".a@example.com",
            "a..b@example.com",
            "a@-example.com",
            "a@example..com",
            "<script>@example.com",
            "\"quoted\"@example.com",
            "a,b@example.com",
        ] {
            assert!(!valid_email(bad), "{bad:?} should be rejected");
        }
        assert!(!valid_email(&format!("{}@example.com", "a".repeat(65))));
    }

    #[test]
    fn database_url_gets_ssl() {
        assert_eq!(
            normalize_database_url("postgres://u:p@db.example.supabase.co:5432/postgres"),
            "postgresql://u:p@db.example.supabase.co:5432/postgres?sslmode=require"
        );
        assert!(normalize_database_url("postgresql://u:p@h/db?options=x")
            .ends_with("options=x&sslmode=require"));
        assert_eq!(
            normalize_database_url("postgresql://h/db?sslmode=disable"),
            "postgresql://h/db?sslmode=disable"
        );
    }

    #[test]
    fn welcome_email_never_contains_user_input() {
        let (text, html) = welcome_email("https://arctos.example", Some(42));
        assert!(text.contains("number 42"));
        assert!(html.contains("number 42"));
        let (text, _) = welcome_email("https://arctos.example", None);
        assert!(!text.contains("number"), "no invented position");
    }
}
