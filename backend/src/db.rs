use sqlx::{postgres::PgPoolOptions, PgPool};
use tracing::info;

pub async fn init_pool(database_url: &str) -> Result<PgPool, sqlx::Error> {
    let pool = PgPoolOptions::new()
        .max_connections(10)
        .connect(database_url)
        .await?;

    run_migrations(&pool).await?;
    info!("PostgreSQL database pool initialized successfully");
    Ok(pool)
}

async fn run_migrations(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS trades (
            id           TEXT PRIMARY KEY,
            wallet_address TEXT,
            token_name   TEXT NOT NULL,
            price_bought TEXT NOT NULL,
            amount       TEXT NOT NULL,
            price_sold   TEXT NOT NULL DEFAULT '0',
            profit_loss  DOUBLE PRECISION NOT NULL DEFAULT 0,
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
            price        DOUBLE PRECISION NOT NULL DEFAULT 0,
            liquidity_usd  DOUBLE PRECISION NOT NULL DEFAULT 0,
            market_cap_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
            holders      INTEGER NOT NULL DEFAULT 0,
            change_24h   DOUBLE PRECISION NOT NULL DEFAULT 0,
            status       TEXT NOT NULL DEFAULT 'active'
        );
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS sniper_config (
            id                      SERIAL PRIMARY KEY,
            min_liquidity_usd_k     DOUBLE PRECISION NOT NULL DEFAULT 50,
            max_buy_tax_percent     DOUBLE PRECISION NOT NULL DEFAULT 10,
            max_sell_tax_percent    DOUBLE PRECISION NOT NULL DEFAULT 10,
            gas_price_gwei          DOUBLE PRECISION NOT NULL DEFAULT 5,
            slippage_percent        DOUBLE PRECISION NOT NULL DEFAULT 12,
            max_position_usd        DOUBLE PRECISION NOT NULL DEFAULT 250,
            min_creator_win_rate    DOUBLE PRECISION NOT NULL DEFAULT 60,
            max_risk_score          DOUBLE PRECISION NOT NULL DEFAULT 40,
            auto_take_profit_percent DOUBLE PRECISION NOT NULL DEFAULT 100,
            auto_stop_loss_percent  DOUBLE PRECISION NOT NULL DEFAULT 30
        );
        "#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS sniper_state (
            id             SERIAL PRIMARY KEY,
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
            value_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
            time      TEXT NOT NULL,
            success   INTEGER NOT NULL DEFAULT 1
        );
        "#,
    )
    .execute(pool)
    .await?;

    Ok(())
}