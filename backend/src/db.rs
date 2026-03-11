use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};
use tracing::info;

pub async fn init_pool(database_url: &str) -> Result<SqlitePool, sqlx::Error> {
    let pool = SqlitePoolOptions::new()
        .max_connections(10)
        .connect(database_url)
        .await?;

    run_migrations(&pool).await?;
    info!("Database pool initialized at {}", database_url);
    Ok(pool)
}

async fn run_migrations(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS trades (
            id           TEXT PRIMARY KEY,
            wallet_address TEXT,
            token_name   TEXT NOT NULL,
            price_bought TEXT NOT NULL,
            amount       TEXT NOT NULL,
            price_sold   TEXT NOT NULL DEFAULT '0',
            profit_loss  REAL NOT NULL DEFAULT 0,
            date         TEXT NOT NULL
        );
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS sniper_tokens (
            id           TEXT PRIMARY KEY,
            symbol       TEXT NOT NULL,
            name         TEXT NOT NULL,
            address      TEXT NOT NULL,
            chain        TEXT NOT NULL,
            price        REAL NOT NULL DEFAULT 0,
            liquidity_usd  REAL NOT NULL DEFAULT 0,
            market_cap_usd REAL NOT NULL DEFAULT 0,
            holders      INTEGER NOT NULL DEFAULT 0,
            change_24h   REAL NOT NULL DEFAULT 0,
            status       TEXT NOT NULL DEFAULT 'active'
        );
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS sniper_config (
            id                      INTEGER PRIMARY KEY DEFAULT 1,
            min_liquidity_usd_k     REAL NOT NULL DEFAULT 50,
            max_buy_tax_percent     REAL NOT NULL DEFAULT 10,
            max_sell_tax_percent    REAL NOT NULL DEFAULT 10,
            gas_price_gwei          REAL NOT NULL DEFAULT 5,
            slippage_percent        REAL NOT NULL DEFAULT 12,
            max_position_usd        REAL NOT NULL DEFAULT 250,
            min_creator_win_rate    REAL NOT NULL DEFAULT 60,
            max_risk_score          REAL NOT NULL DEFAULT 40,
            auto_take_profit_percent REAL NOT NULL DEFAULT 100,
            auto_stop_loss_percent  REAL NOT NULL DEFAULT 30
        );
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS sniper_state (
            id             INTEGER PRIMARY KEY DEFAULT 1,
            active         INTEGER NOT NULL DEFAULT 0,
            wallet_address TEXT
        );
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS sniper_executions (
            id        TEXT PRIMARY KEY,
            token     TEXT NOT NULL,
            action    TEXT NOT NULL,
            amount    TEXT NOT NULL,
            value_usd REAL NOT NULL DEFAULT 0,
            time      TEXT NOT NULL,
            success   INTEGER NOT NULL DEFAULT 1
        );
        "#,
    )
    .execute(pool)
    .await?;

    Ok(())
}
