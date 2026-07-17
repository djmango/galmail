//! Minimal browser page shown after the local OAuth loopback redirect.

use std::{
    collections::HashMap,
    time::{Duration, Instant},
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
    time::timeout,
};
use url::Url;

#[derive(Clone, Copy)]
pub enum PageKind {
    Success,
    Denied,
    Failed,
}

/// Accept loopback connections until a real OAuth redirect arrives.
///
/// Ignores favicon / probe traffic and any hit that lacks a matching `state`
/// plus either a non-empty `code` or non-empty `error`. Those probes must not
/// consume the authorization attempt — otherwise a later success redirect is
/// refused and the UI looks like a cancel/deny.
pub async fn accept_oauth_callback(
    listener: &TcpListener,
    expected_path: &str,
    expected_state: &str,
    overall_timeout: Duration,
) -> Result<(tokio::net::TcpStream, HashMap<String, String>), String> {
    let deadline = Instant::now() + overall_timeout;
    loop {
        let remaining = deadline
            .checked_duration_since(Instant::now())
            .ok_or_else(|| "OAuth callback timed out".to_string())?;
        let (mut stream, _) = timeout(remaining, listener.accept())
            .await
            .map_err(|_| "OAuth callback timed out".to_string())?
            .map_err(|_| "OAuth callback failed".to_string())?;
        let Some(request) = read_http_head(&mut stream).await else {
            continue;
        };
        let Some(target) = request
            .lines()
            .next()
            .and_then(|line| line.split_whitespace().nth(1))
        else {
            continue;
        };
        let Some(callback) = parse_callback_target(target) else {
            continue;
        };
        if !path_matches(callback.path(), expected_path) {
            let _ = stream
                .write_all(
                    b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                )
                .await;
            continue;
        }
        let query: HashMap<String, String> = callback.query_pairs().into_owned().collect();
        if !is_terminal_oauth_query(&query, expected_state) {
            // Keep listening — browsers and IdP pages sometimes hit the loopback
            // path without the authorization response.
            let _ = stream
                .write_all(
                    b"HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
                )
                .await;
            continue;
        }
        return Ok((stream, query));
    }
}

fn parse_callback_target(target: &str) -> Option<Url> {
    if target.starts_with("http://") || target.starts_with("https://") {
        Url::parse(target).ok()
    } else {
        Url::parse(&format!("http://127.0.0.1{target}")).ok()
    }
}

fn path_matches(path: &str, expected: &str) -> bool {
    if path == expected {
        return true;
    }
    // `http://localhost:port` and `http://localhost:port/` both normalize to `/`.
    expected == "/" && (path.is_empty() || path == "/")
}

fn is_terminal_oauth_query(query: &HashMap<String, String>, expected_state: &str) -> bool {
    if query.get("state").map(String::as_str) != Some(expected_state) {
        return false;
    }
    let code = query.get("code").map(String::as_str).unwrap_or("").trim();
    let error = query.get("error").map(String::as_str).unwrap_or("").trim();
    !code.is_empty() || !error.is_empty()
}

async fn read_http_head(stream: &mut tokio::net::TcpStream) -> Option<String> {
    let mut buffer = Vec::with_capacity(4096);
    let mut chunk = [0_u8; 2048];
    let read_deadline = Instant::now() + Duration::from_secs(10);
    loop {
        if buffer.len() > 64 * 1024 {
            return None;
        }
        let remaining = read_deadline.checked_duration_since(Instant::now())?;
        let count = match timeout(remaining, stream.read(&mut chunk)).await {
            Ok(Ok(0)) => break,
            Ok(Ok(count)) => count,
            _ => return None,
        };
        buffer.extend_from_slice(&chunk[..count]);
        if buffer.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
        // Request-line-only probes may omit a full header block; stop once the
        // first line is complete and the peer paused.
        if buffer.windows(2).any(|window| window == b"\r\n") && count < chunk.len() {
            break;
        }
    }
    std::str::from_utf8(&buffer).ok().map(str::to_owned)
}

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

