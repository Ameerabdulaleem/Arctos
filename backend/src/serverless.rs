//! Helpers for running behind a serverless platform router (Vercel).
//!
//! The platform sends every `/api/*` request to one function through a
//! rewrite. Depending on the platform version the function then sees either
//! the original URL or the rewritten one, with the original path attached as a
//! query parameter. `normalize_uri` turns both shapes back into the URL the
//! browser asked for, so the router always matches on real paths.

use axum::http::Uri;

/// Query parameter that carries the original path through the rewrite.
pub const ROUTE_PARAM: &str = "__route";
/// The platform also appends the matched path segment under the name used in
/// the rewrite source. It is dropped so handlers never see it.
pub const SEGMENT_PARAM: &str = "__seg";

/// Rebuilds the URL the browser asked for.
///
/// * `/api/main?__route=/api/news&__seg=news&limit=5` becomes `/api/news?limit=5`
/// * `/api/news?__route=/api/news&limit=5` becomes `/api/news?limit=5`
/// * a URL without the parameter is returned unchanged
///
/// The parameter only selects among routes the caller could request directly,
/// so it grants nothing. Values that are not a plain absolute path are ignored.
pub fn normalize_uri(uri: &Uri) -> Uri {
    let Some(query) = uri.query() else {
        return uri.clone();
    };
    let mut route: Option<String> = None;
    let mut rest: Vec<&str> = Vec::new();
    for pair in query.split('&').filter(|p| !p.is_empty()) {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        if key == ROUTE_PARAM {
            if route.is_none() {
                route = Some(percent_decode(value));
            }
        } else if key == SEGMENT_PARAM {
            // Internal to the rewrite.
        } else {
            rest.push(pair);
        }
    }
    let Some(route) = route else {
        return uri.clone();
    };
    let path = if is_plain_path(&route) {
        route
    } else {
        uri.path().to_string()
    };
    let rebuilt = if rest.is_empty() {
        path
    } else {
        format!("{path}?{}", rest.join("&"))
    };
    rebuilt.parse().unwrap_or_else(|_| uri.clone())
}

/// A conservative allow list for the path: letters, digits and a few separators.
fn is_plain_path(p: &str) -> bool {
    p.starts_with('/')
        && !p.starts_with("//")
        && p.len() <= 256
        && p.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '-' | '_' | '.'))
        && !p.split('/').any(|seg| seg == ".." || seg == ".")
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let hex = |b: u8| (b as char).to_digit(16).map(|d| d as u8);
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => match (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                (Some(h), Some(l)) => {
                    out.push(h * 16 + l);
                    i += 3;
                }
                _ => {
                    out.push(b'%');
                    i += 1;
                }
            },
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn norm(s: &str) -> String {
        normalize_uri(&s.parse::<Uri>().unwrap()).to_string()
    }

    #[test]
    fn restores_the_original_path_and_keeps_other_parameters() {
        assert_eq!(
            norm("/api/main?__route=/api/news&limit=5"),
            "/api/news?limit=5"
        );
        assert_eq!(
            norm("/api/main?limit=5&__route=/api/news"),
            "/api/news?limit=5"
        );
        assert_eq!(
            norm("/api/main?__route=/api/market/overview"),
            "/api/market/overview"
        );
        assert_eq!(
            norm("/api/main?__route=%2Fapi%2Fportfolio%2F0xAbC123&x=1"),
            "/api/portfolio/0xAbC123?x=1"
        );
        assert_eq!(norm("/api/main?__route=/ws/market"), "/ws/market");
    }

    #[test]
    fn handles_the_exact_shape_the_platform_router_produces() {
        // Taken from the routes Vercel generates for the rewrite in vercel.json.
        assert_eq!(
            norm("/api/main?__route=%2Fapi%2Fmarket/klines&__seg=market/klines&symbol=BTCUSDT&interval=1h"),
            "/api/market/klines?symbol=BTCUSDT&interval=1h"
        );
        assert_eq!(
            norm("/api/main?__route=%2Fapi%2Fstatus&__seg=status"),
            "/api/status"
        );
        assert_eq!(norm("/api/main?__route=%2Fapi%2F&__seg="), "/api/");
    }

    #[test]
    fn works_when_the_platform_already_kept_the_original_path() {
        assert_eq!(
            norm("/api/market/klines?__route=/api/market/klines&symbol=BTCUSDT&interval=1h"),
            "/api/market/klines?symbol=BTCUSDT&interval=1h"
        );
        assert_eq!(norm("/api/news?limit=5"), "/api/news?limit=5");
        assert_eq!(norm("/api/status"), "/api/status");
    }

    #[test]
    fn ignores_values_that_are_not_plain_paths() {
        for bad in [
            "/api/main?__route=https://evil.example/x",
            "/api/main?__route=//evil.example",
            "/api/main?__route=/api/../secret",
            "/api/main?__route=/api/news%3Fadmin%3D1",
            "/api/main?__route=/api/a%20b",
            "/api/main?__route=",
        ] {
            assert_eq!(norm(bad), "/api/main", "{bad}");
        }
        // Only the first value counts.
        assert_eq!(
            norm("/api/main?__route=/api/news&__route=/api/status"),
            "/api/news"
        );
    }
}
