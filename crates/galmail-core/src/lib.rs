//! GalMail Rust native core.
//!
//! Responsibilities: encrypted local storage, sync cursors, MIME helpers,
//! search index stubs, durable outbox, and vault key wrapping primitives.

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum CoreError {
    #[error("not found: {0}")]
    NotFound(String),
    #[error("crypto error: {0}")]
    Crypto(String),
    #[error("outbox error: {0}")]
    Outbox(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SyncCursor {
    pub account_id: String,
    pub provider: String,
    pub token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MutationKind {
    Archive,
    MarkRead,
    Send,
    SaveDraft,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MutationStatus {
    Pending,
    Inflight,
    Failed,
    Done,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutboxMutation {
    pub id: String,
    pub account_id: String,
    pub kind: MutationKind,
    pub target_ids: Vec<String>,
    pub attempts: u32,
    pub status: MutationStatus,
}

#[derive(Default)]
pub struct EncryptedBlobStore {
    inner: Mutex<HashMap<String, Vec<u8>>>,
}

impl EncryptedBlobStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn put(&self, key: &str, value: Vec<u8>) {
        self.inner.lock().insert(key.to_string(), value);
    }

    pub fn get(&self, key: &str) -> Option<Vec<u8>> {
        self.inner.lock().get(key).cloned()
    }

    pub fn delete(&self, key: &str) -> bool {
        self.inner.lock().remove(key).is_some()
    }
}

/// Dev-grade XOR seal with GalMail header. Replace with AEAD before production.
pub fn seal(plaintext: &[u8], vault_key: &[u8]) -> Result<Vec<u8>, CoreError> {
    if vault_key.is_empty() {
        return Err(CoreError::Crypto("empty vault key".into()));
    }
    let mut out = Vec::with_capacity(plaintext.len() + 4);
    out.extend_from_slice(&[0x47, 0x4d, 0x01, 0x00]); // GM v1
    for (i, b) in plaintext.iter().enumerate() {
        out.push(b ^ vault_key[i % vault_key.len()]);
    }
    Ok(out)
}

pub fn open(ciphertext: &[u8], vault_key: &[u8]) -> Result<Vec<u8>, CoreError> {
    if ciphertext.len() < 4 || ciphertext[0] != 0x47 || ciphertext[1] != 0x4d {
        return Err(CoreError::Crypto("invalid header".into()));
    }
    if vault_key.is_empty() {
        return Err(CoreError::Crypto("empty vault key".into()));
    }
    let mut out = Vec::with_capacity(ciphertext.len() - 4);
    for (i, b) in ciphertext[4..].iter().enumerate() {
        out.push(b ^ vault_key[i % vault_key.len()]);
    }
    Ok(out)
}

#[derive(Default)]
pub struct Outbox {
    items: Mutex<Vec<OutboxMutation>>,
}

impl Outbox {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn enqueue(&self, account_id: &str, kind: MutationKind, target_ids: Vec<String>) -> OutboxMutation {
        let m = OutboxMutation {
            id: Uuid::new_v4().to_string(),
            account_id: account_id.to_string(),
            kind,
            target_ids,
            attempts: 0,
            status: MutationStatus::Pending,
        };
        self.items.lock().push(m.clone());
        m
    }

    pub fn flush<F>(&self, mut apply: F) -> Result<(usize, usize), CoreError>
    where
        F: FnMut(&OutboxMutation) -> Result<(), CoreError>,
    {
        let mut flushed = 0usize;
        let mut failed = 0usize;
        let mut items = self.items.lock();
        for m in items.iter_mut() {
            if m.status == MutationStatus::Done {
                continue;
            }
            m.status = MutationStatus::Inflight;
            m.attempts += 1;
            match apply(m) {
                Ok(()) => {
                    m.status = MutationStatus::Done;
                    flushed += 1;
                }
                Err(_) => {
                    m.status = MutationStatus::Failed;
                    failed += 1;
                }
            }
        }
        Ok((flushed, failed))
    }

    pub fn pending_count(&self) -> usize {
        self.items
            .lock()
            .iter()
            .filter(|m| m.status != MutationStatus::Done)
            .count()
    }
}

/// Very small MIME extract helper for tests / wasm boundary.
pub fn extract_text_plain(mime: &str) -> Option<String> {
    let marker = "Content-Type: text/plain";
    let idx = mime.find(marker)?;
    let after = &mime[idx..];
    let body = after.split("\r\n\r\n").nth(1)?;
    let end = body.find("\r\n--").unwrap_or(body.len());
    Some(body[..end].trim().to_string())
}

pub fn reconcile_cursor(current: Option<&SyncCursor>, incoming: SyncCursor) -> Result<SyncCursor, CoreError> {
    let Some(cur) = current else {
        return Ok(incoming);
    };
    if cur.account_id != incoming.account_id || cur.provider != incoming.provider {
        return Err(CoreError::Outbox("cursor identity mismatch".into()));
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
    use proptest::prelude::*;

    #[test]
    fn seal_open_roundtrip() {
        let key = b"vault-key-32-bytes-galmail-demo!!";
        let pt = b"hello galmail";
        let ct = seal(pt, key).unwrap();
        let out = open(&ct, key).unwrap();
        assert_eq!(out, pt);
    }

    #[test]
    fn outbox_flush_marks_done() {
        let outbox = Outbox::new();
        outbox.enqueue("gmail:demo", MutationKind::Archive, vec!["m1".into()]);
        let (flushed, failed) = outbox.flush(|_| Ok(())).unwrap();
        assert_eq!(flushed, 1);
        assert_eq!(failed, 0);
        assert_eq!(outbox.pending_count(), 0);
    }

    #[test]
    fn mime_text_plain_extract() {
        let mime = "MIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nHello\r\n--boundary";
        assert_eq!(extract_text_plain(mime).unwrap(), "Hello");
    }

    proptest! {
        #[test]
        fn seal_open_bytes(data in prop::collection::vec(any::<u8>(), 0..256)) {
            let key = b"0123456789abcdef0123456789abcdef";
            let ct = seal(&data, key).unwrap();
            let out = open(&ct, key).unwrap();
            prop_assert_eq!(out, data);
        }
    }
}
