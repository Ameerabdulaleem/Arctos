use axum::{extract::State, Json};
use std::sync::Arc;

use crate::{error::Result, types::DashboardSnapshot, AppState};

pub async fn get_dashboard_overview(
    State(state): State<Arc<AppState>>,
) -> Result<Json<DashboardSnapshot>> {
    let snapshot = state.latest_snapshot.read().await.clone();
    Ok(Json(snapshot))
}
