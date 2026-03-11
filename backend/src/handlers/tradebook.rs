use axum::{
    extract::State,
    http::StatusCode,
    Json,
};
use std::sync::Arc;

use crate::{
    error::Result,
    types::{SaveTradesRequest, Trade},
    AppState,
};

pub async fn get_trades(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<Trade>>> {
    let trades: Vec<Trade> = sqlx::query_as(
        r#"SELECT id, wallet_address, token_name, price_bought, amount, price_sold, profit_loss, date
           FROM trades
           ORDER BY date DESC"#,
    )
    .fetch_all(&state.db)
    .await?;

    Ok(Json(trades))
}

pub async fn save_trades(
    State(state): State<Arc<AppState>>,
    Json(body): Json<SaveTradesRequest>,
) -> Result<StatusCode> {
    for trade in body.trades {
        let wallet = trade.wallet_address.or_else(|| body.wallet_address.clone());

        sqlx::query(
            r#"INSERT INTO trades (id, wallet_address, token_name, price_bought, amount, price_sold, profit_loss, date)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
               ON CONFLICT(id) DO UPDATE SET
                   wallet_address = excluded.wallet_address,
                   token_name     = excluded.token_name,
                   price_bought   = excluded.price_bought,
                   amount         = excluded.amount,
                   price_sold     = excluded.price_sold,
                   profit_loss    = excluded.profit_loss,
                   date           = excluded.date"#,
        )
        .bind(&trade.id)
        .bind(&wallet)
        .bind(&trade.token_name)
        .bind(&trade.price_bought)
        .bind(&trade.amount)
        .bind(&trade.price_sold)
        .bind(trade.profit_loss)
        .bind(&trade.date)
        .execute(&state.db)
        .await?;
    }

    Ok(StatusCode::OK)
}
