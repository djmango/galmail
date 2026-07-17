use galmail_core::{
    crypto,
    database::EncryptedDatabase,
    keys::{VaultKey, KEY_LEN},
};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::Path,
};
use zeroize::Zeroize;

const DATABASE_FILE: &str = "galmail.db";
const WRAPPED_VAULT_FILE: &str = "vault-key.gmae";
const WRAP_AAD: &[u8] = b"galmail/device-vault-wrap/v1";

pub trait DeviceKeyStore {
    fn load(&self) -> Result<Option<[u8; KEY_LEN]>, String>;
    fn store(&self, key: &[u8; KEY_LEN]) -> Result<(), String>;
}

pub trait SecureTokenStore: Send + Sync {
    fn load_token(&self, account_id: &str) -> Result<Option<Vec<u8>>, String>;
    fn store_token(&self, account_id: &str, value: &[u8]) -> Result<(), String>;
    fn delete_token(&self, account_id: &str) -> Result<(), String>;
    /// Account IDs present in the OAuth Keychain service (never includes token bytes).
    fn list_account_ids(&self) -> Result<Vec<String>, String>;
}

pub fn open_or_create(
    data_directory: &Path,
    device_keys: &impl DeviceKeyStore,
) -> Result<EncryptedDatabase, String> {
    fs::create_dir_all(data_directory)
        .map_err(|_| "cannot create app data directory".to_string())?;
    let database_path = data_directory.join(DATABASE_FILE);
    let wrapped_path = data_directory.join(WRAPPED_VAULT_FILE);

    let vault_key = if wrapped_path.exists() {
        let mut device_key = device_keys
            .load()?
            .ok_or_else(|| "vault wrapping key is missing from Keychain".to_string())?;
        let envelope =
            fs::read(&wrapped_path).map_err(|_| "cannot read wrapped vault key".to_string())?;
        if envelope.len() > 1024 {
            device_key.zeroize();
            return Err("wrapped vault key is invalid".into());
        }
        let plaintext = crypto::open(&envelope, &device_key, WRAP_AAD)
            .map_err(|_| "wrapped vault key failed authentication".to_string())?;
        device_key.zeroize();
        let bytes: [u8; KEY_LEN] = plaintext
            .try_into()
            .map_err(|_| "wrapped vault key has invalid length".to_string())?;
        VaultKey::from_bytes(bytes)
    } else {
        if database_path.exists() {
            return Err("encrypted database exists without its wrapped vault key".into());
        }
        let mut device_key = match device_keys.load()? {
            Some(key) => key,
            None => {
                let mut key = [0_u8; KEY_LEN];
                getrandom::fill(&mut key)
                    .map_err(|_| "operating system RNG unavailable".to_string())?;
                device_keys.store(&key)?;
                key
            }
        };
        let vault_key = VaultKey::generate().map_err(|error| error.to_string())?;
        let envelope = crypto::seal(vault_key.expose(), &device_key, WRAP_AAD)
            .map_err(|error| error.to_string())?;
        device_key.zeroize();
        write_private_atomic(&wrapped_path, &envelope)?;
        vault_key
    };

    EncryptedDatabase::open(database_path, &vault_key).map_err(|error| error.to_string())
}

fn write_private_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let temporary = path.with_extension("tmp");
    let mut options = OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&temporary)
        .map_err(|_| "cannot create wrapped vault key".to_string())?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|_| "cannot persist wrapped vault key".to_string())?;
    fs::rename(&temporary, path).map_err(|_| "cannot install wrapped vault key".to_string())?;
    Ok(())
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
pub struct MacOsKeychain;

#[cfg(any(target_os = "macos", target_os = "ios"))]
impl MacOsKeychain {
    const SERVICE: &'static str = "com.galmail.app.vault";
    const ACCOUNT: &'static str = "device-wrap-key-v1";
}