pub fn render(kind: PageKind, detail: Option<&str>) -> String {
    let (title, heading, default_copy, tone, can_close) = match kind {
        PageKind::Success => (
            "Signed in",
            "You're signed in",
            "Head back to GalMail. This page closes on its own when the browser allows it.",
            "ok",
            true,
        ),
        PageKind::Denied => (
            "Sign-in cancelled",
            "Sign-in cancelled",
            "Nothing was connected. You can close this page and try again in GalMail.",
            "err",
            false,
        ),
        PageKind::Failed => (
            "Sign-in failed",
            "Could not finish sign-in",
            "Close this page and try again in GalMail.",
            "err",
            false,
        ),
    };
    let copy = detail
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(default_copy);
    let copy = escape_html(copy);

    format!(
        r##"<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>GalMail · {title}</title>
<style>
  :root {{
    color-scheme: dark light;
    --bg: #0b0d10;
    --fg: #f4f5f7;
    --muted: #9aa3ad;
    --ok: #3dba7a;
    --err: #e26d6d;
    --card: #14181e;
    --line: #232a33;
  }}
  @media (prefers-color-scheme: light) {{
    :root {{
      --bg: #f6f7f9;
      --fg: #12151a;
      --muted: #5c6570;
      --card: #ffffff;
      --line: #e4e7ec;
    }}
  }}
  * {{ box-sizing: border-box; }}
  html, body {{
    margin: 0;
    min-height: 100%;
    background: var(--bg);
    color: var(--fg);
    font: 16px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }}
  body {{
    display: grid;
    place-items: center;
    padding: 2rem 1.25rem;
  }}
  main {{
    width: min(24rem, 100%);
    padding: 1.75rem 1.5rem 1.5rem;
    border: 1px solid var(--line);
    border-radius: 16px;
    background: var(--card);
    text-align: center;
  }}
  .dot {{
    width: 0.7rem;
    height: 0.7rem;
    margin: 0 auto 1rem;
    border-radius: 50%;
    background: var(--{tone});
    box-shadow: 0 0 0 6px color-mix(in srgb, var(--{tone}) 18%, transparent);
  }}
  h1 {{
    margin: 0 0 0.45rem;
    font-size: 1.2rem;
    font-weight: 650;
    letter-spacing: -0.02em;
  }}
  p {{
    margin: 0;
    color: var(--muted);
    font-size: 0.92rem;
    overflow-wrap: anywhere;
  }}
  .brand {{
    margin-top: 1.25rem;
    color: var(--muted);
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }}
</style>
</head>
<body>
  <main>
    <div class="dot" aria-hidden="true"></div>
    <h1>{heading}</h1>
    <p id="copy">{copy}</p>
    <div class="brand">GalMail</div>
  </main>
  <script>
    (function () {{
      var copy = document.getElementById("copy");
      if (!{can_close}) return;
      setTimeout(function () {{
        try {{ window.open("", "_self"); window.close(); }} catch (e) {{}}
        try {{ window.close(); }} catch (e) {{}}
        setTimeout(function () {{
          if (!window.closed && copy) {{
            copy.textContent = "You can close this tab and return to GalMail.";
          }}
        }}, 250);
      }}, 700);
    }})();
  </script>
</body>
</html>
"##
    )
}

pub fn http_response(status: &str, kind: PageKind, detail: Option<&str>) -> String {
    let body = render(kind, detail);
    format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terminal_oauth_query_requires_state_and_code_or_error() {
        let state = "abc";
        let mut query = HashMap::new();
        assert!(!is_terminal_oauth_query(&query, state));
        query.insert("state".into(), state.into());
        assert!(!is_terminal_oauth_query(&query, state));
        query.insert("error".into(), "".into());
        assert!(!is_terminal_oauth_query(&query, state));
        query.insert("error".into(), "access_denied".into());
        assert!(is_terminal_oauth_query(&query, state));
        query.clear();
        query.insert("state".into(), state.into());
        query.insert("code".into(), "0.AXo".into());
        assert!(is_terminal_oauth_query(&query, state));
        query.insert("state".into(), "other".into());
        assert!(!is_terminal_oauth_query(&query, state));
    }

    #[test]
    fn parse_callback_supports_origin_and_absolute_form() {
        let relative = parse_callback_target("/oauth/callback?code=1&state=s").unwrap();
        assert_eq!(relative.path(), "/oauth/callback");
        assert_eq!(relative.query_pairs().next().unwrap().0, "code");
        let absolute =
            parse_callback_target("http://127.0.0.1:9/oauth/callback?code=1&state=s").unwrap();
        assert_eq!(absolute.path(), "/oauth/callback");
        assert!(path_matches("/", "/"));
        assert!(path_matches("", "/"));
    }
}
