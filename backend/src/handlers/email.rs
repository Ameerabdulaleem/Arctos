use axum::{extract::State, Json};
use lettre::{
    message::header::ContentType,
    transport::smtp::authentication::Credentials,
    AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor,
};
use std::sync::Arc;

use crate::{
    error::{AppError, Result},
    types::{EmailRequest, EmailResponse},
    AppState,
};

pub async fn send_email(
    State(state): State<Arc<AppState>>,
    Json(body): Json<EmailRequest>,
) -> Result<Json<EmailResponse>> {
    let cfg = &state.config;

    // Require SMTP credentials to be configured
    if cfg.mail_username.is_empty() || cfg.mail_password.is_empty() {
        tracing::warn!("SMTP credentials not configured – email not sent");
        return Ok(Json(EmailResponse {
            success: false,
            message: "SMTP credentials are not configured on the server.".to_string(),
        }));
    }

    let from_addr = format!("{} <{}>", cfg.mail_from_name, cfg.mail_from);

    let email = Message::builder()
        .from(
            from_addr
                .parse()
                .map_err(|e| AppError::BadRequest(format!("Invalid from address: {}", e)))?,
        )
        .to(body
            .to
            .parse()
            .map_err(|e| AppError::BadRequest(format!("Invalid to address: {}", e)))?)
        .subject(&body.subject)
        .header(ContentType::TEXT_HTML)
        .body(body.html)
        .map_err(|e| AppError::Internal(format!("Failed to build email: {}", e)))?;

    let creds = Credentials::new(cfg.mail_username.clone(), cfg.mail_password.clone());

    let smtp_host = cfg.mail_host.clone();
    let smtp_port = cfg.mail_port;

    let mailer = AsyncSmtpTransport::<Tokio1Executor>::relay(&smtp_host)
        .map_err(|e| AppError::Internal(format!("SMTP relay error: {}", e)))?
        .port(smtp_port)
        .credentials(creds)
        .build();

    match mailer.send(email).await {
        Ok(_) => Ok(Json(EmailResponse {
            success: true,
            message: "Email sent successfully.".to_string(),
        })),
        Err(e) => {
            tracing::error!("SMTP send error: {}", e);
            Ok(Json(EmailResponse {
                success: false,
                message: format!("Failed to send email: {}", e),
            }))
        }
    }
}
