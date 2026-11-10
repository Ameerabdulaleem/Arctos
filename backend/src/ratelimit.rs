//! Fixed window per client rate limiting with a few named buckets.

use std::{
    collections::HashMap,
    net::{IpAddr, SocketAddr},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use axum::{
    extract::{ConnectInfo, Request, State},
    http::{HeaderMap, Method},
    middleware::Next,
    response::{IntoResponse, Response},
};

use crate::{error::AppError, AppState};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Bucket {
    General,
    Ai,
    Waitlist,
    Portfolio,
}

impl Bucket {
    fn limit(self) -> (u32, Duration) {
        match self {
            Bucket::General => (600, Duration::from_secs(60)),
            Bucket::Ai => (12, Duration::from_secs(60)),
            Bucket::Waitlist => (6, Duration::from_secs(600)),
            Bucket::Portfolio => (30, Duration::from_secs(60)),
        }
    }
}

struct Window {
    started: Instant,
    count: u32,
}

#[derive(Clone, Default)]
pub struct RateLimiter {
    inner: Arc<Mutex<HashMap<(IpAddr, Bucket), Window>>>,
}

impl RateLimiter {
    pub fn new() -> Self {
        Self::default()
    }

    /// Returns true when the request is allowed.
    pub fn check(&self, ip: IpAddr, bucket: Bucket) -> bool {
        let (max, period) = bucket.limit();
        let mut map = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let now = Instant::now();
        let w = map.entry((ip, bucket)).or_insert(Window {
            started: now,
            count: 0,
        });
        if now.duration_since(w.started) >= period {
            w.started = now;
            w.count = 0;
        }
        if w.count >= max {
            return false;
        }
        w.count += 1;
        true
    }

    pub fn sweep(&self) {
        let mut map = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let now = Instant::now();
        map.retain(|(_, bucket), w| now.duration_since(w.started) < bucket.limit().1 * 2);
    }
}

pub fn client_ip(headers: &HeaderMap, peer: SocketAddr, trust_proxy: bool) -> IpAddr {
    if trust_proxy {
        let forwarded = headers
            .get("fly-client-ip")
            .or_else(|| headers.get("x-forwarded-for"))
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.split(',').next())
            .and_then(|v| v.trim().parse::<IpAddr>().ok());
        if let Some(ip) = forwarded {
            return ip;
        }
    }
    peer.ip()
}

fn bucket_for(method: &Method, path: &str) -> Bucket {
    if path.starts_with("/api/ai") && method == Method::POST {
        Bucket::Ai
    } else if path.starts_with("/api/waitlist") && method == Method::POST {
        Bucket::Waitlist
    } else if path.starts_with("/api/portfolio") {
        Bucket::Portfolio
    } else {
        Bucket::General
    }
}

pub async fn middleware(
    State(state): State<Arc<AppState>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    req: Request,
    next: Next,
) -> Response {
    let ip = client_ip(req.headers(), peer, state.config.trust_proxy);
    let bucket = bucket_for(req.method(), req.uri().path());
    if !state.limiter.check(ip, bucket) {
        return AppError::TooManyRequests.into_response();
    }
    next.run(req).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_after_limit_and_isolates_clients() {
        let rl = RateLimiter::new();
        let a: IpAddr = "10.0.0.1".parse().unwrap();
        let b: IpAddr = "10.0.0.2".parse().unwrap();
        for _ in 0..12 {
            assert!(rl.check(a, Bucket::Ai));
        }
        assert!(!rl.check(a, Bucket::Ai));
        assert!(rl.check(b, Bucket::Ai), "other clients are unaffected");
        assert!(rl.check(a, Bucket::General), "buckets are independent");
    }

    #[test]
    fn proxy_header_only_trusted_when_enabled() {
        let mut h = HeaderMap::new();
        h.insert("x-forwarded-for", "203.0.113.9, 10.0.0.1".parse().unwrap());
        let peer: SocketAddr = "192.0.2.1:5000".parse().unwrap();
        assert_eq!(
            client_ip(&h, peer, false),
            "192.0.2.1".parse::<IpAddr>().unwrap()
        );
        assert_eq!(
            client_ip(&h, peer, true),
            "203.0.113.9".parse::<IpAddr>().unwrap()
        );
    }

    #[test]
    fn routes_map_to_buckets() {
        assert_eq!(bucket_for(&Method::POST, "/api/ai/chat"), Bucket::Ai);
        assert_eq!(bucket_for(&Method::GET, "/api/ai/status"), Bucket::General);
        assert_eq!(bucket_for(&Method::POST, "/api/waitlist"), Bucket::Waitlist);
        assert_eq!(
            bucket_for(&Method::GET, "/api/portfolio/0xabc"),
            Bucket::Portfolio
        );
    }
}
