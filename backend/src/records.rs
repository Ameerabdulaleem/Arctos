//! The sniper's long term memory: token checks and developer track records,
//! kept in PostgreSQL so every copy of the service shares them and they
//! survive restarts.
//!
//! Every call here is best effort. A slow or missing database only means the
//! sniper falls back to what this copy of the service has seen itself, so
//! each call has a short time limit and a failure is logged, never returned.

use std::{future::Future, time::Duration};

use chrono::{DateTime, Utc};

use crate::{
    db::Database,
    launchpad::{DevLaunch, Intel},
};

/// No database call may hold up a feed for longer than this.
const CALL_LIMIT: Duration = Duration::from_secs(3);
/// A shared token check is reused for this long, like the in memory one.
pub const CHECK_FRESH_FOR: Duration = Duration::from_secs(600);
/// Token checks are kept this long. Only recent ones are reused.
const KEEP_CHECKS_DAYS: i32 = 3;
/// Launches older than this no longer count towards a developer's record.
const KEEP_LAUNCHES_DAYS: i32 = 180;
/// The most launches read back for one feed.
const MAX_LAUNCHES_READ: i64 = 4000;

async fn bounded<T, F>(what: &str, call: F) -> Option<T>
where
    F: Future<Output = Result<T, String>>,
{
    match tokio::time::timeout(CALL_LIMIT, call).await {
        Ok(Ok(v)) => Some(v),
        Ok(Err(e)) => {
            tracing::warn!("{what} failed: {e}");
            None
        }
        Err(_) => {
            tracing::warn!("{what} took too long");
            None
        }
    }
}

fn millis(at: DateTime<Utc>) -> i64 {
    at.timestamp_millis()
}

fn from_millis(ms: i64) -> DateTime<Utc> {
    DateTime::from_timestamp_millis(ms).unwrap_or_else(Utc::now)
}

/// Recent checks of these tokens made by any copy of the service, with how
/// old each one is.
pub async fn load_checks(
    db: &Database,
    chain: &str,
    tokens: &[String],
) -> Vec<(String, Intel, Duration)> {
    if tokens.is_empty() {
        return vec![];
    }
    let rows: Vec<(String, String, DateTime<Utc>)> = bounded("reading token checks", async {
        let pool = db.pool().await?;
        sqlx::query_as(
            "SELECT token, report::text, checked_at FROM arctos.token_checks
             WHERE chain = $1 AND token = ANY($2) AND checked_at > now() - make_interval(secs => $3)",
        )
        .bind(chain)
        .bind(tokens)
        .bind(CHECK_FRESH_FOR.as_secs_f64())
        .persistent(false)
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())
    })
    .await
    .unwrap_or_default();
    let now = Utc::now();
    rows.into_iter()
        .filter_map(|(token, report, at)| {
            let intel: Intel = serde_json::from_str(&report).ok()?;
            let age = (now - at).to_std().unwrap_or_default();
            Some((token, intel, age))
        })
        .collect()
}

/// Shares fresh checks with every other copy of the service.
pub async fn save_checks(db: &Database, chain: &str, checks: &[(String, Intel)]) {
    if checks.is_empty() {
        return;
    }
    let tokens: Vec<&str> = checks.iter().map(|(t, _)| t.as_str()).collect();
    let developers: Vec<Option<&str>> =
        checks.iter().map(|(_, i)| i.developer.as_deref()).collect();
    let reports: Vec<String> = checks
        .iter()
        .filter_map(|(_, i)| serde_json::to_string(i).ok())
        .collect();
    if reports.len() != checks.len() {
        return;
    }
    bounded("saving token checks", async {
        let pool = db.pool().await?;
        sqlx::query(
            "INSERT INTO arctos.token_checks (chain, token, developer, report, checked_at)
             SELECT $1, t.token, t.developer, t.report::jsonb, now()
             FROM unnest($2::text[], $3::text[], $4::text[]) AS t(token, developer, report)
             ON CONFLICT (chain, token) DO UPDATE
             SET developer = EXCLUDED.developer, report = EXCLUDED.report, checked_at = EXCLUDED.checked_at",
        )
        .bind(chain)
        .bind(&tokens)
        .bind(&developers)
        .bind(&reports)
        .persistent(false)
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
    })
    .await;
}

/// Every launch on record for these developers, newest first.
pub async fn load_launches(
    db: &Database,
    chain: &str,
    developers: &[String],
) -> Vec<(String, DevLaunch)> {
    if developers.is_empty() {
        return vec![];
    }
    type Row = (
        String,
        String,
        bool,
        bool,
        f64,
        f64,
        Option<f64>,
        DateTime<Utc>,
    );
    let rows: Vec<Row> = bounded("reading developer records", async {
        let pool = db.pool().await?;
        sqlx::query_as(
            "SELECT developer, token, graduated, on_curve, liquidity_usd, market_cap_usd, buy_ratio, last_seen_at
             FROM arctos.dev_launches
             WHERE chain = $1 AND developer = ANY($2)
               AND last_seen_at > now() - make_interval(days => $3)
             ORDER BY last_seen_at DESC
             LIMIT $4",
        )
        .bind(chain)
        .bind(developers)
        .bind(KEEP_LAUNCHES_DAYS)
        .bind(MAX_LAUNCHES_READ)
        .persistent(false)
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())
    })
    .await
    .unwrap_or_default();
    rows.into_iter()
        .map(
            |(
                developer,
                token,
                graduated,
                on_curve,
                liquidity_usd,
                market_cap_usd,
                buy_ratio,
                at,
            )| {
                (
                    developer,
                    DevLaunch {
                        token,
                        graduated,
                        on_curve,
                        liquidity_usd,
                        market_cap_usd,
                        buy_ratio,
                        seen_at: millis(at),
                    },
                )
            },
        )
        .collect()
}

