//! Vault key generation and domain-separated key derivation.

use crate::CoreError;
use hkdf::Hkdf;
use sha2::Sha256;
use zeroize::Zeroize;

pub const KEY_LEN: usize = 32;
const HKDF_SALT: &[u8] = b"galmail key hierarchy v1";

/// The root secret for one local vault.
///
/// It is generated from the operating system RNG, is never serialized by this
/// type, and is zeroized when dropped. Platform code is responsible for
/// wrapping it before durable storage.
pub struct VaultKey([u8; KEY_LEN]);

impl VaultKey {
    pub fn generate() -> Result<Self, CoreError> {
        let mut bytes = [0_u8; KEY_LEN];
        getrandom::fill(&mut bytes)
            .map_err(|_| CoreError::Crypto("operating system RNG unavailable".into()))?;
        Ok(Self(bytes))
    }

    pub fn from_bytes(bytes: [u8; KEY_LEN]) -> Self {
        Self(bytes)
    }

    pub fn expose(&self) -> &[u8; KEY_LEN] {
        &self.0
    }

    pub fn derive(&self, purpose: KeyPurpose) -> Result<DerivedKey, CoreError> {
        let hkdf = Hkdf::<Sha256>::new(Some(HKDF_SALT), &self.0);
        let mut output = [0_u8; KEY_LEN];
        hkdf.expand(purpose.info(), &mut output)
            .map_err(|_| CoreError::Crypto("key derivation failed".into()))?;
        Ok(DerivedKey(output))
    }
}

impl Drop for VaultKey {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

/// A purpose-specific key. Distinct purposes cannot produce the same key.
pub struct DerivedKey([u8; KEY_LEN]);

impl DerivedKey {
    pub fn expose(&self) -> &[u8; KEY_LEN] {
        &self.0
    }
}

impl Drop for DerivedKey {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyPurpose {
    Database,
    LocalBlob,
    Attachment,
    DeviceVaultWrap,
    RecoveryVaultWrap,
    DeviceLink,
}

impl KeyPurpose {
    fn info(self) -> &'static [u8] {
        match self {
            Self::Database => b"galmail/v1/database",
            Self::LocalBlob => b"galmail/v1/local-blob",
            Self::Attachment => b"galmail/v1/attachment",
            Self::DeviceVaultWrap => b"galmail/v1/device-vault-wrap",
            Self::RecoveryVaultWrap => b"galmail/v1/recovery-vault-wrap",
            Self::DeviceLink => b"galmail/v1/device-link",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn purposes_are_domain_separated() {
        let vault = VaultKey::from_bytes([7; KEY_LEN]);
        let database = vault.derive(KeyPurpose::Database).unwrap();
        let blobs = vault.derive(KeyPurpose::LocalBlob).unwrap();
        assert_ne!(database.expose(), blobs.expose());
    }

    #[test]
    fn generated_keys_are_not_reused() {
        let first = VaultKey::generate().unwrap();
        let second = VaultKey::generate().unwrap();
        assert_ne!(first.expose(), second.expose());
    }
}
