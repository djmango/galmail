#[cfg(target_os = "ios")]
use crate::ios_oauth;
#[cfg(not(target_os = "ios"))]
use crate::oauth_callback_page::{self, accept_oauth_callback, PageKind};
use crate::secure_storage::SecureTokenStore;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
#[cfg(not(target_os = "ios"))]
use std::net::{Ipv4Addr, SocketAddrV4, TcpListener as StdTcpListener};
use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
#[cfg(target_os = "ios")]
use tokio::sync::oneshot;
use tokio::sync::Mutex;
#[cfg(not(target_os = "ios"))]
use tokio::{io::AsyncWriteExt, net::TcpListener};
use url::Url;

const ATTEMPT_TTL: Duration = Duration::from_secs(180);
/// Public-client delegated scopes. Azure app registration must allow:
/// - platform: Mobile and desktop applications (not SPA / not Web)
/// - redirect URI: `http://127.0.0.1` (or exact
///   `http://127.0.0.1/oauth/microsoft/callback`) as Mobile and desktop — not SPA
/// - Advanced: Allow public client flows = Yes
/// - delegated: User.Read, Mail.ReadWrite, Mail.Send, Calendars.ReadWrite,
///   offline_access, openid, profile, email
const SCOPES: &str =
    "openid profile email offline_access User.Read Mail.ReadWrite Mail.Send Calendars.ReadWrite";
