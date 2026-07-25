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

/// Device vault wrap Keychain service. Must stay aligned with
/// `GalMailKeychainPolicy.rustDeviceVaultService` (enforced by
/// `scripts/keychain-contract.test.ts`).
#[cfg_attr(not(any(target_os = "macos", target_os = "ios")), allow(dead_code))]
pub const VAULT_KEYCHAIN_SERVICE: &str = "com.galmail.app.vault";
/// Account attribute for the device vault wrapping key.
#[cfg_attr(not(any(target_os = "macos", target_os = "ios")), allow(dead_code))]
pub const VAULT_KEYCHAIN_ACCOUNT: &str = "device-wrap-key-v1";
/// Extension vault service (Swift). Distinct from [`VAULT_KEYCHAIN_SERVICE`].
#[cfg_attr(not(any(target_os = "macos", target_os = "ios")), allow(dead_code))]
pub const EXTENSION_VAULT_KEYCHAIN_SERVICE: &str = "com.galateacorp.mail.vault";

#[cfg(any(target_os = "macos", target_os = "ios"))]
impl MacOsKeychain {
    const SERVICE: &'static str = VAULT_KEYCHAIN_SERVICE;
    const ACCOUNT: &'static str = VAULT_KEYCHAIN_ACCOUNT;
}

/// Shared Keychain access-group suffix (team prefix required at runtime).
#[cfg(any(target_os = "macos", target_os = "ios"))]
const KEYCHAIN_ACCESS_GROUP_SUFFIX: &str = "com.galateacorp.mail.keychain";

/// Apple Developer Team ID. Must match `TEAM_ID` in
/// `scripts/ios-archive-testflight.ts` and
/// `GalMailKeychainPolicy.appleTeamIdentifier`.
///
/// Keep this a compile-time constant. Looking up the team via private Security
/// task APIs links non-public symbols and App Store Connect rejects the IPA
/// (`altool` code 11).
#[cfg(any(target_os = "macos", target_os = "ios"))]
const APPLE_TEAM_IDENTIFIER: &str = "A95F4H2423";

#[cfg(any(target_os = "macos", target_os = "ios"))]
fn team_identifier() -> Option<&'static str> {
    Some(APPLE_TEAM_IDENTIFIER)
}

/// Ensure Keychain access groups include the Apple team prefix.
///
/// TestFlight builds have hit `$(AppIdentifierPrefix)` expanding to empty, so
/// Info.plist shipped `com.galateacorp.mail.keychain` without `A95F4H2423.`.
/// SecItemAdd then returns -34018 (errSecMissingEntitlement).
#[cfg(any(target_os = "macos", target_os = "ios"))]
fn normalize_keychain_access_group(raw: &str) -> Option<String> {
    let group = raw.trim();
    if group.is_empty() || group.contains("$(") {
        return None;
    }
    // Already `TEAMID.suffix`.
    if let Some((team, rest)) = group.split_once('.') {
        if team.len() == 10
            && team
                .chars()
                .all(|character| character.is_ascii_alphanumeric())
            && !rest.is_empty()
        {
            return Some(group.to_string());
        }
    }
    // Bare suffix (or other unprefixed value) — prepend the signing team.
    let suffix =
        if group == KEYCHAIN_ACCESS_GROUP_SUFFIX || group.ends_with(KEYCHAIN_ACCESS_GROUP_SUFFIX) {
            KEYCHAIN_ACCESS_GROUP_SUFFIX
        } else {
            group
        };
    let team = team_identifier()?;
    Some(format!("{team}.{suffix}"))
}

