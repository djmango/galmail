//! iOS OAuth handoff via ASWebAuthenticationSession + custom URL schemes.
//!
//! Desktop keeps loopback TCP (`oauth_callback_page`). This module never binds
//! localhost; Swift presents the auth session and delivers the callback URL to
//! Rust for PKCE token exchange.

use std::collections::HashMap;
#[cfg(target_os = "ios")]
use std::{sync::Mutex, time::Duration};
#[cfg(target_os = "ios")]
use tokio::sync::oneshot;
use url::Url;

/// Microsoft Entra Mobile and desktop redirect for iOS (MSAL-compatible).
pub const MICROSOFT_REDIRECT_URI: &str = "msauth.com.galateacorp.mail://auth";
/// Scheme portion of [`MICROSOFT_REDIRECT_URI`] for ASWebAuthenticationSession.
pub const MICROSOFT_CALLBACK_SCHEME: &str = "msauth.com.galateacorp.mail";

/// Google iOS redirect using the reverse client ID custom scheme.
///
/// Format: `com.googleusercontent.apps.{CLIENT_ID_PREFIX}:/oauthredirect`
/// where `CLIENT_ID` is `{PREFIX}.apps.googleusercontent.com`.
pub fn google_redirect_uri(client_id: &str) -> Result<String, String> {
    let scheme = google_callback_scheme(client_id)?;
    Ok(format!("{scheme}:/oauthredirect"))
}

/// ASWebAuthenticationSession `callbackURLScheme` for a Google iOS client ID.
pub fn google_callback_scheme(client_id: &str) -> Result<String, String> {
    let client_id = client_id.trim();
    let prefix = client_id
        .strip_suffix(".apps.googleusercontent.com")
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            "Google iOS OAuth requires an iOS client ID ending in .apps.googleusercontent.com"
                .to_string()
        })?;
    if !prefix
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || character == '-')
    {
        return Err("Google client ID prefix is invalid".into());
    }
    Ok(format!("com.googleusercontent.apps.{prefix}"))
}

/// Parse OAuth params from a custom-scheme redirect URL (query, else fragment).
///
/// Google/AppAuth use `scheme:/oauthredirect?code=…&state=…`. Some providers
/// historically put the response in the fragment; accept both so a missing
/// query does not look like a silent cancel.
pub fn parse_callback_query(callback_url: &str) -> Result<HashMap<String, String>, String> {
    let trimmed = callback_url.trim();
    let parsed = Url::parse(trimmed).map_err(|_| {
        let scheme = trimmed.split(':').next().unwrap_or("unknown");
        format!("OAuth callback URL was invalid (scheme={scheme})")
    })?;
    let mut pairs: HashMap<String, String> = parsed.query_pairs().into_owned().collect();
    if pairs.is_empty() {
        if let Some(fragment) = parsed.fragment().filter(|value| !value.is_empty()) {
            pairs = url::form_urlencoded::parse(fragment.as_bytes())
                .into_owned()
                .collect();
        }
    }
    if pairs.is_empty() {
        return Err(
            "OAuth callback had no code/state (check redirect_uri matches Google Console iOS client)"
                .into(),
        );
    }
    Ok(pairs)
}

#[cfg(target_os = "ios")]
mod bridge {
    use super::*;
    use std::ffi::{CStr, CString};
    use std::os::raw::c_char;
    use std::sync::OnceLock;

    type WaiterMap = HashMap<String, oneshot::Sender<Result<String, String>>>;

    static WAITERS: OnceLock<Mutex<WaiterMap>> = OnceLock::new();

