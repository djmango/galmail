use crate::secure_storage::SecureTokenStore;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    net::{Ipv4Addr, SocketAddrV4, TcpListener as StdTcpListener},
    sync::Arc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
    sync::Mutex,
    time::timeout,
};
use url::Url;

const AUTH_ENDPOINT: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT: &str = "https://oauth2.googleapis.com/revoke";
const PROFILE_ENDPOINT: &str = "https://gmail.googleapis.com/gmail/v1/users/me/profile";
const ATTEMPT_TTL: Duration = Duration::from_secs(180);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BeginOAuth {
    pub attempt_id: String,
    pub authorization_url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectedAccount {
    pub account_id: String,
    pub email: String,
    pub granted_scopes: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GmailApiResponse {
    pub status: u16,
    pub body: serde_json::Value,
}

#[derive(Debug, Deserialize, Serialize)]
struct TokenBundle {
    access_token: String,
    refresh_token: String,
    expires_at: u64,
    scope: String,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: Option<u64>,
    scope: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GmailProfile {
    #[serde(rename = "emailAddress")]
    email_address: String,
}

struct PendingAttempt {
    client_id: String,
    verifier: String,
    state: String,
    redirect_uri: String,
    listener: StdTcpListener,
    created_at: Instant,
}

pub struct GmailOAuthState {
    pending: Mutex<HashMap<String, PendingAttempt>>,
    http: reqwest::Client,
    token_store: Arc<dyn SecureTokenStore>,
}

impl GmailOAuthState {
    pub fn new(token_store: Arc<dyn SecureTokenStore>) -> Self {
        Self {
            pending: Mutex::new(HashMap::new()),
            http: reqwest::Client::new(),
            token_store,
        }
    }

    pub async fn begin(&self, client_id: String) -> Result<BeginOAuth, String> {
        if client_id.trim().is_empty() || client_id.len() > 512 {
            return Err("a Google desktop client ID is required".into());
        }
        let listener = StdTcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0))
            .map_err(|_| "cannot bind the OAuth callback listener".to_string())?;
        listener
            .set_nonblocking(true)
            .map_err(|_| "cannot configure the OAuth callback listener".to_string())?;
        let port = listener
            .local_addr()
            .map_err(|_| "cannot inspect the OAuth callback listener".to_string())?
            .port();
        let redirect_uri = format!("http://127.0.0.1:{port}/oauth/callback");
        let verifier = random_base64url()?;
        let state = random_base64url()?;
        let attempt_id = random_base64url()?;
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        let mut url = Url::parse(AUTH_ENDPOINT).map_err(|_| "invalid OAuth endpoint")?;
        url.query_pairs_mut()
            .append_pair("client_id", &client_id)
            .append_pair("redirect_uri", &redirect_uri)
            .append_pair("response_type", "code")
            .append_pair(
                "scope",
                "openid email https://www.googleapis.com/auth/gmail.modify",
            )
            .append_pair("access_type", "offline")
            .append_pair("prompt", "consent")
            .append_pair("code_challenge", &challenge)
            .append_pair("code_challenge_method", "S256")
            .append_pair("state", &state);
        self.pending.lock().await.insert(
            attempt_id.clone(),
            PendingAttempt {
                client_id,
                verifier,
                state,
                redirect_uri,
                listener,
                created_at: Instant::now(),
            },
        );
        let authorization_url = url.to_string();
        open_system_browser(&authorization_url)?;
        Ok(BeginOAuth {
            attempt_id,
            authorization_url,
        })
    }

    pub async fn complete(&self, attempt_id: &str) -> Result<ConnectedAccount, String> {
        let pending = self
            .pending
            .lock()
            .await
            .remove(attempt_id)
            .ok_or_else(|| "OAuth attempt is unknown or already consumed".to_string())?;
        if pending.created_at.elapsed() > ATTEMPT_TTL {
            return Err("OAuth attempt expired".into());
        }
        let listener = TcpListener::from_std(pending.listener)
            .map_err(|_| "cannot activate the OAuth callback listener".to_string())?;
        let (mut stream, _) = timeout(ATTEMPT_TTL, listener.accept())
            .await
            .map_err(|_| "OAuth callback timed out".to_string())?
            .map_err(|_| "OAuth callback failed".to_string())?;
        let mut buffer = [0_u8; 8192];
        let count = timeout(Duration::from_secs(10), stream.read(&mut buffer))
            .await
            .map_err(|_| "OAuth callback timed out".to_string())?
            .map_err(|_| "OAuth callback was unreadable".to_string())?;
        let request = std::str::from_utf8(&buffer[..count])
            .map_err(|_| "OAuth callback was invalid".to_string())?;
        let target = request
            .lines()
            .next()
            .and_then(|line| line.split_whitespace().nth(1))
            .ok_or_else(|| "OAuth callback was invalid".to_string())?;
        let callback =
            Url::parse(&format!("http://127.0.0.1{target}")).map_err(|_| "invalid callback")?;
        let query: HashMap<_, _> = callback.query_pairs().into_owned().collect();
        let valid_path = callback.path() == "/oauth/callback";
        let valid_state = query.get("state") == Some(&pending.state);
        let code = query.get("code").cloned();
        let successful =
            valid_path && valid_state && code.is_some() && !query.contains_key("error");
        let (status, body) = if successful {
            (
                "200 OK",
                "Authorization complete. You may close this window and return to GalMail.",
            )
        } else {
            (
                "400 Bad Request",
                "Authorization was rejected. Return to GalMail and try again.",
            )
        };
        let response = format!(
            "HTTP/1.1 {status}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        let _ = stream.write_all(response.as_bytes()).await;
        if !valid_path || !valid_state {
            return Err("OAuth callback state validation failed".into());
        }
        if query.contains_key("error") {
            return Err("Google authorization was denied".into());
        }
        let code =
            code.ok_or_else(|| "OAuth callback omitted the authorization code".to_string())?;
        let token = self
            .exchange_code(
                &pending.client_id,
                &pending.redirect_uri,
                &pending.verifier,
                &code,
            )
            .await?;
        let profile: GmailProfile = self
            .http
            .get(PROFILE_ENDPOINT)
            .bearer_auth(&token.access_token)
            .send()
            .await
            .map_err(|_| "cannot retrieve the Gmail profile".to_string())?
            .error_for_status()
            .map_err(|_| "Google rejected the Gmail profile request".to_string())?
            .json()
            .await
            .map_err(|_| "Gmail profile response was invalid".to_string())?;
        let refresh_token = token
            .refresh_token
            .ok_or_else(|| "Google did not issue an offline refresh token".to_string())?;
        let account_id = format!("gmail:{}", profile.email_address.to_lowercase());
        let scope = token.scope.unwrap_or_default();
        if !scope
            .split_whitespace()
            .any(|granted| granted == "https://www.googleapis.com/auth/gmail.modify")
        {
            return Err("Google did not grant the required Gmail scope".into());
        }
        let bundle = TokenBundle {
            access_token: token.access_token,
            refresh_token,
            expires_at: unix_time().saturating_add(token.expires_in.unwrap_or(3600)),
            scope: scope.clone(),
        };
        let encoded = serde_json::to_vec(&bundle).map_err(|_| "cannot encode Gmail credentials")?;
        self.token_store.store_token(&account_id, &encoded)?;
        Ok(ConnectedAccount {
            account_id,
            email: profile.email_address,
            granted_scopes: scope.split_whitespace().map(str::to_string).collect(),
        })
    }

    async fn exchange_code(
        &self,
        client_id: &str,
        redirect_uri: &str,
        verifier: &str,
        code: &str,
    ) -> Result<TokenResponse, String> {
        let body: String = url::form_urlencoded::Serializer::new(String::new())
            .append_pair("client_id", client_id)
            .append_pair("redirect_uri", redirect_uri)
            .append_pair("code_verifier", verifier)
            .append_pair("code", code)
            .append_pair("grant_type", "authorization_code")
            .finish();
        self.http
            .post(TOKEN_ENDPOINT)
            .header("content-type", "application/x-www-form-urlencoded")
            .body(body)
            .send()
            .await
            .map_err(|_| "cannot reach the Google token endpoint".to_string())?
            .error_for_status()
            .map_err(|_| "Google rejected the authorization code".to_string())?
            .json()
            .await
            .map_err(|_| "Google token response was invalid".to_string())
    }

    pub async fn access_token(&self, account_id: &str, client_id: &str) -> Result<String, String> {
        let bytes = self
            .token_store
            .load_token(account_id)?
            .ok_or_else(|| "Gmail authorization must be renewed".to_string())?;
        let bundle: TokenBundle =
            serde_json::from_slice(&bytes).map_err(|_| "stored Gmail credentials are invalid")?;
        if bundle.expires_at > unix_time().saturating_add(60) {
            return Ok(bundle.access_token);
        }
        self.refresh_token_bundle(account_id, client_id, bundle)
            .await
    }

    async fn refresh_token_bundle(
        &self,
        account_id: &str,
        client_id: &str,
        mut bundle: TokenBundle,
    ) -> Result<String, String> {
        let body: String = url::form_urlencoded::Serializer::new(String::new())
            .append_pair("client_id", client_id)
            .append_pair("refresh_token", &bundle.refresh_token)
            .append_pair("grant_type", "refresh_token")
            .finish();
        let refreshed: TokenResponse = self
            .http
            .post(TOKEN_ENDPOINT)
            .header("content-type", "application/x-www-form-urlencoded")
            .body(body)
            .send()
            .await
            .map_err(|_| "cannot refresh Gmail authorization".to_string())?
            .error_for_status()
            .map_err(|_| "Gmail authorization must be renewed".to_string())?
            .json()
            .await
            .map_err(|_| "Google refresh response was invalid".to_string())?;
        bundle.access_token = refreshed.access_token;
        bundle.expires_at = unix_time().saturating_add(refreshed.expires_in.unwrap_or(3600));
        if let Some(scope) = refreshed.scope {
            bundle.scope = scope;
        }
        let encoded = serde_json::to_vec(&bundle).map_err(|_| "cannot encode Gmail credentials")?;
        self.token_store.store_token(account_id, &encoded)?;
        Ok(bundle.access_token)
    }

    pub async fn api_request(
        &self,
        account_id: &str,
        client_id: &str,
        method: &str,
        path: &str,
        body: Option<serde_json::Value>,
    ) -> Result<GmailApiResponse, String> {
        if !path.starts_with('/') || path.contains("://") || path.contains("..") {
            return Err("invalid Gmail API path".into());
        }
        if !matches!(method, "GET" | "POST" | "PUT" | "DELETE") {
            return Err("unsupported Gmail API method".into());
        }
        let url = format!("https://gmail.googleapis.com/gmail/v1/users/me{path}");
        let mut token = self.access_token(account_id, client_id).await?;
        for attempt in 0..2 {
            let mut request = match method {
                "GET" => self.http.get(&url),
                "POST" => self.http.post(&url),
                "PUT" => self.http.put(&url),
                "DELETE" => self.http.delete(&url),
                _ => unreachable!(),
            }
            .bearer_auth(&token)
            .header("accept", "application/json");
            if let Some(value) = body.as_ref() {
                request = request.json(value);
            }
            let response = request
                .send()
                .await
                .map_err(|_| "cannot reach Gmail".to_string())?;
            if response.status().as_u16() == 401 && attempt == 0 {
                let bytes = self
                    .token_store
                    .load_token(account_id)?
                    .ok_or_else(|| "Gmail authorization must be renewed".to_string())?;
                let bundle: TokenBundle = serde_json::from_slice(&bytes)
                    .map_err(|_| "stored Gmail credentials are invalid")?;
                token = self
                    .refresh_token_bundle(account_id, client_id, bundle)
                    .await?;
                continue;
            }
            let status = response.status().as_u16();
            let value = response.json().await.unwrap_or(serde_json::Value::Null);
            return Ok(GmailApiResponse {
                status,
                body: value,
            });
        }
        Err("Gmail authorization must be renewed".into())
    }

    pub async fn revoke(&self, account_id: &str) -> Result<bool, String> {
        let token = self
            .token_store
            .load_token(account_id)?
            .and_then(|bytes| serde_json::from_slice::<TokenBundle>(&bytes).ok())
            .map(|bundle| bundle.refresh_token);
        self.token_store.delete_token(account_id)?;
        let Some(token) = token else {
            return Ok(true);
        };
        let body: String = url::form_urlencoded::Serializer::new(String::new())
            .append_pair("token", &token)
            .finish();
        let remotely_revoked = self
            .http
            .post(REVOKE_ENDPOINT)
            .header("content-type", "application/x-www-form-urlencoded")
            .body(body)
            .send()
            .await
            .map(|response| response.status().is_success())
            .unwrap_or(false);
        Ok(remotely_revoked)
    }
}

fn open_system_browser(url: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(url)
            .spawn()
            .map_err(|_| "cannot open the system browser for Google sign-in".to_string())?;
        return Ok(());
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = url;
        Err("system browser handoff is only implemented on macOS".into())
    }
}

fn random_base64url() -> Result<String, String> {
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes).map_err(|_| "operating system RNG unavailable".to_string())?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

fn unix_time() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_material_is_url_safe_and_high_entropy() {
        let first = random_base64url().unwrap();
        let second = random_base64url().unwrap();
        assert_eq!(first.len(), 43);
        assert_ne!(first, second);
        assert!(first
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "-_".contains(character)));
    }
}