/// Shared Keychain access group from Info.plist (`GalMailKeychainAccessGroup`).
///
/// iOS entitlements require items in `$(AppIdentifierPrefix)com.galateacorp.mail.keychain`
/// so the app and notification/share extensions can share keys. Swift already sets this;
/// Rust must too or SecItemAdd fails on device (safe-mode / "database unavailable").
#[cfg(any(target_os = "macos", target_os = "ios"))]
fn keychain_access_group() -> Option<String> {
    use core_foundation::base::TCFType;
    use core_foundation::string::{CFString, CFStringRef};
    use std::os::raw::c_void;

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFBundleGetMainBundle() -> *mut c_void;
        fn CFBundleGetValueForInfoDictionaryKey(
            bundle: *mut c_void,
            key: CFStringRef,
        ) -> *const c_void;
    }

    let from_plist = unsafe {
        let bundle = CFBundleGetMainBundle();
        if bundle.is_null() {
            None
        } else {
            let key = CFString::new("GalMailKeychainAccessGroup");
            let value = CFBundleGetValueForInfoDictionaryKey(bundle, key.as_concrete_TypeRef());
            if value.is_null() {
                None
            } else {
                let cf_string = CFString::wrap_under_get_rule(value as CFStringRef);
                Some(cf_string.to_string())
            }
        }
    };
    if let Some(raw) = from_plist.as_deref() {
        if let Some(group) = normalize_keychain_access_group(raw) {
            return Some(group);
        }
    }
    // Info.plist missing/unsubstituted — still try team + canonical suffix.
    let team = team_identifier()?;
    Some(format!("{team}.{KEYCHAIN_ACCESS_GROUP_SUFFIX}"))
}

