use std::collections::HashMap;
use serde::{Deserialize, Serialize};

// ── Dashboard ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardSnapshot {
    pub metrics: DashboardMetrics,
    pub recent_activities: Vec<RecentActivity>,
    pub assets: DashboardAssets,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardMetrics {
    pub portfolio_value: f64,
    pub portfolio_change_percent: f64,
    pub portfolio_change_value: f64,
    pub altseason_index: u32,
    pub altseason_trend: Vec<u32>,
    pub btc_dominance: f64,
    pub eth_dominance: f64,
    pub dominance_map: HashMap<String, f64>,
    pub total_market_cap: f64,
    pub market_cap_change_percent: f64,
    pub market_cap_trend: Vec<f64>,
    pub fear_greed_index: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentActivity {
    pub action: String,
    pub amount: String,
    pub value: String,
    pub time: String,
    pub chain: String,
    pub chain_color: String,
    pub r#type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardAssets {
    pub tokens: Vec<AssetItem>,
    pub defi: Vec<AssetItem>,
    pub nfts: Vec<AssetItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetItem {
    pub name: String,
    pub symbol: String,
    pub chain: String,
    pub amount: String,
    pub value: String,
    pub change24h: f64,
}

// ── Sniper ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SniperToken {
    pub id: String,
    pub symbol: String,
    pub name: String,
    pub address: String,
    pub chain: String,
    pub price: f64,
    pub liquidity_usd: f64,
    pub market_cap_usd: f64,
    pub holders: i64,
    pub change_24h: f64,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct SniperConfig {
    pub min_liquidity_usd_k: f64,
    pub max_buy_tax_percent: f64,
    pub max_sell_tax_percent: f64,
    pub gas_price_gwei: f64,
    pub slippage_percent: f64,
    pub max_position_usd: f64,
    pub min_creator_win_rate: f64,
    pub max_risk_score: f64,
    pub auto_take_profit_percent: f64,
    pub auto_stop_loss_percent: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SniperStateRequest {
    pub active: bool,
    pub wallet_address: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnipeRequest {
    pub token_id: String,
    pub token_address: String,
    pub chain: String,
    pub wallet_address: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SniperExecution {
    pub token: String,
    pub action: String,
    pub amount: String,
    pub value_usd: f64,
    pub time: String,
    pub success: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SniperUpdateEvent {
    pub r#type: String,
    pub token: Option<SniperToken>,
    pub execution: Option<SniperExecution>,
}

// ── News ──────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewsArticle {
    pub id: String,
    pub title: String,
    pub excerpt: String,
    pub source: NewsSource,
    pub category: String,
    pub impact: String,
    pub published_at: String,
    pub image_url: Option<String>,
    pub url: String,
    pub trending: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewsSource {
    pub name: String,
    pub url: String,
}

// ── Tradebook ─────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Trade {
    pub id: String,
    pub wallet_address: Option<String>,
    pub token_name: String,
    pub price_bought: String,
    pub amount: String,
    pub price_sold: String,
    pub profit_loss: f64,
    pub date: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaveTradesRequest {
    pub trades: Vec<Trade>,
    pub wallet_address: Option<String>,
}

// ── Email ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmailRequest {
    pub to: String,
    pub subject: String,
    pub html: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmailResponse {
    pub success: bool,
    pub message: String,
}
