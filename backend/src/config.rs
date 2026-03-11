use std::env;

#[derive(Debug, Clone)]
pub struct Config {
    pub host: String,
    pub port: u16,
    pub database_url: String,
    pub frontend_origins: String,
    pub mail_host: String,
    pub mail_port: u16,
    pub mail_username: String,
    pub mail_password: String,
    pub mail_from: String,
    pub mail_from_name: String,
    pub gnews_api_key: Option<String>,
    pub newsapi_api_key: Option<String>,
}

impl Config {
    pub fn from_env() -> Self {
        Self {
            host: env::var("HOST").unwrap_or_else(|_| "0.0.0.0".to_string()),
            port: env::var("PORT")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(4000),
            database_url: env::var("DATABASE_URL")
                .unwrap_or_else(|_| "sqlite:arctos.db".to_string()),
            frontend_origins: env::var("FRONTEND_ORIGINS").unwrap_or_default(),
            mail_host: env::var("MAIL_HOST")
                .unwrap_or_else(|_| "smtp-relay.brevo.com".to_string()),
            mail_port: env::var("MAIL_PORT")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(587),
            mail_username: env::var("MAIL_USERNAME").unwrap_or_default(),
            mail_password: env::var("MAIL_PASSWORD").unwrap_or_default(),
            mail_from: env::var("MAIL_FROM")
                .unwrap_or_else(|_| "noreply@arctos.io".to_string()),
            mail_from_name: env::var("MAIL_FROM_NAME")
                .unwrap_or_else(|_| "Arctos".to_string()),
            gnews_api_key: env::var("GNEWS_API_KEY").ok().filter(|v| !v.is_empty()),
            newsapi_api_key: env::var("NEWSAPI_API_KEY").ok().filter(|v| !v.is_empty()),
        }
    }
}