/// Do not attempt Keychain auth UI (avoids -25308 at cold start).
/// Search-only property — never put this on SecItemUpdate/Delete identity queries.
#[cfg(any(target_os = "macos", target_os = "ios"))]
fn set_authentication_ui_skip(options: &mut security_framework::passwords::PasswordOptions) {
    use core_foundation::base::TCFType;
    use core_foundation::string::CFString;
    use security_framework_sys::item::{kSecUseAuthenticationUI, kSecUseAuthenticationUISkip};

    #[allow(deprecated)]
    options.query.push((
        unsafe { CFString::wrap_under_get_rule(kSecUseAuthenticationUI) },
        unsafe { CFString::wrap_under_get_rule(kSecUseAuthenticationUISkip).into_CFType() },
    ));
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
fn keychain_status_message(action: &str, code: i32) -> String {
    match code {
        -25308 => format!(
            "{action} failed (Keychain status {code}: unlock the device and reopen GalMail)"
        ),
        -34018 => {
            format!("{action} failed (Keychain status {code}: access group entitlement missing)")
        }
        -25300 => format!("{action} failed (Keychain status {code}: item not found)"),
        -25299 => format!("{action} failed (Keychain status {code}: duplicate item)"),
        _ => format!("{action} failed (Keychain status {code})"),
    }
}

/// Soft Keychain misses on **reads**: try another view / retry.
#[cfg_attr(not(any(target_os = "macos", target_os = "ios")), allow(dead_code))]
fn keychain_soft_miss(code: i32) -> bool {
    code == -25300 || code == -34018 || code == -25308
}

/// Identity-only generic-password query: `kSecClass` + service + account.
///
/// Apple SecItem: Fundamentals — uniqueness for generic passwords is class /
/// service / account (plus access group / synchronizable when present). Putting
/// `kSecAttrAccessible`, label, description, or `kSecUse*` flags into Update /
/// Delete queries filters the match and produces the classic
/// `errSecDuplicateItem` then `errSecItemNotFound` (-25300) on store.
#[cfg(any(target_os = "macos", target_os = "ios"))]
fn identity_password_options(
    service: &str,
    account: &str,
) -> security_framework::passwords::PasswordOptions {
    use security_framework::passwords::PasswordOptions;
    let mut options = PasswordOptions::new_generic_password(service, account);
    set_authentication_ui_skip(&mut options);
    options
}

/// Read variants: app-default identity, then shared-group identity (migration).
#[cfg(any(target_os = "macos", target_os = "ios"))]
fn read_password_variants(
    service: &str,
    account: &str,
) -> Vec<security_framework::passwords::PasswordOptions> {
    let mut variants = Vec::with_capacity(2);
    variants.push(identity_password_options(service, account));
    if let Some(group) = keychain_access_group() {
        let mut with_group = identity_password_options(service, account);
        with_group.set_access_group(&group);
        variants.push(with_group);
    }
    variants
}

/// Survives Release strip so the IPA gate can prove this store path shipped.
/// Do not rename without updating `scripts/ios-archive-testflight.ts` + contract tests.
#[cfg(any(target_os = "macos", target_os = "ios"))]
#[used]
#[no_mangle]
static galmail_keychain_store_v3: [u8; 47] = *b"GALMAIL_KEYCHAIN_STORE_V3_PURGE_THEN_ADD_IDENT\0";

/// Store app-private generic password: purge-by-identity, then SecItemAdd.
///
/// **Never** call `security_framework::passwords::set_generic_password_options`.
/// That helper's Add→Update path puts `kSecAttrAccessible` in the Update query
/// and returns -25300 when leftovers from earlier builds don't match.
///
/// Prefer-Update is also unsafe here after many failed TestFlight attempts:
/// class+service+account can match multiple leftovers (access group / sync
/// variants) and SecItemUpdate then fails with errSecDuplicateItem / -25300.
///
/// Contract (source + IPA):
/// 1. Delete queries = identity only (never accessible/label/description)
/// 2. Purge default group + shared extension group + synchronizableAny
/// 3. SecItemAdd once with accessible + synchronizable=false; no access group
/// 4. On duplicate: purge again and Add once more — never Update with fat query
#[cfg(any(target_os = "macos", target_os = "ios"))]
fn store_app_private_generic_password(
    service: &str,
    account: &str,
    value: &[u8],
    label: &str,
    description: &str,
) -> Result<(), String> {
    use core_foundation::base::TCFType;
    use core_foundation::boolean::CFBoolean;
    use core_foundation::data::CFData;
    use core_foundation::dictionary::CFDictionary;
    use core_foundation::string::{CFString, CFStringRef};
    use security_framework_sys::access_control::kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly;
    use security_framework_sys::base::{errSecDuplicateItem, errSecSuccess};
    use security_framework_sys::item::{
        kSecAttrAccessGroup, kSecAttrAccount, kSecAttrDescription, kSecAttrLabel, kSecAttrService,
        kSecAttrSynchronizable, kSecAttrSynchronizableAny, kSecClass, kSecClassGenericPassword,
        kSecValueData,
    };
    use security_framework_sys::keychain_item::{SecItemAdd, SecItemDelete};

    #[link(name = "Security", kind = "framework")]
    extern "C" {
        static kSecAttrAccessible: CFStringRef;
    }

    // Keep the #[used] marker reachable from this fn (and prove V3 in source).
    let _ = galmail_keychain_store_v3[0];
    const _SOURCE_MARKER: &str = "GALMAIL_KEYCHAIN_STORE_V3_PURGE_THEN_ADD_IDENT";
    let _ = _SOURCE_MARKER;

    unsafe {
        let service_cf = CFString::new(service);
        let account_cf = CFString::new(account);
        let class = CFString::wrap_under_get_rule(kSecClassGenericPassword);
        let sync_any = CFString::wrap_under_get_rule(kSecAttrSynchronizableAny);

        let delete_query = |access_group: Option<&CFString>, use_sync_any: bool| {
            if let Some(group) = access_group {
                if use_sync_any {
                    let query = CFDictionary::from_CFType_pairs(&[
                        (CFString::wrap_under_get_rule(kSecClass), class.as_CFType()),
                        (
                            CFString::wrap_under_get_rule(kSecAttrService),
                            service_cf.as_CFType(),
                        ),
                        (
                            CFString::wrap_under_get_rule(kSecAttrAccount),
                            account_cf.as_CFType(),
                        ),
                        (
                            CFString::wrap_under_get_rule(kSecAttrAccessGroup),
                            group.as_CFType(),
                        ),
                        (
                            CFString::wrap_under_get_rule(kSecAttrSynchronizable),
                            sync_any.as_CFType(),
                        ),
                    ]);
                    let _ = SecItemDelete(query.as_concrete_TypeRef());
                } else {
                    let query = CFDictionary::from_CFType_pairs(&[
                        (CFString::wrap_under_get_rule(kSecClass), class.as_CFType()),
                        (
                            CFString::wrap_under_get_rule(kSecAttrService),
                            service_cf.as_CFType(),
                        ),
                        (
                            CFString::wrap_under_get_rule(kSecAttrAccount),
                            account_cf.as_CFType(),
                        ),
                        (
                            CFString::wrap_under_get_rule(kSecAttrAccessGroup),
                            group.as_CFType(),
                        ),
                    ]);
                    let _ = SecItemDelete(query.as_concrete_TypeRef());
                }
            } else if use_sync_any {
                let query = CFDictionary::from_CFType_pairs(&[
                    (CFString::wrap_under_get_rule(kSecClass), class.as_CFType()),
                    (
                        CFString::wrap_under_get_rule(kSecAttrService),
                        service_cf.as_CFType(),
                    ),
                    (
                        CFString::wrap_under_get_rule(kSecAttrAccount),
                        account_cf.as_CFType(),
                    ),
                    (
                        CFString::wrap_under_get_rule(kSecAttrSynchronizable),
                        sync_any.as_CFType(),
                    ),
                ]);
                let _ = SecItemDelete(query.as_concrete_TypeRef());
            } else {
                let query = CFDictionary::from_CFType_pairs(&[
                    (CFString::wrap_under_get_rule(kSecClass), class.as_CFType()),
                    (
                        CFString::wrap_under_get_rule(kSecAttrService),
                        service_cf.as_CFType(),
                    ),
                    (
                        CFString::wrap_under_get_rule(kSecAttrAccount),
                        account_cf.as_CFType(),
                    ),
                ]);
                let _ = SecItemDelete(query.as_concrete_TypeRef());
            }
        };

        let purge_all = || {
            delete_query(None, true);
            delete_query(None, false);
            if let Some(group) = keychain_access_group() {
                let group_cf = CFString::new(&group);
                delete_query(Some(&group_cf), true);
                delete_query(Some(&group_cf), false);
            }
        };

        let add_item = || -> i32 {
            let value_cf = CFData::from_buffer(value);
            let label_cf = CFString::new(label);
            let description_cf = CFString::new(description);
            let accessible =
                CFString::wrap_under_get_rule(kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly);
            let sync_false = CFBoolean::from(false);
            let add = CFDictionary::from_CFType_pairs(&[
                (CFString::wrap_under_get_rule(kSecClass), class.as_CFType()),
                (
                    CFString::wrap_under_get_rule(kSecAttrService),
                    service_cf.as_CFType(),
                ),
                (
                    CFString::wrap_under_get_rule(kSecAttrAccount),
                    account_cf.as_CFType(),
                ),
                (
                    CFString::wrap_under_get_rule(kSecValueData),
                    value_cf.as_CFType(),
                ),
                (
                    CFString::wrap_under_get_rule(kSecAttrAccessible),
                    accessible.as_CFType(),
                ),
                (
                    CFString::wrap_under_get_rule(kSecAttrLabel),
                    label_cf.as_CFType(),
                ),
                (
                    CFString::wrap_under_get_rule(kSecAttrDescription),
                    description_cf.as_CFType(),
                ),
                (
                    CFString::wrap_under_get_rule(kSecAttrSynchronizable),
                    sync_false.as_CFType(),
                ),
            ]);
            let mut result = std::ptr::null();
            SecItemAdd(add.as_concrete_TypeRef(), &mut result)
        };

        purge_all();
        let mut add_status = add_item();
        if add_status == errSecSuccess {
            return Ok(());
        }
        if add_status == errSecDuplicateItem {
            // Leftover still visible — purge again and Add once more. Never Update.
            purge_all();
            add_status = add_item();
            if add_status == errSecSuccess {
                return Ok(());
            }
        }
        Err(keychain_status_message(
            "cannot store credentials in Keychain",
            add_status,
        ))
    }
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
fn load_generic_password_bytes(
    service: &str,
    account: &str,
) -> Result<Option<(Vec<u8>, bool)>, String> {
    use security_framework::passwords::generic_password;
    use std::thread;
    use std::time::Duration;

    let mut last_error: Option<i32> = None;
    let has_shared = keychain_access_group().is_some();

    // Retry: -25308 is common during early launch before Keychain is interactive.
    for attempt in 0..4 {
        for (index, options) in read_password_variants(service, account)
            .into_iter()
            .enumerate()
        {
            let used_shared_group = has_shared && index == 1;
            match generic_password(options) {
                Ok(bytes) => return Ok(Some((bytes, used_shared_group))),
                Err(error) if keychain_soft_miss(error.code()) => {
                    last_error = Some(error.code());
                }
                Err(error) => {
                    return Err(keychain_status_message(
                        "cannot read credentials from Keychain",
                        error.code(),
                    ));
                }
            }
        }
        if last_error != Some(-25308) {
            break;
        }
        if attempt + 1 < 4 {
            thread::sleep(Duration::from_millis(150 * (attempt as u64 + 1)));
        }
    }

    match last_error {
        Some(-25300) | None => Ok(None),
        Some(code) => Err(keychain_status_message(
            "cannot read credentials from Keychain",
            code,
        )),
    }
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
fn delete_generic_password_all_variants(service: &str, account: &str) {
    use security_framework::passwords::delete_generic_password_options;
    for options in read_password_variants(service, account) {
        let _ = delete_generic_password_options(options);
    }
}

/// Debug-only: attach a classic Keychain ACL that allows any application.
///
/// `tauri:dev` binaries are normally ad-hoc signed; each rebuild gets a new
/// code directory hash, so the default creator-only ACL re-prompts forever.
/// Production / notarized builds keep the default app-bound ACL (this helper
/// is compiled out of release builds).
#[cfg(all(debug_assertions, target_os = "macos"))]
fn apply_debug_allow_all_apps_acl(options: &mut security_framework::passwords::PasswordOptions) {
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
        let Some((bytes, used_shared_group)) =
            load_generic_password_bytes(Self::SERVICE, Self::ACCOUNT)?
        else {
            return Ok(None);
        };
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
        // Rewrite via Update-then-Add so accessibility / store path stay correct.
        #[cfg(not(all(debug_assertions, target_os = "macos")))]
        {
            let _ = used_shared_group;
            let _ = self.store(&key);
        }
        Ok(Some(key))
    }

    fn store(&self, key: &[u8; KEY_LEN]) -> Result<(), String> {
        #[cfg(all(debug_assertions, target_os = "macos"))]
        {
            store_generic_password_debug_friendly(
                Self::SERVICE,
                Self::ACCOUNT,
                key,
                "GalMail vault wrapping key",
                "Wraps the local GalMail vault key; never synchronized",
            )
        }
        #[cfg(not(all(debug_assertions, target_os = "macos")))]
        {
            store_app_private_generic_password(
                Self::SERVICE,
                Self::ACCOUNT,
                key,
                "GalMail vault wrapping key",
                "Wraps the local GalMail vault key; never synchronized",
            )
            .map_err(|error| {
                if error.contains("cannot store credentials") {
                    error.replacen(
                        "cannot store credentials in Keychain",
                        "cannot store vault wrapping key in Keychain",
                        1,
                    )
                } else {
                    error
                }
            })
        }
    }
}

/// Provider-neutral OAuth token Keychain service (Gmail + Microsoft accountIds).
/// Vault wrapping key uses `com.galmail.app.vault` — do not conflate.
#[cfg_attr(not(any(target_os = "macos", target_os = "ios")), allow(dead_code))]
pub const OAUTH_KEYCHAIN_SERVICE: &str = "com.galmail.app.oauth";
/// Legacy service name; dual-read + one-time migrate into [`OAUTH_KEYCHAIN_SERVICE`].
#[cfg_attr(not(any(target_os = "macos", target_os = "ios")), allow(dead_code))]
pub const OAUTH_KEYCHAIN_SERVICE_LEGACY: &str = "com.galmail.app.gmail-oauth";

#[cfg(any(target_os = "macos", target_os = "ios"))]
fn load_oauth_bytes(service: &str, account_id: &str) -> Result<Option<Vec<u8>>, String> {
    Ok(load_generic_password_bytes(service, account_id)?.map(|(bytes, _)| bytes))
}

/// Copy a legacy Keychain item into the new service, then delete the old entry.
#[cfg(any(target_os = "macos", target_os = "ios"))]
fn migrate_oauth_item_from_legacy(account_id: &str) -> Result<Option<Vec<u8>>, String> {
    let Some(bytes) = load_oauth_bytes(OAUTH_KEYCHAIN_SERVICE_LEGACY, account_id)? else {
        return Ok(None);
    };
    store_oauth_bytes(OAUTH_KEYCHAIN_SERVICE, account_id, &bytes)?;
    delete_generic_password_all_variants(OAUTH_KEYCHAIN_SERVICE_LEGACY, account_id);
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
        store_app_private_generic_password(
            service,
            account_id,
            value,
            "GalMail OAuth authorization",
            "Provider OAuth tokens; never synchronized",
        )
        .map_err(|error| {
            error.replacen(
                "cannot store credentials in Keychain",
                "cannot store OAuth credentials in Keychain",
                1,
            )
        })
    }
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
fn list_oauth_accounts_for_service(service: &str) -> Result<Vec<String>, String> {
    use security_framework::item::{ItemClass, ItemSearchOptions, Limit, SearchResult};
    let mut ids = Vec::new();
    // App-default first; shared group second for migration from older builds.
    let mut group_filters: Vec<Option<String>> = Vec::with_capacity(2);
    group_filters.push(None);
    if let Some(group) = keychain_access_group() {
        group_filters.push(Some(group));
    }
    for access_group in group_filters {
        let mut search = ItemSearchOptions::new();
        search
            .class(ItemClass::generic_password())
            .service(service)
            .load_attributes(true)
            .load_data(false)
            .limit(Limit::All);
        if let Some(group) = access_group.as_deref() {
            search.access_group(group);
        }
        let results = match search.search() {
            Ok(items) => items,
            Err(error) if keychain_soft_miss(error.code()) => continue,
            Err(error) => {
                return Err(keychain_status_message(
                    "cannot enumerate OAuth Keychain accounts",
                    error.code(),
                ));
            }
        };
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
    }
    ids.sort();
    ids.dedup();
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
        // New writes only go to the provider-neutral service.
        delete_generic_password_all_variants(OAUTH_KEYCHAIN_SERVICE_LEGACY, account_id);
        store_oauth_bytes(OAUTH_KEYCHAIN_SERVICE, account_id, value)
    }

    fn delete_token(&self, account_id: &str) -> Result<(), String> {
        for service in [OAUTH_KEYCHAIN_SERVICE, OAUTH_KEYCHAIN_SERVICE_LEGACY] {
            delete_generic_password_all_variants(service, account_id);
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
        assert_ne!(OAUTH_KEYCHAIN_SERVICE, VAULT_KEYCHAIN_SERVICE);
        assert_ne!(OAUTH_KEYCHAIN_SERVICE_LEGACY, VAULT_KEYCHAIN_SERVICE);
        // Extension vault service must not be renamed by this migration.
        assert_ne!(OAUTH_KEYCHAIN_SERVICE, EXTENSION_VAULT_KEYCHAIN_SERVICE);
        assert_ne!(VAULT_KEYCHAIN_SERVICE, EXTENSION_VAULT_KEYCHAIN_SERVICE);
        assert_eq!(VAULT_KEYCHAIN_ACCOUNT, "device-wrap-key-v1");
    }

    #[test]
    fn keychain_soft_miss_covers_not_found_entitlement_and_interaction() {
        assert!(keychain_soft_miss(-25300));
        assert!(keychain_soft_miss(-34018));
        assert!(keychain_soft_miss(-25308));
        assert!(!keychain_soft_miss(-25299));
        assert!(!keychain_soft_miss(0));
    }
}
