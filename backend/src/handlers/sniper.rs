use axum::{
    extract::{Query, State},
    http::StatusCode,
    Json,
};
use chrono::Utc;
use serde::Deserialize;
use std::sync::Arc;
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    types::{SnipeRequest, SniperConfig, SniperExecution, SniperStateRequest, SniperToken, SniperUpdateEvent},
    AppState,
};

#[derive(Debug, Deserialize)]
pub struct TokenSearchQuery {
    pub query: Option<String>,
    pub chain: Option<String>,
}

/// Public alias so ws_sniper.rs can call it for initial token push.
pub fn mock_tokens_pub() -> Vec<SniperToken> {
    mock_tokens()
}

fn mock_tokens() -> Vec<SniperToken> {
    vec![
        SniperToken {
            id: "tok_pepe_eth".to_string(),
            symbol: "PEPE".to_string(),
            name: "Pepe".to_string(),
            address: "0x6982508145454ce325ddbe47a25d4ec3d2311933".to_string(),
            chain: "ETH".to_string(),
            price: 0.0000087,
            liquidity_usd: 4_200_000.0,
            market_cap_usd: 3_650_000_000.0,
            holders: 218_430,
            change_24h: 12.4,
            status: "active".to_string(),
        },
        SniperToken {
            id: "tok_bonk_sol".to_string(),
            symbol: "BONK".to_string(),
            name: "Bonk".to_string(),
            address: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263".to_string(),
            chain: "SOL".to_string(),
            price: 0.0000221,
            liquidity_usd: 18_700_000.0,
            market_cap_usd: 1_340_000_000.0,
            holders: 892_100,
            change_24h: -3.7,
            status: "active".to_string(),
        },
        SniperToken {
            id: "tok_floki_bsc".to_string(),
            symbol: "FLOKI".to_string(),
            name: "Floki Inu".to_string(),
            address: "0xcf0c122c6b73ff809c693db761e7baebe62b6a2e".to_string(),
            chain: "BSC".to_string(),
            price: 0.000142,
            liquidity_usd: 9_850_000.0,
            market_cap_usd: 1_360_000_000.0,
            holders: 450_280,
            change_24h: 5.2,
            status: "active".to_string(),
        },
        SniperToken {
            id: "tok_wojak_eth".to_string(),
            symbol: "WOJAK".to_string(),
            name: "Wojak".to_string(),
            address: "0x5026f006b85729a8b14553fae6af249ad16c9aab".to_string(),
            chain: "ETH".to_string(),
            price: 0.0000034,
            liquidity_usd: 820_000.0,
            market_cap_usd: 34_000_000.0,
            holders: 28_950,
            change_24h: 38.9,
            status: "new".to_string(),
        },
        SniperToken {
            id: "tok_moodeng_sol".to_string(),
            symbol: "MOODENG".to_string(),
            name: "Moo Deng".to_string(),
            address: "ED5nyyWEzpPPiWimP8vYm7sD7TD3LAt3Q3gRTWHzc8EU".to_string(),
            chain: "SOL".to_string(),
            price: 0.000523,
            liquidity_usd: 2_150_000.0,
            market_cap_usd: 523_000_000.0,
            holders: 74_320,
            change_24h: -8.1,
            status: "active".to_string(),
        },
    ]
}

pub async fn get_tokens(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<SniperToken>>> {
    let rows: Vec<SniperToken> = sqlx::query_as(
        "SELECT id, symbol, name, address, chain, price, liquidity_usd, market_cap_usd, holders, change_24h, status FROM sniper_tokens",
    )
    .fetch_all(&state.db)
    .await?;

    if rows.is_empty() {
        Ok(Json(mock_tokens()))
    } else {
        Ok(Json(rows))
    }
}

pub async fn search_token(
    State(state): State<Arc<AppState>>,
    Query(params): Query<TokenSearchQuery>,
) -> Result<Json<Option<SniperToken>>> {
    let query_str = params.query.unwrap_or_default().to_lowercase();
    let chain_filter = params.chain.unwrap_or_default().to_lowercase();

    if query_str.is_empty() {
        return Ok(Json(None));
    }

    // Try DB first
    let db_result: Option<SniperToken> = sqlx::query_as(
        r#"SELECT id, symbol, name, address, chain, price, liquidity_usd, market_cap_usd, holders, change_24h, status
           FROM sniper_tokens
           WHERE (LOWER(symbol) = ?1 OR LOWER(address) = ?1)
             AND (LOWER(chain) = ?2 OR ?2 = '')"#,
    )
    .bind(&query_str)
    .bind(&chain_filter)
    .fetch_optional(&state.db)
    .await?;

    if db_result.is_some() {
        return Ok(Json(db_result));
    }

    // Fall back to mock data search
    let found = mock_tokens().into_iter().find(|t| {
        let sym_match = t.symbol.to_lowercase() == query_str || t.address.to_lowercase() == query_str;
        let chain_match = chain_filter.is_empty() || t.chain.to_lowercase() == chain_filter;
        sym_match && chain_match
    });

    Ok(Json(found))
}

pub async fn save_config(
    State(state): State<Arc<AppState>>,
    Json(cfg): Json<SniperConfig>,
) -> Result<StatusCode> {
    sqlx::query(
        r#"INSERT INTO sniper_config (
               id, min_liquidity_usd_k, max_buy_tax_percent, max_sell_tax_percent,
               gas_price_gwei, slippage_percent, max_position_usd,
               min_creator_win_rate, max_risk_score,
               auto_take_profit_percent, auto_stop_loss_percent
           ) VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
           ON CONFLICT(id) DO UPDATE SET
               min_liquidity_usd_k     = excluded.min_liquidity_usd_k,
               max_buy_tax_percent     = excluded.max_buy_tax_percent,
               max_sell_tax_percent    = excluded.max_sell_tax_percent,
               gas_price_gwei          = excluded.gas_price_gwei,
               slippage_percent        = excluded.slippage_percent,
               max_position_usd        = excluded.max_position_usd,
               min_creator_win_rate    = excluded.min_creator_win_rate,
               max_risk_score          = excluded.max_risk_score,
               auto_take_profit_percent = excluded.auto_take_profit_percent,
               auto_stop_loss_percent  = excluded.auto_stop_loss_percent"#,
    )
    .bind(cfg.min_liquidity_usd_k)
    .bind(cfg.max_buy_tax_percent)
    .bind(cfg.max_sell_tax_percent)
    .bind(cfg.gas_price_gwei)
    .bind(cfg.slippage_percent)
    .bind(cfg.max_position_usd)
    .bind(cfg.min_creator_win_rate)
    .bind(cfg.max_risk_score)
    .bind(cfg.auto_take_profit_percent)
    .bind(cfg.auto_stop_loss_percent)
    .execute(&state.db)
    .await?;

    Ok(StatusCode::OK)
}

