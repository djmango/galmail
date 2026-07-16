//! GalMail Rust native core.
//!
//! Responsibilities: encrypted local storage, sync cursors, MIME helpers,
//! FTS indexing, durable encrypted records, and vault key wrapping primitives.

pub mod crypto;
#[cfg(feature = "native-storage")]
pub mod database;
pub mod keys;

use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum CoreError {
    #[error("not found: {0}")]
    NotFound(String),
    #[error("crypto error: {0}")]
    Crypto(String),
    #[error("ciphertext authentication failed")]
    AuthenticationFailed,
    #[error("unsupported ciphertext envelope version: {0}")]
    UnsupportedEnvelopeVersion(u8),
    #[error("SQLCipher is unavailable")]
    SqlCipherUnavailable,
    #[error("encrypted database is locked, keyed incorrectly, or corrupt")]
    DatabaseLockedOrCorrupt,
    #[error("database error: {0}")]
    Database(String),
    #[error("unsupported database schema version: {0}")]
    UnsupportedSchemaVersion(u32),
    #[error("invalid input: {0}")]
    InvalidInput(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SyncCursor {
    pub account_id: String,
    pub provider: String,
    pub token: String,
}

pub fn reconcile_cursor(
    current: Option<&SyncCursor>,
    incoming: SyncCursor,
) -> Result<SyncCursor, CoreError> {
    let Some(cur) = current else {
        return Ok(incoming);
    };
    if cur.account_id != incoming.account_id || cur.provider != incoming.provider {
        return Err(CoreError::InvalidInput("cursor identity mismatch".into()));
    }
    if cur.token >= incoming.token {
        Ok(cur.clone())
    } else {
        Ok(incoming)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_cursor_identity_mismatch() {
        let current = SyncCursor {
            account_id: "gmail:a".into(),
            provider: "gmail".into(),
            token: "1".into(),
        };
        let incoming = SyncCursor {
            account_id: "gmail:b".into(),
            provider: "gmail".into(),
            token: "2".into(),
        };
        assert!(matches!(
            reconcile_cursor(Some(&current), incoming),
            Err(CoreError::InvalidInput(_))
        ));
    }
}
