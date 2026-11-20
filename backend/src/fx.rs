//! Exchange rates for showing amounts in the visitor's own currency. Every amount the
//! service returns stays in US dollars; the web app only multiplies by these rates for
//! display. Rates come from free public sources and are cached for an hour.

use std::{collections::BTreeMap, sync::Arc};

use axum::{extract::State, Json};
use serde::Serialize;
use serde_json::Value;

use crate::{error::Result, upstream::UpstreamError, AppState};

/// The currencies offered in the picker. US dollar first, then the most asked for.
pub const SUPPORTED: &[&str] = &[
    "USD", "NGN", "EUR", "GBP", "CAD", "AUD", "NZD", "CHF", "JPY", "CNY", "HKD", "SGD", "KRW",
    "INR", "PKR", "BDT", "IDR", "MYR", "PHP", "THB", "VND", "TRY", "AED", "SAR", "QAR", "KWD",
    "ILS", "EGP", "MAD", "GHS", "KES", "UGX", "TZS", "RWF", "ETB", "ZAR", "ZMW", "XOF", "XAF",
    "BRL", "MXN", "ARS", "COP", "CLP", "PEN", "SEK", "NOK", "DKK", "PLN", "CZK", "HUF", "RON",
    "UAH", "RUB",
];

/// A source has to cover at least this many of the supported currencies to be trusted.
const MIN_COVERAGE: usize = 20;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FxResponse {
    pub base: &'static str,
    /// Units of each currency per one US dollar.
    pub rates: BTreeMap<String, f64>,
    pub source: &'static str,
    /// The day the source published these rates, when it says.
    pub date: Option<String>,
}

fn collect(get: impl Fn(&str) -> Option<f64>) -> Option<BTreeMap<String, f64>> {
    let mut out = BTreeMap::new();
    out.insert("USD".to_string(), 1.0);
    for code in SUPPORTED.iter().filter(|c| **c != "USD") {
        if let Some(rate) = get(code).filter(|r| r.is_finite() && *r > 0.0 && *r < 1e7) {
            out.insert((*code).to_string(), rate);
        }
    }
    (out.len() >= MIN_COVERAGE).then_some(out)
}

/// `{"date":"2026-11-20","usd":{"ngn":1349.97,...}}` from the free currency API.
pub fn parse_currency_api(v: &Value) -> Option<(BTreeMap<String, f64>, Option<String>)> {
    let usd = v.get("usd")?.as_object()?;
    if usd.get("usd").and_then(Value::as_f64) != Some(1.0) {
        return None;
    }
    let rates = collect(|code| usd.get(&code.to_ascii_lowercase()).and_then(Value::as_f64))?;
    let date = v
        .get("date")
        .and_then(Value::as_str)
        .map(|d| d.chars().take(10).collect());
    Some((rates, date))
}

/// `{"result":"success","base_code":"USD","rates":{"NGN":1349.97,...}}` from ExchangeRate-API.
pub fn parse_er_api(v: &Value) -> Option<(BTreeMap<String, f64>, Option<String>)> {
    if v.get("result").and_then(Value::as_str) != Some("success")
        || v.get("base_code").and_then(Value::as_str) != Some("USD")
    {
        return None;
    }
    let all = v.get("rates")?.as_object()?;
    let rates = collect(|code| all.get(code).and_then(Value::as_f64))?;
    let date = v
        .get("time_last_update_unix")
        .and_then(Value::as_i64)
        .and_then(|t| chrono::DateTime::from_timestamp(t, 0))
        .map(|d| d.format("%Y-%m-%d").to_string());
    Some((rates, date))
}

async fn fetch_rates(state: &AppState) -> std::result::Result<FxResponse, UpstreamError> {
    let mut last = UpstreamError::Parse("no exchange rate source answered".into());
    for url in &state.config.fx_sources {
        match state.up.get_json::<Value>("exchange-rates", url).await {
            Ok(v) => {
                if let Some((rates, date)) = parse_currency_api(&v) {
                    return Ok(FxResponse {
                        base: "USD",
                        rates,
                        source: "currency-api",
                        date,
                    });
                }
                if let Some((rates, date)) = parse_er_api(&v) {
                    return Ok(FxResponse {
                        base: "USD",
                        rates,
                        source: "exchangerate-api",
                        date,
                    });
                }
                last = UpstreamError::Parse("exchange rates in an unexpected shape".into());
            }
            Err(e) => {
                tracing::warn!("exchange rates from {url} failed: {e}");
                last = e;
            }
        }
    }
    Err(last)
}

pub async fn get_rates(State(state): State<Arc<AppState>>) -> Result<Json<FxResponse>> {
    let st = state.clone();
    let rates = state
        .fx_cache
        .get_or_fetch("usd", || async move { fetch_rates(&st).await })
        .await?;
    Ok(Json(rates))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sample(lower: bool) -> Value {
        let mut m = serde_json::Map::new();
        for (i, code) in SUPPORTED.iter().enumerate() {
            let key = if lower {
                code.to_ascii_lowercase()
            } else {
                code.to_string()
            };
            m.insert(
                key,
                json!(if *code == "USD" { 1.0 } else { 1.0 + i as f64 }),
            );
        }
        Value::Object(m)
    }

    #[test]
    fn reads_the_currency_api() {
        let mut usd = sample(true);
        usd["ngn"] = json!(1349.97);
        usd["btc"] = json!(0.0000162);
        let (rates, date) = parse_currency_api(&json!({"date": "2026-11-20", "usd": usd})).unwrap();
        assert_eq!(rates["NGN"], 1349.97);
        assert_eq!(rates["USD"], 1.0);
        assert!(
            !rates.contains_key("BTC"),
            "only fiat from the supported list"
        );
        assert_eq!(date.as_deref(), Some("2026-11-20"));
    }

    #[test]
    fn reads_exchangerate_api() {
        let v = json!({"result": "success", "base_code": "USD", "time_last_update_unix": 1_795_046_400, "rates": sample(false)});
        let (rates, date) = parse_er_api(&v).unwrap();
        assert_eq!(rates.len(), SUPPORTED.len());
        assert!(date.is_some());
        assert!(parse_er_api(&json!({"result": "error"})).is_none());
        assert!(parse_er_api(
            &json!({"result": "success", "base_code": "EUR", "rates": sample(false)})
        )
        .is_none());
    }

    #[test]
    fn refuses_thin_or_broken_answers() {
        let mut usd = sample(true);
        usd["ngn"] = json!(-5.0);
        usd["eur"] = json!("0.9");
        let (rates, _) = parse_currency_api(&json!({"usd": usd})).unwrap();
        assert!(!rates.contains_key("NGN") && !rates.contains_key("EUR"));
        assert!(parse_currency_api(&json!({"usd": {"usd": 1.0, "ngn": 1300.0}})).is_none());
        // A base that is not the dollar is never mistaken for one.
        let mut wrong = sample(true);
        wrong["usd"] = json!(1.08);
        assert!(parse_currency_api(&json!({"usd": wrong})).is_none());
    }
}