pub async fn set_state(
    State(state): State<Arc<AppState>>,
    Json(body): Json<SniperStateRequest>,
) -> Result<StatusCode> {
    let active_int: i64 = if body.active { 1 } else { 0 };

    sqlx::query(
        r#"INSERT INTO sniper_state (id, active, wallet_address) VALUES (1, ?1, ?2)
           ON CONFLICT(id) DO UPDATE SET
               active         = excluded.active,
               wallet_address = excluded.wallet_address"#,
    )
    .bind(active_int)
    .bind(body.wallet_address)
    .execute(&state.db)
    .await?;

    Ok(StatusCode::OK)
}

pub async fn execute_snipe(
    State(state): State<Arc<AppState>>,
    Json(body): Json<SnipeRequest>,
) -> Result<Json<SniperExecution>> {
    // Validate required fields
    if body.token_address.is_empty() {
        return Err(AppError::BadRequest("token_address is required".to_string()));
    }
    if body.chain.is_empty() {
        return Err(AppError::BadRequest("chain is required".to_string()));
    }

    // Look up the token to get its details
    let token: Option<SniperToken> = sqlx::query_as(
        r#"SELECT id, symbol, name, address, chain, price, liquidity_usd, market_cap_usd, holders, change_24h, status
           FROM sniper_tokens WHERE id = ?1 OR address = ?2"#,
    )
    .bind(&body.token_id)
    .bind(&body.token_address)
    .fetch_optional(&state.db)
    .await?;

    let resolved_token = match token {
        Some(t) => t,
        None => {
            // Check mocks as fallback
            mock_tokens()
                .into_iter()
                .find(|t| t.id == body.token_id || t.address == body.token_address)
                .ok_or_else(|| AppError::NotFound(format!(
                    "Token {} not found", body.token_id
                )))?
        }
    };

    // Load sniper config for validation
    let config_row: Option<SniperConfig> = sqlx::query_as(
        r#"SELECT min_liquidity_usd_k, max_buy_tax_percent, max_sell_tax_percent,
                  gas_price_gwei, slippage_percent, max_position_usd,
                  min_creator_win_rate, max_risk_score,
                  auto_take_profit_percent, auto_stop_loss_percent
           FROM sniper_config WHERE id = 1"#,
    )
    .fetch_optional(&state.db)
    .await?;

    // Apply safety filters from config
    if let Some(ref cfg) = config_row {
        let min_liquidity = cfg.min_liquidity_usd_k * 1_000.0;
        if resolved_token.liquidity_usd < min_liquidity {
            return Err(AppError::BadRequest(format!(
                "Token liquidity ${:.0} is below minimum ${:.0}",
                resolved_token.liquidity_usd, min_liquidity
            )));
        }
    }

    let position_usd = config_row
        .as_ref()
        .map(|c| c.max_position_usd)
        .unwrap_or(250.0);

    let exec = SniperExecution {
        token: resolved_token.symbol.clone(),
        action: "Buy".to_string(),
        amount: format!("{:.2} USD", position_usd),
        value_usd: position_usd,
        time: Utc::now().to_rfc3339(),
        success: true,
    };

    // Persist execution
    let exec_id = Uuid::new_v4().to_string();
    sqlx::query(
        r#"INSERT INTO sniper_executions (id, token, action, amount, value_usd, time, success)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"#,
    )
    .bind(&exec_id)
    .bind(&exec.token)
    .bind(&exec.action)
    .bind(&exec.amount)
    .bind(exec.value_usd)
    .bind(&exec.time)
    .bind(1_i64)
    .execute(&state.db)
    .await?;

    // Broadcast the execution event via WebSocket
    let event = SniperUpdateEvent {
        r#type: "execution".to_string(),
        token: None,
        execution: Some(exec.clone()),
    };
    let _ = state.sniper_tx.send(event);

    Ok(Json(exec))
}
