//! The PostgreSQL connection shared by the waitlist, the trade keeper and the
//! sniper's developer records.
//!
//! The schema is versioned. Each file in `migrations/` is applied once, in
//! order, inside one transaction that holds an advisory lock, so several
//! copies of the service starting together cannot trip over each other. A
//! file records its own version in `arctos.schema_migrations`, which is what
//! lets the same file be applied by hand (for example from the Supabase
//! dashboard) without the service applying it twice.
//!
//! Every query is sent as an unnamed statement (`persistent(false)`). That is
//! what a connection pooler in transaction mode, such as Supabase's, needs:
//! named statements would live on a server connection that the next request
//! may not get.

use std::{
    str::FromStr,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use sqlx::{
    postgres::{PgConnectOptions, PgPoolOptions},
    Executor, PgPool,
};

/// The versioned schema, oldest first.
const MIGRATIONS: &[(i32, &str)] = &[(1, include_str!("../migrations/0001_arctos_schema.sql"))];

/// An arbitrary number that names the migration lock in PostgreSQL.
const MIGRATION_LOCK: i64 = 0x4152_4354_4f53;

/// After a failed connection, requests use the database again only after this
/// pause, so a database that is down does not slow every request.
const RETRY_AFTER: Duration = Duration::from_secs(30);

pub struct Database {
    pool: PgPool,
    ready: tokio::sync::OnceCell<()>,
    failed_at: Mutex<Option<Instant>>,
}

impl Database {
    fn new(pool: PgPool) -> Self {
        Self {
            pool,
            ready: tokio::sync::OnceCell::new(),
            failed_at: Mutex::new(None),
        }
    }

    /// The pool, once the schema is known to be up to date.
    pub async fn pool(&self) -> Result<&PgPool, String> {
        if self.ready.initialized() {
            return Ok(&self.pool);
        }
        if self
            .failed_at
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .is_some_and(|at| at.elapsed() < RETRY_AFTER)
        {
            return Err("the database was unreachable moments ago".into());
        }
        let outcome = self
            .ready
            .get_or_try_init(|| async { migrate(&self.pool).await.map_err(|e| e.to_string()) })
            .await;
        match outcome {
            Ok(()) => Ok(&self.pool),
            Err(e) => {
                tracing::error!("database is not reachable: {e}");
                *self.failed_at.lock().unwrap_or_else(|e| e.into_inner()) = Some(Instant::now());
                Err(e)
            }
        }
    }

    /// True once the service has reached the database and its schema is ready.
    pub fn is_ready(&self) -> bool {
        self.ready.initialized()
    }
}

/// Applies every migration this database has not seen yet.
///
/// A migration file holds several statements, so it is sent as one plain
/// query (the simple protocol), which PostgreSQL runs statement by statement.
async fn migrate(pool: &PgPool) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock($1)")
        .bind(MIGRATION_LOCK)
        .persistent(false)
        .execute(&mut *tx)
        .await?;
    (&mut *tx)
        .execute(
            "CREATE SCHEMA IF NOT EXISTS arctos;
             CREATE TABLE IF NOT EXISTS arctos.schema_migrations (
                 version    INT         PRIMARY KEY,
                 name       TEXT        NOT NULL,
                 applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
             );",
        )
        .await?;
    let applied: Vec<i32> = sqlx::query_scalar("SELECT version FROM arctos.schema_migrations")
        .persistent(false)
        .fetch_all(&mut *tx)
        .await?;
    for (version, sql) in MIGRATIONS {
        if !applied.contains(version) {
            tracing::info!("applying database migration {version}");
            (&mut *tx).execute(*sql).await?;
        }
    }
    tx.commit().await
}

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

/// Connects to PostgreSQL if a database is configured. A failure is logged and
/// the service carries on without one.
///
/// With `lazy` set (on demand mode) nothing is opened here: the first request
/// that needs the database connects, so requests that never touch it do not
/// pay for it.
pub async fn connect(database_url: Option<&str>, lazy: bool) -> Option<Arc<Database>> {
    let url = database_url?;
    let options = match PgConnectOptions::from_str(&normalize_database_url(url)) {
        Ok(o) => o.statement_cache_capacity(0).application_name("arctos"),
        Err(e) => {
            tracing::error!("DATABASE_URL is not valid: {e}");
            return None;
        }
    };
    if lazy {
        let pool = PgPoolOptions::new()
            .max_connections(3)
            .acquire_timeout(Duration::from_secs(8))
            // A pooler closes idle connections, and a sleeping function may
            // hold one for a long time. Old connections are let go early.
            .idle_timeout(Duration::from_secs(60))
            .connect_lazy_with(options);
        return Some(Arc::new(Database::new(pool)));
    }
    let pool = match PgPoolOptions::new()
        .max_connections(5)
        .acquire_timeout(Duration::from_secs(8))
        .connect_with(options)
        .await
    {
        Ok(p) => p,
        Err(e) => {
            tracing::error!("could not connect to PostgreSQL, running without it: {e}");
            return None;
        }
    };
    let db = Arc::new(Database::new(pool));
    match db.pool().await {
        Ok(_) => {
            tracing::info!("PostgreSQL ready");
            Some(db)
        }
        Err(_) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn a_hosted_pooler_address_is_accepted() {
        // The address Supabase hands out for its transaction pooler, with the
        // extra settings some integrations add. Unknown settings are ignored.
        let url = "postgres://postgres.abcdefghijklmnopqrst:secret@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?supa=base-pooler.x&pgbouncer=true";
        let normalized = normalize_database_url(url);
        assert!(normalized.ends_with("&sslmode=require"));
        assert!(PgConnectOptions::from_str(&normalized).is_ok());
    }

    #[test]
    fn migrations_are_numbered_in_order_and_record_themselves() {
        for (i, (version, sql)) in MIGRATIONS.iter().enumerate() {
            assert_eq!(*version, i as i32 + 1);
            assert!(
                sql.contains(&format!("VALUES ({version}, ")),
                "migration {version} must insert its own row into arctos.schema_migrations"
            );
        }
    }

    /// Every query in the service must be an unnamed statement, or it breaks
    /// behind a pooler in transaction mode.
    #[test]
    fn every_query_is_sent_unnamed() {
        for (file, source) in [
            ("db.rs", include_str!("db.rs")),
            ("keeper.rs", include_str!("keeper.rs")),
            ("records.rs", include_str!("records.rs")),
            ("waitlist.rs", include_str!("waitlist.rs")),
        ] {
            let code = source.split("#[cfg(test)]").next().unwrap_or(source);
            let queries = code.matches("sqlx::query").count();
            let unnamed = code.matches(".persistent(false)").count();
            assert_eq!(
                queries, unnamed,
                "{file}: every sqlx::query needs .persistent(false)"
            );
        }
    }
}
