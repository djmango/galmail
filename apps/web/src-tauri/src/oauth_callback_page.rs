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

/// Accept loopback connections until the OAuth redirect hits `expected_path`.
/// Ignores favicon / probe traffic on the same port.
pub async fn accept_oauth_callback(
    listener: &TcpListener,
    expected_path: &str,
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
        let mut buffer = [0_u8; 8192];
        let count = match timeout(Duration::from_secs(10), stream.read(&mut buffer)).await {
            Ok(Ok(count)) => count,
            _ => continue,
        };
        let Ok(request) = std::str::from_utf8(&buffer[..count]) else {
            continue;
        };
        let Some(target) = request
            .lines()
            .next()
            .and_then(|line| line.split_whitespace().nth(1))
        else {
            continue;
        };
        let Ok(callback) = Url::parse(&format!("http://127.0.0.1{target}")) else {
            continue;
        };
        if callback.path() != expected_path {
            let _ = stream
                .write_all(
                    b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                )
                .await;
            continue;
        }
        let query = callback.query_pairs().into_owned().collect();
        return Ok((stream, query));
    }
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
