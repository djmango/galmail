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

const ATTEMPT_TTL: Duration = Duration::from_secs(180);
const SCOPES: &str =
    "openid profile email offline_access https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MicrosoftBeginOAuth {
    pub attempt_id: String,
    pub authorization_url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MicrosoftConnectedAccount {
    pub account_id: String,
    pub email: String,
    pub tenant: String,
    pub granted_scopes: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphApiResponse {
    pub status: u16,
    pub body: serde_json::Value,
    pub retry_after: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
struct TokenBundle {
    access_token: String,
    refresh_token: String,
    expires_at: u64,
    scope: String,
    tenant: String,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: Option<u64>,
    scope: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GraphProfile {
    mail: Option<String>,
    user_principal_name: Option<String>,
}

struct PendingAttempt {
    client_id: String,
    tenant: String,
    verifier: String,
    state: String,
    redirect_uri: String,
    listener: StdTcpListener,
    created_at: Instant,
}

pub struct MicrosoftOAuthState {
    pending: Mutex<HashMap<String, PendingAttempt>>,
    http: reqwest::Client,
    token_store: Arc<dyn SecureTokenStore>,
}

impl MicrosoftOAuthState {
    pub fn new(token_store: Arc<dyn SecureTokenStore>) -> Self {
        Self {
            pending: Mutex::new(HashMap::new()),
            http: reqwest::Client::new(),
            token_store,
        }
    }

    pub async fn begin(
        &self,
        client_id: String,
        tenant: Option<String>,
    ) -> Result<MicrosoftBeginOAuth, String> {
        if !is_uuid(&client_id) {
            return Err("a Microsoft application (client) ID is required".into());
        }
        let tenant = tenant.unwrap_or_else(|| "common".into());
        if !valid_tenant(&tenant) {
            return Err("invalid Microsoft tenant".into());
        }
        let listener = StdTcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0))
            .map_err(|_| "cannot bind the Microsoft OAuth callback listener".to_string())?;
        listener
            .set_nonblocking(true)
            .map_err(|_| "cannot configure the Microsoft OAuth callback listener".to_string())?;
        let port = listener
            .local_addr()
            .map_err(|_| "cannot inspect the Microsoft OAuth callback listener".to_string())?
            .port();
        let redirect_uri = format!("http://127.0.0.1:{port}/oauth/microsoft/callback");
        let verifier = random_base64url()?;
        let state = random_base64url()?;
        let attempt_id = random_base64url()?;
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        let endpoint = format!("https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize");
        let mut url = Url::parse(&endpoint).map_err(|_| "invalid Microsoft OAuth endpoint")?;
        url.query_pairs_mut()
            .append_pair("client_id", &client_id)
            .append_pair("redirect_uri", &redirect_uri)
            .append_pair("response_type", "code")
            .append_pair("response_mode", "query")
            .append_pair("scope", SCOPES)
            .append_pair("prompt", "select_account")
            .append_pair("code_challenge", &challenge)
            .append_pair("code_challenge_method", "S256")
            .append_pair("state", &state);
        self.pending.lock().await.insert(
            attempt_id.clone(),
            PendingAttempt {
                client_id,
                tenant,
                verifier,
                state,
                redirect_uri,
                listener,
                created_at: Instant::now(),
            },
        );
        Ok(MicrosoftBeginOAuth {
            attempt_id,
            authorization_url: url.into(),
        })
    }

    pub async fn complete(&self, attempt_id: &str) -> Result<MicrosoftConnectedAccount, String> {
        let pending = self
            .pending
            .lock()
            .await
            .remove(attempt_id)
            .ok_or_else(|| "Microsoft OAuth attempt is unknown or already consumed".to_string())?;
        if pending.created_at.elapsed() > ATTEMPT_TTL {
            return Err("Microsoft OAuth attempt expired".into());
        }
        let listener = TcpListener::from_std(
            pending
                .listener
                .try_clone()
                .map_err(|_| "cannot clone the Microsoft OAuth callback listener".to_string())?,
        )
        .map_err(|_| "cannot activate the Microsoft OAuth callback listener".to_string())?;
        let (mut stream, _) = timeout(ATTEMPT_TTL, listener.accept())
            .await
            .map_err(|_| "Microsoft OAuth callback timed out".to_string())?
            .map_err(|_| "Microsoft OAuth callback failed".to_string())?;
        let mut buffer = [0_u8; 8192];
        let count = timeout(Duration::from_secs(10), stream.read(&mut buffer))
            .await
            .map_err(|_| "Microsoft OAuth callback timed out".to_string())?
            .map_err(|_| "Microsoft OAuth callback was unreadable".to_string())?;
        let request = std::str::from_utf8(&buffer[..count])
            .map_err(|_| "Microsoft OAuth callback was invalid".to_string())?;
        let target = request
            .lines()
            .next()
            .and_then(|line| line.split_whitespace().nth(1))
            .ok_or_else(|| "Microsoft OAuth callback was invalid".to_string())?;
        let callback =
            Url::parse(&format!("http://127.0.0.1{target}")).map_err(|_| "invalid callback")?;
        let query: HashMap<_, _> = callback.query_pairs().into_owned().collect();
        let valid = callback.path() == "/oauth/microsoft/callback"
            && query.get("state") == Some(&pending.state);
        let error = query.get("error").cloned();
        let body = if valid && error.is_none() && query.contains_key("code") {
            "Authorization complete. Return to GalMail."
        } else {
            "Authorization was not completed. Return to GalMail."
        };
        let status = if valid && error.is_none() {
            "200 OK"
        } else {
            "400 Bad Request"
        };
        let response = format!(
            "HTTP/1.1 {status}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        let _ = stream.write_all(response.as_bytes()).await;
        if !valid {
            return Err("Microsoft OAuth callback state validation failed".into());
        }
        if let Some(error) = error {
            return Err(classify_authorization_error(
                &error,
                query.get("error_description").map(String::as_str),
            ));
        }
        let code = query
            .get("code")
            .ok_or_else(|| "Microsoft OAuth callback omitted the authorization code".to_string())?;
        let token = self.exchange_code(&pending, code).await?;
        let profile: GraphProfile = self
            .http
            .get("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName")
            .bearer_auth(&token.access_token)
            .send()
            .await
            .map_err(|_| "cannot retrieve the Microsoft profile".to_string())?
            .error_for_status()
            .map_err(|_| "Microsoft rejected the profile request".to_string())?
            .json()
            .await
            .map_err(|_| "Microsoft profile response was invalid".to_string())?;
        let email = profile
            .mail
            .or(profile.user_principal_name)
            .ok_or_else(|| "Microsoft profile did not include a mailbox address".to_string())?;
        let scope = token.scope.unwrap_or_default();
        for required in [
            "https://graph.microsoft.com/Mail.ReadWrite",
            "https://graph.microsoft.com/Mail.Send",
        ] {
            if !scope.split_whitespace().any(|granted| {
                granted.eq_ignore_ascii_case(required)
                    || granted.eq_ignore_ascii_case(
                        required.trim_start_matches("https://graph.microsoft.com/"),
                    )
            }) {
                return Err("Microsoft did not grant the required delegated mail scopes".into());
            }
        }
        let bundle = TokenBundle {
            access_token: token.access_token,
            refresh_token: token
                .refresh_token
                .ok_or_else(|| "Microsoft did not issue an offline refresh token".to_string())?,
            expires_at: unix_time().saturating_add(token.expires_in.unwrap_or(3600)),
            scope: scope.clone(),
            tenant: pending.tenant.clone(),
        };
        let account_id = format!("microsoft:{}", email.to_lowercase());
        self.token_store.store_token(
            &account_id,
            &serde_json::to_vec(&bundle)
                .map_err(|_| "cannot encode Microsoft credentials".to_string())?,
        )?;
        Ok(MicrosoftConnectedAccount {
            account_id,
            email,
            tenant: pending.tenant,
            granted_scopes: scope.split_whitespace().map(str::to_string).collect(),
        })
    }

    async fn exchange_code(
        &self,
        pending: &PendingAttempt,
        code: &str,
    ) -> Result<TokenResponse, String> {
        let body = url::form_urlencoded::Serializer::new(String::new())
            .append_pair("client_id", &pending.client_id)
            .append_pair("redirect_uri", &pending.redirect_uri)
            .append_pair("code_verifier", &pending.verifier)
            .append_pair("code", code)
            .append_pair("scope", SCOPES)
            .append_pair("grant_type", "authorization_code")
            .finish();
        self.http
            .post(format!(
                "https://login.microsoftonline.com/{}/oauth2/v2.0/token",
                pending.tenant
            ))
            .header("content-type", "application/x-www-form-urlencoded")
            .body(body)
            .send()
            .await
            .map_err(|_| "cannot reach the Microsoft token endpoint".to_string())?
            .error_for_status()
            .map_err(|_| "Microsoft rejected the authorization code".to_string())?
            .json()
            .await
            .map_err(|_| "Microsoft token response was invalid".to_string())
    }

    async fn access_token(&self, account_id: &str, client_id: &str) -> Result<String, String> {
        let bytes = self
            .token_store
            .load_token(account_id)?
            .ok_or_else(|| "Microsoft authorization must be renewed".to_string())?;
        let bundle: TokenBundle = serde_json::from_slice(&bytes)
            .map_err(|_| "stored Microsoft credentials are invalid".to_string())?;
        if bundle.expires_at > unix_time().saturating_add(60) {
            return Ok(bundle.access_token);
        }
        self.refresh(account_id, client_id, bundle).await
    }

    async fn refresh(
        &self,
        account_id: &str,
        client_id: &str,
        mut bundle: TokenBundle,
    ) -> Result<String, String> {
        let body = url::form_urlencoded::Serializer::new(String::new())
            .append_pair("client_id", client_id)
            .append_pair("refresh_token", &bundle.refresh_token)
            .append_pair("scope", SCOPES)
            .append_pair("grant_type", "refresh_token")
            .finish();
        let refreshed: TokenResponse = self
            .http
            .post(format!(
                "https://login.microsoftonline.com/{}/oauth2/v2.0/token",
                bundle.tenant
            ))
            .header("content-type", "application/x-www-form-urlencoded")
            .body(body)
            .send()
            .await
            .map_err(|_| "cannot refresh Microsoft authorization".to_string())?
            .error_for_status()
            .map_err(|_| "Microsoft authorization must be renewed".to_string())?
            .json()
            .await
            .map_err(|_| "Microsoft refresh response was invalid".to_string())?;
        bundle.access_token = refreshed.access_token;
        bundle.expires_at = unix_time().saturating_add(refreshed.expires_in.unwrap_or(3600));
        if let Some(refresh_token) = refreshed.refresh_token {
            bundle.refresh_token = refresh_token;
        }
        if let Some(scope) = refreshed.scope {
            bundle.scope = scope;
        }
        self.token_store.store_token(
            account_id,
            &serde_json::to_vec(&bundle)
                .map_err(|_| "cannot encode Microsoft credentials".to_string())?,
        )?;
        Ok(bundle.access_token)
    }

    pub async fn api_request(
        &self,
        account_id: &str,
        client_id: &str,
        method: &str,
        path: &str,
        body: Option<serde_json::Value>,
    ) -> Result<GraphApiResponse, String> {
        if !valid_graph_path(path) {
            return Err("invalid Microsoft Graph API path".into());
        }
        if !matches!(method, "GET" | "POST" | "PATCH" | "DELETE") {
            return Err("unsupported Microsoft Graph API method".into());
        }
        let url = format!("https://graph.microsoft.com{path}");
        let mut token = self.access_token(account_id, client_id).await?;
        for attempt in 0..2 {
            let mut request = match method {
                "GET" => self.http.get(&url),
                "POST" => self.http.post(&url),
                "PATCH" => self.http.patch(&url),
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
                .map_err(|_| "cannot reach Microsoft Graph".to_string())?;
            if response.status().as_u16() == 401 && attempt == 0 {
                let bytes = self
                    .token_store
                    .load_token(account_id)?
                    .ok_or_else(|| "Microsoft authorization must be renewed".to_string())?;
                let bundle = serde_json::from_slice(&bytes)
                    .map_err(|_| "stored Microsoft credentials are invalid".to_string())?;
                token = self.refresh(account_id, client_id, bundle).await?;
                continue;
            }
            let status = response.status().as_u16();
            let retry_after = response
                .headers()
                .get("retry-after")
                .and_then(|value| value.to_str().ok())
                .map(str::to_string);
            let value = response.json().await.unwrap_or(serde_json::Value::Null);
            return Ok(GraphApiResponse {
                status,
                body: value,
                retry_after,
            });
        }
        Err("Microsoft authorization must be renewed".into())
    }

    pub fn disconnect(&self, account_id: &str) -> Result<(), String> {
        self.token_store.delete_token(account_id)
    }
}

fn valid_graph_path(path: &str) -> bool {
    path.starts_with("/v1.0/")
        && !path.contains("://")
        && !path.contains("..")
        && !path.contains('\\')
}

fn valid_tenant(value: &str) -> bool {
    matches!(value, "common" | "organizations" | "consumers") || is_uuid(value)
}

fn is_uuid(value: &str) -> bool {
    value.len() == 36
        && value.chars().enumerate().all(|(index, value)| match index {
            8 | 13 | 18 | 23 => value == '-',
            _ => value.is_ascii_hexdigit(),
        })
}

fn classify_authorization_error(error: &str, description: Option<&str>) -> String {
    let text = format!("{error} {}", description.unwrap_or_default()).to_lowercase();
    if text.contains("admin") || text.contains("authorization_requestdenied") {
        "Microsoft administrator consent is required".into()
    } else if text.contains("conditional") || text.contains("aadsts53000") {
        "Microsoft conditional access requires interaction".into()
    } else if text.contains("consent") {
        "Microsoft user consent is required".into()
    } else {
        "Microsoft authorization was denied".into()
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
    fn validates_public_client_inputs_and_graph_boundary() {
        assert!(is_uuid("00000000-0000-4000-8000-000000000001"));
        assert!(valid_tenant("organizations"));
        assert!(valid_graph_path("/v1.0/me/messages?$top=10"));
        assert!(!valid_graph_path("https://evil.invalid/v1.0/me"));
        assert!(!valid_graph_path("/v1.0/../beta/me"));
        assert!(!SCOPES.contains("client_secret"));
    }

    #[test]
    fn pkce_material_is_url_safe_and_unique() {
        let first = random_base64url().unwrap();
        let second = random_base64url().unwrap();
        assert_eq!(first.len(), 43);
        assert_ne!(first, second);
    }
}
