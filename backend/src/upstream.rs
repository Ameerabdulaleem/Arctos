//! Shared outbound HTTP client with per source health tracking, plus a small
//! single flight cache used by on demand endpoints.

use std::{
    collections::HashMap,
    future::Future,
    sync::{Arc, Mutex, RwLock},
    time::{Duration, Instant},
};

use chrono::{DateTime, Utc};
use serde::{de::DeserializeOwned, Serialize};

use crate::error::AppError;

const MAX_BODY_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Debug, Clone, thiserror::Error)]
pub enum UpstreamError {
    #[error("network error: {0}")]
    Network(String),
    #[error("http {status}: {snippet}")]
    Http { status: u16, snippet: String },
    #[error("could not parse response: {0}")]
    Parse(String),
    #[error("response too large")]
    TooLarge,
}

impl From<UpstreamError> for AppError {
    fn from(e: UpstreamError) -> Self {
        AppError::Upstream(e.to_string())
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceHealth {
    pub name: String,
    pub ok: bool,
    pub last_success: Option<DateTime<Utc>>,
    pub last_attempt: Option<DateTime<Utc>>,
    pub last_error: Option<String>,
    pub latency_ms: Option<u64>,
    pub failures: u32,
}

#[derive(Clone)]
pub struct Upstream {
    client: reqwest::Client,
    health: Arc<RwLock<HashMap<String, SourceHealth>>>,
}

impl Upstream {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(12))
            .connect_timeout(Duration::from_secs(6))
            .user_agent("ArctosDataService/0.2 (+https://github.com/ameerabdulaleem/arctos)")
            .gzip(true)
            .build()
            .expect("failed to build HTTP client");
        Self {
            client,
            health: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub fn client(&self) -> &reqwest::Client {
        &self.client
    }

    fn record(&self, source: &str, latency: Duration, outcome: Result<(), &UpstreamError>) {
        let mut map = self.health.write().unwrap_or_else(|e| e.into_inner());
        let entry = map
            .entry(source.to_string())
            .or_insert_with(|| SourceHealth {
                name: source.to_string(),
                ok: false,
                last_success: None,
                last_attempt: None,
                last_error: None,
                latency_ms: None,
                failures: 0,
            });
        entry.last_attempt = Some(Utc::now());
        entry.latency_ms = Some(latency.as_millis() as u64);
        match outcome {
            Ok(()) => {
                entry.ok = true;
                entry.last_success = Some(Utc::now());
                entry.last_error = None;
                entry.failures = 0;
            }
            Err(e) => {
                entry.ok = false;
                entry.failures = entry.failures.saturating_add(1);
                let mut msg = e.to_string();
                msg.truncate(240);
                entry.last_error = Some(msg);
            }
        }
    }

    /// Mark a source as failed/succeeded from code paths that do not go through `get_json`
    /// (for example the websocket ticker stream).
    pub fn note(&self, source: &str, outcome: Result<(), String>) {
        match outcome {
            Ok(()) => self.record(source, Duration::from_millis(0), Ok(())),
            Err(m) => self.record(
                source,
                Duration::from_millis(0),
                Err(&UpstreamError::Network(m)),
            ),
        }
    }

    pub fn snapshot(&self) -> Vec<SourceHealth> {
        let map = self.health.read().unwrap_or_else(|e| e.into_inner());
        let mut v: Vec<SourceHealth> = map.values().cloned().collect();
        v.sort_by(|a, b| a.name.cmp(&b.name));
        v
    }

    async fn send(
        &self,
        source: &str,
        req: reqwest::RequestBuilder,
    ) -> Result<bytes_like::Body, UpstreamError> {
        let started = Instant::now();
        let result = async {
            let resp = req
                .send()
                .await
                .map_err(|e| UpstreamError::Network(strip_url(&e)))?;
            let status = resp.status();
            if let Some(len) = resp.content_length() {
                if len > MAX_BODY_BYTES {
                    return Err(UpstreamError::TooLarge);
                }
            }
            let bytes = resp
                .bytes()
                .await
                .map_err(|e| UpstreamError::Network(strip_url(&e)))?;
            if bytes.len() as u64 > MAX_BODY_BYTES {
                return Err(UpstreamError::TooLarge);
            }
            if !status.is_success() {
                let snippet: String = String::from_utf8_lossy(&bytes).chars().take(160).collect();
                return Err(UpstreamError::Http {
                    status: status.as_u16(),
                    snippet,
                });
            }
            Ok(bytes_like::Body(bytes.to_vec()))
        }
        .await;
        match &result {
            Ok(_) => self.record(source, started.elapsed(), Ok(())),
            Err(e) => self.record(source, started.elapsed(), Err(e)),
        }
        result
    }

    pub async fn get_json<T: DeserializeOwned>(
        &self,
        source: &str,
        url: &str,
    ) -> Result<T, UpstreamError> {
        self.get_json_with(source, url, &[], &[]).await
    }

    pub async fn get_json_with<T: DeserializeOwned>(
        &self,
        source: &str,
        url: &str,
        query: &[(&str, String)],
        headers: &[(&str, &str)],
    ) -> Result<T, UpstreamError> {
        let mut req = self.client.get(url);
        if !query.is_empty() {
            req = req.query(query);
        }
        for (k, v) in headers {
            req = req.header(*k, *v);
        }
        let body = self.send(source, req).await?;
        serde_json::from_slice(&body.0).map_err(|e| UpstreamError::Parse(e.to_string()))
    }

    pub async fn get_text(&self, source: &str, url: &str) -> Result<String, UpstreamError> {
        let body = self.send(source, self.client.get(url)).await?;
        Ok(String::from_utf8_lossy(&body.0).into_owned())
    }

    pub async fn post_json<T: DeserializeOwned>(
        &self,
        source: &str,
        url: &str,
        body: &serde_json::Value,
        headers: &[(&str, &str)],
        timeout: Option<Duration>,
    ) -> Result<T, UpstreamError> {
        let mut req = self.client.post(url).json(body);
        if let Some(t) = timeout {
            req = req.timeout(t);
        }
        for (k, v) in headers {
            req = req.header(*k, *v);
        }
        let out = self.send(source, req).await?;
        serde_json::from_slice(&out.0).map_err(|e| UpstreamError::Parse(e.to_string()))
    }
}

impl Default for Upstream {
    fn default() -> Self {
        Self::new()
    }
}

/// reqwest errors embed the full URL, which can contain API keys in query strings.
fn strip_url(e: &reqwest::Error) -> String {
    let mut msg = e.to_string();
    if let Some(url) = e.url() {
        msg = msg.replace(url.as_str(), "<url>");
    }
    msg.truncate(200);
    msg
}

mod bytes_like {
    pub struct Body(pub Vec<u8>);
}

// ── Single flight keyed cache ────────────────────────────────────────────────

type Slot<V> = Arc<tokio::sync::Mutex<Option<(Instant, V)>>>;

/// Per key TTL cache. Concurrent callers for the same key share one upstream
/// request, and a stale value is served if the refresh fails.
pub struct KeyedCache<V: Clone> {
    ttl: Duration,
    stale_for: Duration,
    slots: Mutex<HashMap<String, Slot<V>>>,
}

impl<V: Clone> KeyedCache<V> {
    pub fn new(ttl: Duration, stale_for: Duration) -> Self {
        Self {
            ttl,
            stale_for,
            slots: Mutex::new(HashMap::new()),
        }
    }

    pub async fn get_or_fetch<F, Fut, E>(&self, key: &str, fetch: F) -> Result<V, E>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<V, E>>,
    {
        let slot = {
            let mut map = self.slots.lock().unwrap_or_else(|e| e.into_inner());
            if map.len() > 4000 {
                map.clear();
            }
            map.entry(key.to_string()).or_default().clone()
        };
        let mut guard = slot.lock().await;
        if let Some((stamp, value)) = guard.as_ref() {
            if stamp.elapsed() < self.ttl {
                return Ok(value.clone());
            }
        }
        match fetch().await {
            Ok(value) => {
                *guard = Some((Instant::now(), value.clone()));
                Ok(value)
            }
            Err(err) => match guard.as_ref() {
                Some((stamp, value)) if stamp.elapsed() < self.stale_for => Ok(value.clone()),
                _ => Err(err),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[tokio::test]
    async fn cache_shares_one_fetch_and_serves_stale_on_error() {
        let cache: KeyedCache<u32> =
            KeyedCache::new(Duration::from_millis(30), Duration::from_secs(5));
        let calls = Arc::new(AtomicUsize::new(0));

        let c = calls.clone();
        let v = cache
            .get_or_fetch::<_, _, String>("k", || async move {
                c.fetch_add(1, Ordering::SeqCst);
                Ok(7)
            })
            .await
            .unwrap();
        assert_eq!(v, 7);

        // Fresh: no second fetch.
        let c = calls.clone();
        let v = cache
            .get_or_fetch::<_, _, String>("k", || async move {
                c.fetch_add(1, Ordering::SeqCst);
                Ok(8)
            })
            .await
            .unwrap();
        assert_eq!(v, 7);
        assert_eq!(calls.load(Ordering::SeqCst), 1);

        // Expired and the refresh fails: stale value wins.
        tokio::time::sleep(Duration::from_millis(40)).await;
        let v = cache
            .get_or_fetch::<_, _, String>("k", || async { Err("boom".to_string()) })
            .await
            .unwrap();
        assert_eq!(v, 7);

        // A key that never succeeded surfaces the error.
        let err = cache
            .get_or_fetch::<_, _, String>("other", || async { Err("boom".to_string()) })
            .await;
        assert!(err.is_err());
    }

    #[test]
    fn health_tracks_failures() {
        let up = Upstream::new();
        up.note("x", Err("down".into()));
        up.note("x", Err("down".into()));
        let s = up.snapshot();
        assert_eq!(s[0].failures, 2);
        assert!(!s[0].ok);
        up.note("x", Ok(()));
        let s = up.snapshot();
        assert!(s[0].ok);
        assert_eq!(s[0].failures, 0);
    }
}