/// Records launches. Graduation is permanent, and an older look never
/// overwrites a newer one.
pub async fn save_launches(db: &Database, chain: &str, launches: &[(String, DevLaunch)]) {
    if launches.is_empty() {
        return;
    }
    let tokens: Vec<&str> = launches.iter().map(|(_, l)| l.token.as_str()).collect();
    let developers: Vec<&str> = launches.iter().map(|(d, _)| d.as_str()).collect();
    let graduated: Vec<bool> = launches.iter().map(|(_, l)| l.graduated).collect();
    let on_curve: Vec<bool> = launches.iter().map(|(_, l)| l.on_curve).collect();
    let liquidity: Vec<f64> = launches.iter().map(|(_, l)| l.liquidity_usd).collect();
    let market_cap: Vec<f64> = launches.iter().map(|(_, l)| l.market_cap_usd).collect();
    let ratios: Vec<Option<f64>> = launches
        .iter()
        .map(|(_, l)| l.buy_ratio.filter(|r| (0.0..=1.0).contains(r)))
        .collect();
    let seen: Vec<DateTime<Utc>> = launches
        .iter()
        .map(|(_, l)| from_millis(l.seen_at))
        .collect();
    bounded("saving developer records", async {
        let pool = db.pool().await?;
        sqlx::query(
            "INSERT INTO arctos.dev_launches AS d
                 (chain, token, developer, graduated, on_curve, liquidity_usd, market_cap_usd, buy_ratio, first_seen_at, last_seen_at)
             SELECT $1, t.token, t.developer, t.graduated, t.on_curve, t.liquidity, t.market_cap, t.ratio, t.seen, t.seen
             FROM unnest($2::text[], $3::text[], $4::bool[], $5::bool[], $6::float8[], $7::float8[], $8::float8[], $9::timestamptz[])
                  AS t(token, developer, graduated, on_curve, liquidity, market_cap, ratio, seen)
             ON CONFLICT (chain, token) DO UPDATE SET
                 developer      = EXCLUDED.developer,
                 graduated      = d.graduated OR EXCLUDED.graduated,
                 on_curve       = EXCLUDED.on_curve,
                 liquidity_usd  = EXCLUDED.liquidity_usd,
                 market_cap_usd = EXCLUDED.market_cap_usd,
                 buy_ratio      = EXCLUDED.buy_ratio,
                 last_seen_at   = EXCLUDED.last_seen_at
             WHERE EXCLUDED.last_seen_at >= d.last_seen_at",
        )
        .bind(chain)
        .bind(&tokens)
        .bind(&developers)
        .bind(&graduated)
        .bind(&on_curve)
        .bind(&liquidity)
        .bind(&market_cap)
        .bind(&ratios)
        .bind(&seen)
        .persistent(false)
        .execute(pool)
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
    })
    .await;
}

/// How many developer wallets are on record across every chain.
pub async fn developer_count(db: &Database) -> Option<i64> {
    bounded("counting developers", async {
        let pool = db.pool().await?;
        sqlx::query_scalar(
            "SELECT count(*) FROM (SELECT DISTINCT chain, developer FROM arctos.dev_launches) d",
        )
        .persistent(false)
        .fetch_one(pool)
        .await
        .map_err(|e| e.to_string())
    })
    .await
}

/// Clears out records that are no longer used, at most once an hour across
/// every copy of the service. Keeps the database small enough for a free plan.
pub async fn tidy(db: &Database, now_ms: i64) {
    const EVERY_MS: i64 = 3_600_000;
    bounded("tidying old records", async {
        let pool = db.pool().await?;
        let claimed = sqlx::query(
            "UPDATE arctos.keeper_meta SET cleaned_at = $1 WHERE id = 1 AND cleaned_at <= $1 - $2",
        )
        .bind(now_ms)
        .bind(EVERY_MS)
        .persistent(false)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?
        .rows_affected()
            == 1;
        if !claimed {
            return Ok(());
        }
        sqlx::query("DELETE FROM arctos.token_checks WHERE checked_at < now() - make_interval(days => $1)")
            .bind(KEEP_CHECKS_DAYS)
            .persistent(false)
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;
        sqlx::query("DELETE FROM arctos.dev_launches WHERE last_seen_at < now() - make_interval(days => $1)")
            .bind(KEEP_LAUNCHES_DAYS)
            .persistent(false)
            .execute(pool)
            .await
            .map(|_| ())
            .map_err(|e| e.to_string())
    })
    .await;
}