#[cfg(not(target_os = "ios"))]
const CALLBACK_PATH: &str = "/oauth/microsoft/callback";

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
    created_at: Instant,
    #[cfg(not(target_os = "ios"))]
    listener: StdTcpListener,
    #[cfg(target_os = "ios")]
    ios_callback: oneshot::Receiver<Result<String, String>>,
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
        let verifier = random_base64url()?;
        let state = random_base64url()?;
        let attempt_id = random_base64url()?;
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));

        #[cfg(target_os = "ios")]
        {
            let redirect_uri = ios_oauth::MICROSOFT_REDIRECT_URI.to_string();
            let authorization_url =
                build_microsoft_auth_url(&client_id, &tenant, &redirect_uri, &challenge, &state)?;
            let ios_callback = ios_oauth::register_waiter(attempt_id.clone());
            // Store pending before presenting so complete() can await the callback.
            self.pending.lock().await.insert(
                attempt_id.clone(),
                PendingAttempt {
                    client_id,
                    tenant,
                    verifier,
                    state,
                    redirect_uri,
                    created_at: Instant::now(),
                    ios_callback,
                },
            );
            if let Err(error) = ios_oauth::present(
                &authorization_url,
                ios_oauth::MICROSOFT_CALLBACK_SCHEME,
                &attempt_id,
            ) {
                self.pending.lock().await.remove(&attempt_id);
                return Err(error);
            }
            return Ok(MicrosoftBeginOAuth {
                attempt_id,
                authorization_url,
            });
        }

        #[cfg(not(target_os = "ios"))]
        {
            let listener = StdTcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0))
                .map_err(|_| "cannot bind the Microsoft OAuth callback listener".to_string())?;
            listener.set_nonblocking(true).map_err(|_| {
                "cannot configure the Microsoft OAuth callback listener".to_string()
            })?;
            let port = listener
                .local_addr()
                .map_err(|_| "cannot inspect the Microsoft OAuth callback listener".to_string())?
                .port();
            // IPv4 literal (not `localhost`) so macOS does not prefer IPv6 while we
            // listen on 127.0.0.1. Register the loopback redirect as Mobile and
            // desktop (manifest may be required for http://127.0.0.1).
            let redirect_uri = format!("http://127.0.0.1:{port}{CALLBACK_PATH}");
            let authorization_url =
                build_microsoft_auth_url(&client_id, &tenant, &redirect_uri, &challenge, &state)?;
            // Store pending before opening the browser so complete() can listen even
            // when SSO redirects immediately.
            self.pending.lock().await.insert(
                attempt_id.clone(),
                PendingAttempt {
                    client_id,
                    tenant,
                    verifier,
                    state,
                    redirect_uri,
                    created_at: Instant::now(),
                    listener,
                },
            );
            open_system_browser(&authorization_url)?;
            Ok(MicrosoftBeginOAuth {
                attempt_id,
                authorization_url,
            })
        }
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

        #[cfg(target_os = "ios")]
        {
            let PendingAttempt {
                client_id,
                tenant,
                verifier,
                state,
                redirect_uri,
                ios_callback,
                created_at: _,
            } = pending;
            let callback_url = ios_oauth::await_callback(ios_callback, ATTEMPT_TTL).await?;
            let query = ios_oauth::parse_callback_query(&callback_url)?;
            if query.get("state").map(String::as_str) != Some(state.as_str()) {
                return Err("Microsoft OAuth callback state validation failed".into());
            }
            // Prefer `code` when present so an empty/spurious `error` cannot cancel a grant.
            let code = query
                .get("code")
                .map(String::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_owned);
            let Some(code) = code else {
                let error = query
                    .get("error")
                    .map(String::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .unwrap_or("access_denied");
                let description = query.get("error_description").map(String::as_str);
                let subcode = query.get("error_subcode").map(String::as_str);
                return Err(classify_authorization_error(error, description, subcode));
            };
            return self
                .finish_authorization(&client_id, &redirect_uri, &verifier, &tenant, &code)
                .await;
        }

        #[cfg(not(target_os = "ios"))]
        {
            let PendingAttempt {
                client_id,
                tenant,
                verifier,
                state,
                redirect_uri,
                listener,
                created_at: _,
            } = pending;
            let listener = TcpListener::from_std(listener)
                .map_err(|_| "cannot activate the Microsoft OAuth callback listener".to_string())?;
            let (mut stream, query) =
                accept_oauth_callback(&listener, CALLBACK_PATH, &state, ATTEMPT_TTL).await?;

            async fn reply(
                stream: &mut tokio::net::TcpStream,
                status: &str,
                kind: PageKind,
                detail: Option<&str>,
            ) {
                let response = oauth_callback_page::http_response(status, kind, detail);
                let _ = stream.write_all(response.as_bytes()).await;
            }

            // Prefer `code` when present so an empty/spurious `error` cannot cancel a grant.
            let code = query
                .get("code")
                .map(String::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_owned);
            let Some(code) = code else {
                let error = query
                    .get("error")
                    .map(String::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .unwrap_or("access_denied");
                let description = query.get("error_description").map(String::as_str);
                let subcode = query.get("error_subcode").map(String::as_str);
                let message = classify_authorization_error(error, description, subcode);
                let kind = if is_user_cancel_error(error, subcode, description) {
                    PageKind::Denied
                } else {
                    // Do not show "Sign-in cancelled" for config/policy failures.
                    PageKind::Failed
                };
                reply(&mut stream, "400 Bad Request", kind, Some(&message)).await;
                return Err(message);
            };
            match self
                .finish_authorization(&client_id, &redirect_uri, &verifier, &tenant, &code)
                .await
            {
                Ok(connected) => {
                    reply(&mut stream, "200 OK", PageKind::Success, None).await;
                    Ok(connected)
                }
                Err(error) => {
                    reply(
                        &mut stream,
                        "500 Internal Server Error",
                        PageKind::Failed,
                        Some(&error),
                    )
                    .await;
                    Err(error)
                }
            }
        }
    }

    async fn finish_authorization(
        &self,
        client_id: &str,
        redirect_uri: &str,
        verifier: &str,
        tenant: &str,
        code: &str,
    ) -> Result<MicrosoftConnectedAccount, String> {
        let token = self
            .exchange_code(client_id, redirect_uri, verifier, tenant, code)
            .await?;
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
        for required in ["Mail.ReadWrite", "Mail.Send"] {
            if !scope_granted(&scope, required) {
                return Err("Microsoft did not grant the required delegated mail scopes".into());
            }
        }
        let refresh_token = token
            .refresh_token
            .ok_or_else(|| "Microsoft did not issue an offline refresh token".to_string())?;
        let bundle = TokenBundle {
            access_token: token.access_token,
            refresh_token,
            expires_at: unix_time().saturating_add(token.expires_in.unwrap_or(3600)),
            scope: scope.clone(),
            tenant: tenant.to_string(),
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
            tenant: tenant.to_string(),
            granted_scopes: scope.split_whitespace().map(str::to_string).collect(),
        })
    }

    async fn exchange_code(
        &self,
        client_id: &str,
        redirect_uri: &str,
        verifier: &str,
        tenant: &str,
        code: &str,
    ) -> Result<TokenResponse, String> {
        let body = url::form_urlencoded::Serializer::new(String::new())
            .append_pair("client_id", client_id)
            .append_pair("redirect_uri", redirect_uri)
            .append_pair("code_verifier", verifier)
            .append_pair("code", code)
            .append_pair("scope", SCOPES)
            .append_pair("grant_type", "authorization_code")
            .finish();
        let response = self
            .http
            .post(format!(
                "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
            ))
            .header("content-type", "application/x-www-form-urlencoded")
            .body(body)
            .send()
            .await
            .map_err(|_| "cannot reach the Microsoft token endpoint".to_string())?;
        let status = response.status();
        let payload: serde_json::Value = response
            .json()
            .await
            .map_err(|_| "Microsoft token response was invalid".to_string())?;
        if !status.is_success() {
            let err = payload
                .get("error")
                .and_then(|value| value.as_str())
                .unwrap_or("token_exchange_failed");
            let description = payload
                .get("error_description")
                .and_then(|value| value.as_str())
                .unwrap_or_default();
            return Err(classify_token_error(err, description));
        }
        serde_json::from_value(payload)
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

fn scope_granted(granted_scope: &str, required: &str) -> bool {
    let required_short = required
        .trim_start_matches("https://graph.microsoft.com/")
        .trim();
    granted_scope.split_whitespace().any(|granted| {
        let granted_short = granted
            .trim_start_matches("https://graph.microsoft.com/")
            .trim();
        granted.eq_ignore_ascii_case(required) || granted_short.eq_ignore_ascii_case(required_short)
    })
}

#[cfg_attr(target_os = "ios", allow(dead_code))]
fn is_user_cancel_error(error: &str, subcode: Option<&str>, description: Option<&str>) -> bool {
    let sub = subcode.unwrap_or("").to_lowercase();
    if sub.contains("cancel") {
        return true;
    }
    let description = description.unwrap_or("").to_lowercase();
    error.eq_ignore_ascii_case("access_denied")
        && (description.contains("user canceled")
            || description.contains("user cancelled")
            || description.contains("the user canceled")
            || description.contains("the user cancelled"))
}

fn classify_authorization_error(
    error: &str,
    description: Option<&str>,
    subcode: Option<&str>,
) -> String {
    let description = description.unwrap_or_default();
    let text = format!("{error} {description} {}", subcode.unwrap_or_default()).to_lowercase();
    if text.contains("cancel")
        || (error.eq_ignore_ascii_case("access_denied") && text.contains("canceled"))
    {
        "Microsoft sign-in was cancelled".into()
    } else if text.contains("admin") || text.contains("authorization_requestdenied") {
        "Microsoft administrator consent is required".into()
    } else if text.contains("conditional") || text.contains("aadsts53000") {
        "Microsoft conditional access requires interaction".into()
    } else if text.contains("consent") {
        "Microsoft user consent is required".into()
    } else if text.contains("aadsts7000218") || text.contains("client_secret") {
        "Microsoft public-client flow is disabled for this app registration".into()
    } else if text.contains("aadsts50011")
        || text.contains("reply url")
        || text.contains("redirect")
    {
        "Microsoft redirect URI is not registered (desktop: http://127.0.0.1/…; iOS: msauth.com.galateacorp.mail://auth)"
            .into()
    } else if text.contains("origin") || text.contains("spa") || text.contains("aadsts900232") {
        "Microsoft redirect URI is registered as SPA; use Mobile and desktop + loopback / msauth redirect"
            .into()
    } else {
        // Surface the provider code so generic failures are not mistaken for cancel.
        let detail = description.split(". ").next().unwrap_or(description).trim();
        if detail.is_empty() {
            format!("Microsoft authorization failed ({error})")
        } else {
            format!("Microsoft authorization failed ({error}: {detail})")
        }
    }
}

fn classify_token_error(error: &str, description: &str) -> String {
    let text = format!("{error} {description}").to_lowercase();
    if text.contains("aadsts7000218") || text.contains("client_secret") {
        "Microsoft public-client flow is disabled for this app registration (enable Allow public client flows)"
            .into()
    } else if text.contains("origin") || text.contains("spa") || text.contains("aadsts900232") {
        "Microsoft rejected the code because the redirect URI is typed as SPA, not Mobile and desktop"
            .into()
    } else {
        format!("Microsoft rejected the authorization code ({error})")
    }
}

fn build_microsoft_auth_url(
    client_id: &str,
    tenant: &str,
    redirect_uri: &str,
    challenge: &str,
    state: &str,
) -> Result<String, String> {
    let endpoint = format!("https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize");
    let mut url = Url::parse(&endpoint).map_err(|_| "invalid Microsoft OAuth endpoint")?;
    url.query_pairs_mut()
        .append_pair("client_id", client_id)
        .append_pair("redirect_uri", redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("response_mode", "query")
        .append_pair("scope", SCOPES)
        .append_pair("prompt", "select_account")
        .append_pair("code_challenge", challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", state);
    Ok(url.to_string())
}

#[cfg(not(target_os = "ios"))]
fn open_system_browser(url: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(url)
            .spawn()
            .map_err(|_| "cannot open the system browser for Microsoft sign-in".to_string())?;
        return Ok(());
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = url;
        Err("system browser handoff is only implemented on Apple platforms".into())
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

    #[test]
    fn cancel_vs_config_errors_are_not_collapsed() {
        assert!(is_user_cancel_error(
            "access_denied",
            Some("cancel"),
            Some("the user canceled the authentication"),
        ));
        assert!(!is_user_cancel_error(
            "invalid_request",
            None,
            Some("AADSTS9002326: Cross-origin token redemption"),
        ));
        let spa = classify_authorization_error(
            "invalid_request",
            Some("AADSTS9002326: Cross-origin token redemption is permitted only for SPA"),
            None,
        );
        assert!(spa.contains("SPA") || spa.contains("Mobile and desktop"));
        assert!(!spa.contains("was denied"));
    }
}