/// Debug-only: attach a classic Keychain ACL that allows any application.
///
/// `tauri:dev` binaries are normally ad-hoc signed; each rebuild gets a new
/// code directory hash, so the default creator-only ACL re-prompts forever.
/// Production / notarized builds keep the default app-bound ACL (this helper
/// is compiled out of release builds).
#[cfg(all(debug_assertions, target_os = "macos"))]
fn apply_debug_allow_all_apps_acl(
    options: &mut security_framework::passwords::PasswordOptions,
) {
    use core_foundation::base::TCFType;
    use core_foundation::string::{CFString, CFStringRef};
    use security_framework::os::macos::access::SecAccess;
    use security_framework_sys::base::SecAccessRef;
    use std::os::raw::c_void;
    use std::ptr;

    type OSStatus = i32;

    #[link(name = "Security", kind = "framework")]
    extern "C" {
        fn SecAccessCreate(
            descriptor: CFStringRef,
            trusted_list: *const c_void,
            access_ref: *mut SecAccessRef,
        ) -> OSStatus;
        static kSecAttrAccess: CFStringRef;
    }

    unsafe {
        let mut access_ref: SecAccessRef = ptr::null_mut();
        let descriptor = CFString::new("GalMail debug");
        // NULL trusted list ⇒ allow all applications (local debug only).
        let status = SecAccessCreate(
            descriptor.as_concrete_TypeRef(),
            ptr::null(),
            &mut access_ref,
        );
        if status != 0 || access_ref.is_null() {
            return;
        }
        let access = SecAccess::wrap_under_create_rule(access_ref);
        #[allow(deprecated)]
        options.query.push((
            CFString::wrap_under_get_rule(kSecAttrAccess),
            access.into_CFType(),
        ));
    }
}

