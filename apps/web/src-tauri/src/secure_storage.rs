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

#[cfg(any(target_os = "macos", target_os = "ios"))]
impl DeviceKeyStore for MacOsKeychain {
    fn load(&self) -> Result<Option<[u8; KEY_LEN]>, String> {
        use security_framework::passwords::{generic_password, PasswordOptions};
        let mut options = PasswordOptions::new_generic_password(Self::SERVICE, Self::ACCOUNT);
        options.set_access_synchronized(Some(false));
        match generic_password(options) {
            Ok(bytes) => bytes
                .try_into()
                .map(Some)
                .map_err(|_| "Keychain vault wrapping key has invalid length".into()),
            Err(error) if error.code() == -25300 => Ok(None),
            Err(_) => Err("cannot read vault wrapping key from Keychain".into()),
        }
    }

    fn store(&self, key: &[u8; KEY_LEN]) -> Result<(), String> {
        use security_framework::passwords::{set_generic_password_options, PasswordOptions};
        let mut options = PasswordOptions::new_generic_password(Self::SERVICE, Self::ACCOUNT);
        options.set_access_synchronized(Some(false));
        options.set_label("GalMail vault wrapping key");
        options.set_description("Wraps the local GalMail vault key; never synchronized");
        set_generic_password_options(key, options)
            .map_err(|_| "cannot store vault wrapping key in Keychain".into())
    }
}

#[cfg(any(target_os = "macos", target_os = "ios"))]
impl SecureTokenStore for MacOsKeychain {
    fn load_token(&self, account_id: &str) -> Result<Option<Vec<u8>>, String> {
        use security_framework::passwords::{generic_password, PasswordOptions};
        let options =
            PasswordOptions::new_generic_password("com.galmail.app.gmail-oauth", account_id);
        match generic_password(options) {
            Ok(bytes) => Ok(Some(bytes)),
            Err(error) if error.code() == -25300 => Ok(None),
            Err(_) => Err("cannot read Gmail credentials from Keychain".into()),
        }
    }

    fn store_token(&self, account_id: &str, value: &[u8]) -> Result<(), String> {
        use security_framework::passwords::{set_generic_password_options, PasswordOptions};
        let mut options =
            PasswordOptions::new_generic_password("com.galmail.app.gmail-oauth", account_id);
        options.set_access_synchronized(Some(false));
        options.set_label("GalMail Gmail authorization");
        options.set_description("Gmail OAuth tokens; never synchronized");
        set_generic_password_options(value, options)
            .map_err(|_| "cannot store Gmail credentials in Keychain".into())
    }

    fn delete_token(&self, account_id: &str) -> Result<(), String> {
        use security_framework::passwords::delete_generic_password;
        match delete_generic_password("com.galmail.app.gmail-oauth", account_id) {
            Ok(()) => Ok(()),
            Err(error) if error.code() == -25300 => Ok(()),
            Err(_) => Err("cannot remove Gmail credentials from Keychain".into()),
        }
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
}
