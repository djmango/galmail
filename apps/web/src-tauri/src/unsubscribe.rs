//! RFC 8058 one-click unsubscribe via native HTTPS POST.
//! Never follows redirects, never sends cookies/auth, HTTPS only.

use serde::Deserialize;
use std::time::Duration;
use url::Url;

const ONE_CLICK_BODY: &str = "List-Unsubscribe=One-Click";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OneClickUnsubscribeRequest {
    url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OpenExternalUrlRequest {
    url: String,
}

fn validate_https_url(raw: &str) -> Result<Url, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.len() > 8_192 {
        return Err("unsubscribe URL is invalid".into());
    }
    let parsed = Url::parse(trimmed).map_err(|_| "unsubscribe URL is invalid".to_string())?;
    if parsed.scheme() != "https" {
        return Err("only https unsubscribe URLs are allowed".into());
    }
    if parsed.host_str().is_none() {
        return Err("unsubscribe URL is missing a host".into());
    }
    Ok(parsed)
}

/// Allow http/https (browser) and mailto (mail client) for user-activated link opens.
fn validate_external_url(raw: &str) -> Result<Url, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.len() > 8_192 {
        return Err("URL is invalid".into());
    }
    let parsed = Url::parse(trimmed).map_err(|_| "URL is invalid".to_string())?;
    match parsed.scheme() {
        "https" | "http" => {
            if parsed.host_str().is_none() {
                return Err("URL is missing a host".into());
            }
            Ok(parsed)
        }
        "mailto" => Ok(parsed),
        _ => Err("only http, https, and mailto URLs are allowed".into()),
    }
}

#[tauri::command]
pub async fn one_click_unsubscribe(
    request: OneClickUnsubscribeRequest,
) -> Result<(), String> {
    let url = validate_https_url(&request.url)?;
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|_| "failed to create unsubscribe HTTP client".to_string())?;

    let response = client
        .post(url)
        .header(
            reqwest::header::CONTENT_TYPE,
            "application/x-www-form-urlencoded",
        )
        .body(ONE_CLICK_BODY)
        .send()
        .await
        .map_err(|error| {
            if error.is_timeout() {
                "unsubscribe request timed out".to_string()
            } else {
                "unsubscribe request failed".to_string()
            }
        })?;

    let status = response.status();
    if status.is_success() {
        Ok(())
    } else {
        Err(format!(
            "unsubscribe failed with HTTP {}",
            status.as_u16()
        ))
    }
}

#[tauri::command]
pub async fn open_external_url(
    app: tauri::AppHandle,
    request: OpenExternalUrlRequest,
) -> Result<(), String> {
    let url = validate_external_url(&request.url)?;
    // Prefer shell:allow-open (already granted) over introducing tauri-plugin-opener.
    #[allow(deprecated)]
    let opened = tauri_plugin_shell::ShellExt::shell(&app).open(url.as_str(), None);
    opened.map_err(|_| "failed to open URL in the system browser".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_https_url_accepts_https_only() {
        assert!(validate_https_url("https://example.com/unsub").is_ok());
        assert!(validate_https_url("http://example.com/unsub").is_err());
        assert!(validate_https_url("javascript:alert(1)").is_err());
        assert!(validate_https_url("data:text/html,hi").is_err());
        assert!(validate_https_url("mailto:a@b.com").is_err());
        assert!(validate_https_url("").is_err());
    }

    #[test]
    fn validate_external_url_allows_http_https_mailto() {
        assert!(validate_external_url("https://example.com/path").is_ok());
        assert!(validate_external_url("http://example.com/path").is_ok());
        assert!(validate_external_url("mailto:a@b.com").is_ok());
        assert!(validate_external_url("javascript:alert(1)").is_err());
        assert!(validate_external_url("data:text/html,hi").is_err());
        assert!(validate_external_url("file:///etc/passwd").is_err());
        assert!(validate_external_url("").is_err());
    }

    #[test]
    fn one_click_request_rejects_unknown_fields() {
        let bad = serde_json::json!({
            "url": "https://example.com/unsub",
            "cookie": "evil"
        });
        assert!(serde_json::from_value::<OneClickUnsubscribeRequest>(bad).is_err());
    }

    #[test]
    fn one_click_body_matches_rfc_8058() {
        assert_eq!(ONE_CLICK_BODY, "List-Unsubscribe=One-Click");
    }
}