#[cfg(all(debug_assertions, target_os = "macos"))]
fn store_generic_password_debug_friendly(
    service: &str,
    account: &str,
    value: &[u8],
    label: &str,
    description: &str,
) -> Result<(), String> {
    use security_framework::passwords::{
        delete_generic_password, set_generic_password_options, PasswordOptions,
    };
    // Delete first so SecItemAdd applies the new ACL (SecItemUpdate won't).
    let _ = delete_generic_password(service, account);
    let mut options = PasswordOptions::new_generic_password(service, account);
    options.set_access_synchronized(Some(false));
    options.set_label(label);
    options.set_description(description);
    apply_debug_allow_all_apps_acl(&mut options);
    set_generic_password_options(value, options).map_err(|error| {
        format!(
            "cannot store credentials in Keychain (code {})",
            error.code()
        )
    })
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
impl DeviceKeyStore for MacOsKeychain {
    fn load(&self) -> Result<Option<[u8; KEY_LEN]>, String> {
        use security_framework::passwords::{generic_password, PasswordOptions};
        let mut options = PasswordOptions::new_generic_password(Self::SERVICE, Self::ACCOUNT);
        options.set_access_synchronized(Some(false));
        match generic_password(options) {
            Ok(bytes) => {
                let key: [u8; KEY_LEN] = bytes
                    .try_into()
                    .map_err(|_| "Keychain vault wrapping key has invalid length".to_string())?;
                // One-time rewrite under debug ACL so later ad-hoc rebuilds don't prompt.
                #[cfg(all(debug_assertions, target_os = "macos"))]
                {
                    let _ = store_generic_password_debug_friendly(
                        Self::SERVICE,
                        Self::ACCOUNT,
                        &key,
                        "GalMail vault wrapping key",
                        "Wraps the local GalMail vault key; never synchronized",
                    );
                }
                Ok(Some(key))
            }
            Err(error) if error.code() == -25300 => Ok(None),
            Err(_) => Err("cannot read vault wrapping key from Keychain".into()),
        }
    }

    fn store(&self, key: &[u8; KEY_LEN]) -> Result<(), String> {
        #[cfg(all(debug_assertions, target_os = "macos"))]
        {
            return store_generic_password_debug_friendly(
                Self::SERVICE,
                Self::ACCOUNT,
                key,
                "GalMail vault wrapping key",
                "Wraps the local GalMail vault key; never synchronized",
            )
            .map_err(|_| "cannot store vault wrapping key in Keychain".into());
        }
        #[cfg(not(all(debug_assertions, target_os = "macos")))]
        {
            use security_framework::passwords::{set_generic_password_options, PasswordOptions};
            let mut options = PasswordOptions::new_generic_password(Self::SERVICE, Self::ACCOUNT);
            options.set_access_synchronized(Some(false));
            options.set_label("GalMail vault wrapping key");
            options.set_description("Wraps the local GalMail vault key; never synchronized");
            set_generic_password_options(key, options)
                .map_err(|_| "cannot store vault wrapping key in Keychain".into())
        }
    }
}

/// Provider-neutral OAuth token Keychain service (Gmail + Microsoft accountIds).
/// Vault wrapping key uses `com.galmail.app.vault` — do not conflate.
pub const OAUTH_KEYCHAIN_SERVICE: &str = "com.galmail.app.oauth";
/// Legacy service name; dual-read + one-time migrate into [`OAUTH_KEYCHAIN_SERVICE`].
pub const OAUTH_KEYCHAIN_SERVICE_LEGACY: &str = "com.galmail.app.gmail-oauth";

#[cfg(any(target_os = "macos", target_os = "ios"))]
fn oauth_password_options(service: &str, account_id: &str) -> security_framework::passwords::PasswordOptions {
    use security_framework::passwords::PasswordOptions;
    let mut options = PasswordOptions::new_generic_password(service, account_id);
    options.set_access_synchronized(Some(false));
    options
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
fn load_oauth_bytes(service: &str, account_id: &str) -> Result<Option<Vec<u8>>, String> {
    use security_framework::passwords::generic_password;
    match generic_password(oauth_password_options(service, account_id)) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.code() == -25300 => Ok(None),
        Err(_) => Err("cannot read OAuth credentials from Keychain".into()),
    }
}

/// Copy a legacy Keychain item into the new service, then delete the old entry.
#[cfg(any(target_os = "macos", target_os = "ios"))]
fn migrate_oauth_item_from_legacy(account_id: &str) -> Result<Option<Vec<u8>>, String> {
    use security_framework::passwords::delete_generic_password;
    let Some(bytes) = load_oauth_bytes(OAUTH_KEYCHAIN_SERVICE_LEGACY, account_id)? else {
        return Ok(None);
    };
    store_oauth_bytes(OAUTH_KEYCHAIN_SERVICE, account_id, &bytes)?;
    let _ = delete_generic_password(OAUTH_KEYCHAIN_SERVICE_LEGACY, account_id);
    Ok(Some(bytes))
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
fn store_oauth_bytes(service: &str, account_id: &str, value: &[u8]) -> Result<(), String> {
    #[cfg(all(debug_assertions, target_os = "macos"))]
    {
        store_generic_password_debug_friendly(
            service,
            account_id,
            value,
            "GalMail OAuth authorization",
            "Provider OAuth tokens; never synchronized",
        )?;
        return Ok(());
    }
    #[cfg(not(all(debug_assertions, target_os = "macos")))]
    {
        use security_framework::passwords::{
            delete_generic_password, set_generic_password_options, PasswordOptions,
        };
        let _ = delete_generic_password(service, account_id);
        let mut options = PasswordOptions::new_generic_password(service, account_id);
        options.set_access_synchronized(Some(false));
        options.set_label("GalMail OAuth authorization");
        options.set_description("Provider OAuth tokens; never synchronized");
        set_generic_password_options(value, options).map_err(|error| {
            format!(
                "cannot store OAuth credentials in Keychain (code {})",
                error.code()
            )
        })
    }
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
fn list_oauth_accounts_for_service(service: &str) -> Result<Vec<String>, String> {
    use security_framework::item::{ItemClass, ItemSearchOptions, Limit, SearchResult};
    let results = match ItemSearchOptions::new()
        .class(ItemClass::generic_password())
        .service(service)
        .load_attributes(true)
        .load_data(false)
        .limit(Limit::All)
        .search()
    {
        Ok(items) => items,
        Err(error) if error.code() == -25300 => return Ok(vec![]),
        Err(_) => return Err("cannot enumerate OAuth Keychain accounts".into()),
    };
    let mut ids = Vec::new();
    for item in results {
        let SearchResult::Dict(_) = &item else {
            continue;
        };
        let Some(map) = item.simplify_dict() else {
            continue;
        };
        // kSecAttrAccount is exposed as "acct" in simplified dicts.
        let account = map
            .get("acct")
            .or_else(|| map.get("Account"))
            .cloned()
            .unwrap_or_default();
        if account.starts_with("gmail:") || account.starts_with("microsoft:") {
            ids.push(account);
        }
    }
    Ok(ids)
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
impl SecureTokenStore for MacOsKeychain {
    fn load_token(&self, account_id: &str) -> Result<Option<Vec<u8>>, String> {
        if let Some(bytes) = load_oauth_bytes(OAUTH_KEYCHAIN_SERVICE, account_id)? {
            // Rewrite under debug ACL after a successful read (one prompt, then quiet).
            #[cfg(all(debug_assertions, target_os = "macos"))]
            {
                let _ = store_oauth_bytes(OAUTH_KEYCHAIN_SERVICE, account_id, &bytes);
            }
            return Ok(Some(bytes));
        }
        // Dual-read legacy service; migrate on hit so upgrades keep tokens.
        migrate_oauth_item_from_legacy(account_id)
    }

    fn store_token(&self, account_id: &str, value: &[u8]) -> Result<(), String> {
        use security_framework::passwords::delete_generic_password;
        // New writes only go to the provider-neutral service.
        let _ = delete_generic_password(OAUTH_KEYCHAIN_SERVICE_LEGACY, account_id);
        store_oauth_bytes(OAUTH_KEYCHAIN_SERVICE, account_id, value)
    }

    fn delete_token(&self, account_id: &str) -> Result<(), String> {
        use security_framework::passwords::delete_generic_password;
        for service in [OAUTH_KEYCHAIN_SERVICE, OAUTH_KEYCHAIN_SERVICE_LEGACY] {
            match delete_generic_password(service, account_id) {
                Ok(()) => {}
                Err(error) if error.code() == -25300 => {}
                Err(_) => {
                    return Err("cannot remove OAuth credentials from Keychain".into());
                }
            }
        }
        Ok(())
    }

    fn list_account_ids(&self) -> Result<Vec<String>, String> {
        let mut ids = list_oauth_accounts_for_service(OAUTH_KEYCHAIN_SERVICE)?;
        let legacy = list_oauth_accounts_for_service(OAUTH_KEYCHAIN_SERVICE_LEGACY)?;
        for account_id in &legacy {
            // Migrate without logging token contents.
            let _ = migrate_oauth_item_from_legacy(account_id)?;
            if !ids.iter().any(|id| id == account_id) {
                ids.push(account_id.clone());
            }
        }
        ids.sort();
        ids.dedup();
        Ok(ids)
    }
}

#[cfg(not(any(target_os = "macos", target_os = "ios")))]
pub struct MacOsKeychain;

#[cfg(not(any(target_os = "macos", target_os = "ios")))]
impl DeviceKeyStore for MacOsKeychain {
    fn load(&self) -> Result<Option<[u8; KEY_LEN]>, String> {
        Err("Apple Keychain is unavailable on this platform".into())
    }

    fn store(&self, _key: &[u8; KEY_LEN]) -> Result<(), String> {
        Err("Apple Keychain is unavailable on this platform".into())
    }
}

#[cfg(not(any(target_os = "macos", target_os = "ios")))]
impl SecureTokenStore for MacOsKeychain {
    fn load_token(&self, _account_id: &str) -> Result<Option<Vec<u8>>, String> {
        Err("macOS Keychain is unavailable on this platform".into())
    }

    fn store_token(&self, _account_id: &str, _value: &[u8]) -> Result<(), String> {
        Err("macOS Keychain is unavailable on this platform".into())
    }

    fn delete_token(&self, _account_id: &str) -> Result<(), String> {
        Err("macOS Keychain is unavailable on this platform".into())
    }

    fn list_account_ids(&self) -> Result<Vec<String>, String> {
        Err("macOS Keychain is unavailable on this platform".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;
    use tempfile::tempdir;

    #[derive(Default)]
    struct MemoryKeyStore(Mutex<Option<[u8; KEY_LEN]>>);

    impl DeviceKeyStore for MemoryKeyStore {
        fn load(&self) -> Result<Option<[u8; KEY_LEN]>, String> {
            Ok(*self.0.lock().unwrap())
        }

        fn store(&self, key: &[u8; KEY_LEN]) -> Result<(), String> {
            *self.0.lock().unwrap() = Some(*key);
            Ok(())
        }
    }

    #[test]
    fn wrapped_vault_survives_restart() {
        let directory = tempdir().unwrap();
        let keys = MemoryKeyStore::default();
        {
            let database = open_or_create(directory.path(), &keys).unwrap();
            database
                .put_record("gmail:a", "message", "m1", b"durable")
                .unwrap();
        }
        let database = open_or_create(directory.path(), &keys).unwrap();
        assert_eq!(
            database
                .get_record("gmail:a", "message", "m1")
                .unwrap()
                .unwrap(),
            b"durable"
        );
    }

    #[test]
    fn tampered_wrap_and_wrong_device_key_fail_closed() {
        let directory = tempdir().unwrap();
        let keys = MemoryKeyStore::default();
        drop(open_or_create(directory.path(), &keys).unwrap());
        let wrapped_path = directory.path().join(WRAPPED_VAULT_FILE);
        let mut wrapped = fs::read(&wrapped_path).unwrap();
        let last = wrapped.len() - 1;
        wrapped[last] ^= 1;
        fs::write(&wrapped_path, wrapped).unwrap();
        assert!(open_or_create(directory.path(), &keys).is_err());

        let wrong_keys = MemoryKeyStore(Mutex::new(Some([99; KEY_LEN])));
        assert!(open_or_create(directory.path(), &wrong_keys).is_err());
    }

    #[test]
    fn database_without_wrap_never_regenerates_keys() {
        let directory = tempdir().unwrap();
        let keys = MemoryKeyStore::default();
        drop(open_or_create(directory.path(), &keys).unwrap());
        fs::remove_file(directory.path().join(WRAPPED_VAULT_FILE)).unwrap();
        assert!(open_or_create(directory.path(), &keys).is_err());
    }

    #[test]
    fn oauth_keychain_service_is_provider_neutral_and_distinct_from_vault() {
        assert_eq!(OAUTH_KEYCHAIN_SERVICE, "com.galmail.app.oauth");
        assert_eq!(OAUTH_KEYCHAIN_SERVICE_LEGACY, "com.galmail.app.gmail-oauth");
        assert_ne!(OAUTH_KEYCHAIN_SERVICE, OAUTH_KEYCHAIN_SERVICE_LEGACY);
        assert_ne!(OAUTH_KEYCHAIN_SERVICE, "com.galmail.app.vault");
        assert_ne!(OAUTH_KEYCHAIN_SERVICE_LEGACY, "com.galmail.app.vault");
        // Extension vault service must not be renamed by this migration.
        assert_ne!(OAUTH_KEYCHAIN_SERVICE, "com.galateacorp.mail.vault");
    }
}
