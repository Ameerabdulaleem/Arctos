//! Live equity quotes (Yahoo Finance chart endpoint, delayed by the exchange rules).

use std::sync::Arc;

use axum::{
    extract::{Query, State},
    Json,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{
    error::{AppError, Result},
    upstream::UpstreamError,
    AppState,
};

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Quote {
    pub symbol: String,
    pub name: String,
    pub price: f64,
    pub previous_close: f64,
    pub change: f64,
    pub change_pct: f64,
    pub currency: String,
    pub exchange: String,
    /// Unix seconds of the last trade
    pub updated_at: i64,
    pub sparkline: Vec<f64>,
}

pub fn valid_symbol(s: &str) -> bool {
    (1..=10).contains(&s.len())
        && s.bytes()
            .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'.' || b == b'-')
}

pub fn parse_chart(raw: &str, symbol: &str) -> Option<Quote> {
    let v: Value = serde_json::from_str(raw).ok()?;
    let result = v.get("chart")?.get("result")?.get(0)?;
    let meta = result.get("meta")?;
    let price = meta.get("regularMarketPrice")?.as_f64()?;
    let previous = meta
        .get("chartPreviousClose")
        .and_then(|p| p.as_f64())
        .or_else(|| meta.get("previousClose").and_then(|p| p.as_f64()))?;
    if previous <= 0.0 {
        return None;
    }
    let sparkline: Vec<f64> = result
        .get("indicators")
        .and_then(|i| i.get("quote"))
        .and_then(|q| q.get(0))
        .and_then(|q| q.get("close"))
        .and_then(|c| c.as_array())
        .map(|a| a.iter().filter_map(|x| x.as_f64()).collect())
        .unwrap_or_default();
    let name = meta
        .get("longName")
        .or_else(|| meta.get("shortName"))
        .and_then(|n| n.as_str())
        .unwrap_or(symbol)
        .chars()
        .take(60)
        .collect();
    Some(Quote {
        symbol: symbol.to_string(),
        name,
        price,
        previous_close: previous,
        change: price - previous,
        change_pct: (price - previous) / previous * 100.0,
        currency: meta
            .get("currency")
            .and_then(|c| c.as_str())
            .unwrap_or("USD")
            .to_string(),
        exchange: meta
            .get("exchangeName")
            .and_then(|c| c.as_str())
            .unwrap_or_default()
            .to_string(),
        updated_at: meta
            .get("regularMarketTime")
            .and_then(|t| t.as_i64())
            .unwrap_or(0),
        sparkline,
    })
}

async fn fetch_quote(state: &AppState, symbol: &str) -> std::result::Result<Quote, UpstreamError> {
    let url = format!("{}/v8/finance/chart/{}", state.config.yahoo_base, symbol);
    let query = [("range", "1d".to_string()), ("interval", "5m".to_string())];
    let v: Value = state
        .up
        .get_json_with("yahoo-finance", &url, &query, &[])
        .await?;
    parse_chart(&v.to_string(), symbol)
        .ok_or_else(|| UpstreamError::Parse(format!("no quote for {symbol}")))
}

#[derive(Deserialize)]
pub struct StocksQuery {
    symbols: Option<String>,
}

#[derive(Serialize)]
pub struct StocksResponse {
    quotes: Vec<Quote>,
    failed: Vec<String>,
}

pub async fn get_quotes(
    State(state): State<Arc<AppState>>,
    Query(q): Query<StocksQuery>,
) -> Result<Json<StocksResponse>> {
    let symbols: Vec<String> = match q.symbols.as_deref() {
        Some(s) if !s.trim().is_empty() => s
            .split(',')
            .map(|x| x.trim().to_ascii_uppercase())
            .filter(|x| !x.is_empty())
            .take(20)
            .collect(),
        _ => state.config.stock_watchlist.clone(),
    };
    if symbols.iter().any(|s| !valid_symbol(s)) {
        return Err(AppError::BadRequest("invalid ticker symbol".into()));
    }
    let tasks = symbols.iter().map(|sym| {
        let st = state.clone();
        let sym = sym.clone();
        async move {
            let st2 = st.clone();
            let s2 = sym.clone();
            let r = st
                .stock_cache
                .get_or_fetch(&sym, || async move { fetch_quote(&st2, &s2).await })
                .await;
            (sym, r)
        }
    });
    let mut quotes = Vec::new();
    let mut failed = Vec::new();
    for (sym, r) in futures_util::future::join_all(tasks).await {
        match r {
            Ok(quote) => quotes.push(quote),
            Err(e) => {
                tracing::warn!("quote {sym} failed: {e}");
                failed.push(sym);
            }
        }
    }
    if quotes.is_empty() {
        return Err(AppError::Upstream("no quotes could be loaded".into()));
    }
    Ok(Json(StocksResponse { quotes, failed }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_yahoo_chart() {
        let raw = r#"{"chart":{"result":[{"meta":{"currency":"USD","symbol":"COIN","exchangeName":"NMS","longName":"Coinbase Global, Inc.",
            "regularMarketPrice":275.5,"chartPreviousClose":250.0,"regularMarketTime":1767300000},
            "indicators":{"quote":[{"close":[270.0,null,272.5,275.5]}]}}],"error":null}}"#;
        let q = parse_chart(raw, "COIN").unwrap();
        assert_eq!(q.name, "Coinbase Global, Inc.");
        assert!((q.change_pct - 10.2).abs() < 1e-9);
        assert_eq!(
            q.sparkline,
            vec![270.0, 272.5, 275.5],
            "null gaps are dropped"
        );
        assert_eq!(q.exchange, "NMS");
    }

    #[test]
    fn rejects_bad_payloads_and_symbols() {
        assert!(parse_chart(
            r#"{"chart":{"result":null,"error":{"code":"Not Found"}}}"#,
            "X"
        )
        .is_none());
        assert!(parse_chart(r#"{"chart":{"result":[{"meta":{"regularMarketPrice":1.0,"chartPreviousClose":0.0}}]}}"#, "X").is_none());
        assert!(valid_symbol("BRK-B"));
        assert!(valid_symbol("BF.B"));
        assert!(!valid_symbol("../etc"));
        assert!(!valid_symbol("AAPL?x=1"));
        assert!(!valid_symbol(""));
    }
}