    fn waiters() -> &'static Mutex<WaiterMap> {
        WAITERS.get_or_init(|| Mutex::new(HashMap::new()))
    }

    /// Register a oneshot that `complete()` awaits for the ASWebAuthenticationSession URL.
    pub fn register_waiter(attempt_id: String) -> oneshot::Receiver<Result<String, String>> {
        let (sender, receiver) = oneshot::channel();
        if let Ok(mut map) = waiters().lock() {
            if let Some(previous) = map.insert(attempt_id, sender) {
                let _ = previous.send(Err("OAuth attempt was superseded".into()));
            }
        }
        receiver
    }

    fn deliver(attempt_id: &str, result: Result<String, String>) {
        let sender = waiters()
            .lock()
            .ok()
            .and_then(|mut map| map.remove(attempt_id));
        if let Some(sender) = sender {
            let _ = sender.send(result);
        }
    }

    /// Cancel a waiter if begin fails after registration (or attempt is abandoned).
    pub fn cancel_waiter(attempt_id: &str) {
        deliver(attempt_id, Err("OAuth presentation was cancelled".into()));
    }

    /// Start ASWebAuthenticationSession on the main thread (non-blocking).
    ///
    /// Looks up the Swift `@_cdecl` at runtime — cargo links the Rust lib
    /// before the app binary provides that symbol.
    pub fn present(
        authorization_url: &str,
        callback_scheme: &str,
        attempt_id: &str,
    ) -> Result<(), String> {
        type PresentFn = unsafe extern "C" fn(
            url: *const c_char,
            callback_scheme: *const c_char,
            attempt_id: *const c_char,
        ) -> bool;

        // Apple: RTLD_DEFAULT == (void *)-2 — search the process image list.
        extern "C" {
            fn dlsym(handle: *mut std::ffi::c_void, symbol: *const c_char)
                -> *mut std::ffi::c_void;
        }
        const RTLD_DEFAULT: *mut std::ffi::c_void = -2isize as *mut std::ffi::c_void;

        let present_fn: PresentFn = unsafe {
            let symbol = dlsym(RTLD_DEFAULT, c"galmail_ios_present_oauth".as_ptr());
            if symbol.is_null() {
                cancel_waiter(attempt_id);
                return Err("iOS OAuth presenter is unavailable in this build".into());
            }
            std::mem::transmute(symbol)
        };

        let url = CString::new(authorization_url)
            .map_err(|_| "OAuth URL contains an interior NUL".to_string())?;
        let scheme = CString::new(callback_scheme)
            .map_err(|_| "OAuth callback scheme contains an interior NUL".to_string())?;
        let attempt = CString::new(attempt_id)
            .map_err(|_| "OAuth attempt id contains an interior NUL".to_string())?;
        // SAFETY: pointers are valid C strings for the duration of the call.
        let started = unsafe { present_fn(url.as_ptr(), scheme.as_ptr(), attempt.as_ptr()) };
        if started {
            Ok(())
        } else {
            cancel_waiter(attempt_id);
            Err("cannot start the iOS OAuth session".into())
        }
    }

    pub async fn await_callback(
        receiver: oneshot::Receiver<Result<String, String>>,
        overall_timeout: Duration,
    ) -> Result<String, String> {
        match tokio::time::timeout(overall_timeout, receiver).await {
            Ok(Ok(Ok(url))) => Ok(url),
            Ok(Ok(Err(error))) => Err(error),
            Ok(Err(_)) => Err("OAuth callback channel closed".into()),
            Err(_) => Err("OAuth callback timed out".into()),
        }
    }

    /// Called from Swift when ASWebAuthenticationSession finishes.
    #[no_mangle]
    pub unsafe extern "C" fn galmail_ios_oauth_callback(
        attempt_id: *const c_char,
        callback_url: *const c_char,
        error_message: *const c_char,
    ) {
        if attempt_id.is_null() {
            return;
        }
        let attempt_id = unsafe { CStr::from_ptr(attempt_id) }
            .to_string_lossy()
            .into_owned();
        if !callback_url.is_null() {
            let url = unsafe { CStr::from_ptr(callback_url) }
                .to_string_lossy()
                .into_owned();
            if !url.trim().is_empty() {
                deliver(&attempt_id, Ok(url));
                return;
            }
        }
        let message = if error_message.is_null() {
            "OAuth sign-in was cancelled".to_string()
        } else {
            let text = unsafe { CStr::from_ptr(error_message) }
                .to_string_lossy()
                .into_owned();
            if text.trim().is_empty() {
                "OAuth sign-in was cancelled".into()
            } else {
                text
            }
        };
        deliver(&attempt_id, Err(message));
    }
}

#[cfg(target_os = "ios")]
pub use bridge::{await_callback, present, register_waiter};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn google_reverse_client_id_redirect() {
        let client = "123456789-abcdef.apps.googleusercontent.com";
        assert_eq!(
            google_callback_scheme(client).unwrap(),
            "com.googleusercontent.apps.123456789-abcdef"
        );
        assert_eq!(
            google_redirect_uri(client).unwrap(),
            "com.googleusercontent.apps.123456789-abcdef:/oauthredirect"
        );
    }

    #[test]
    fn google_rejects_non_google_client_ids() {
        assert!(google_callback_scheme("not-a-google-client").is_err());
        assert!(google_callback_scheme("").is_err());
    }

    #[test]
    fn parses_custom_scheme_callback_query() {
        let query =
            parse_callback_query("com.googleusercontent.apps.abc:/oauthredirect?code=xyz&state=s1")
                .unwrap();
        assert_eq!(query.get("code").map(String::as_str), Some("xyz"));
        assert_eq!(query.get("state").map(String::as_str), Some("s1"));
        let ms = parse_callback_query("msauth.com.galateacorp.mail://auth?code=ms&state=st&error=")
            .unwrap();
        assert_eq!(ms.get("code").map(String::as_str), Some("ms"));
        let fragment = parse_callback_query(
            "com.googleusercontent.apps.abc:/oauthredirect#code=frag&state=s2",
        )
        .unwrap();
        assert_eq!(fragment.get("code").map(String::as_str), Some("frag"));
        assert!(parse_callback_query("com.googleusercontent.apps.abc:/oauthredirect").is_err());
    }

    #[test]
    fn microsoft_constants_match_docs() {
        assert_eq!(MICROSOFT_REDIRECT_URI, "msauth.com.galateacorp.mail://auth");
        assert!(MICROSOFT_REDIRECT_URI.starts_with(MICROSOFT_CALLBACK_SCHEME));
    }
}
