//! Versioned authenticated ciphertext envelopes.

use crate::{keys::KEY_LEN, CoreError};
use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    XChaCha20Poly1305, XNonce,
};

const MAGIC: &[u8; 4] = b"GMAE";
pub const ENVELOPE_VERSION: u8 = 1;
const XCHACHA20_POLY1305: u8 = 1;
const NONCE_LEN: usize = 24;
const HEADER_LEN: usize = 8;
const TAG_LEN: usize = 16;

/// Authenticated context that binds a ciphertext to its intended record.
#[derive(Debug, Clone, Copy)]
pub struct AssociatedData<'a> {
    pub purpose: &'a str,
    pub account_id: &'a str,
    pub object_id: &'a str,
}

impl AssociatedData<'_> {
    pub fn encode(&self) -> Vec<u8> {
        let mut encoded = Vec::with_capacity(
            24 + self.purpose.len() + self.account_id.len() + self.object_id.len(),
        );
        encoded.extend_from_slice(b"galmail/aad/v1");
        append_field(&mut encoded, self.purpose.as_bytes());
        append_field(&mut encoded, self.account_id.as_bytes());
        append_field(&mut encoded, self.object_id.as_bytes());
        encoded
    }
}

fn append_field(output: &mut Vec<u8>, value: &[u8]) {
    output.extend_from_slice(&(value.len() as u64).to_be_bytes());
    output.extend_from_slice(value);
}

pub fn seal(
    plaintext: &[u8],
    key: &[u8; KEY_LEN],
    associated_data: &[u8],
) -> Result<Vec<u8>, CoreError> {
    let cipher = XChaCha20Poly1305::new(key.into());
    let mut nonce = [0_u8; NONCE_LEN];
    getrandom::fill(&mut nonce)
        .map_err(|_| CoreError::Crypto("operating system RNG unavailable".into()))?;

    let encrypted = cipher
        .encrypt(
            &XNonce::from(nonce),
            Payload {
                msg: plaintext,
                aad: associated_data,
            },
        )
        .map_err(|_| CoreError::Crypto("encryption failed".into()))?;

    let mut envelope = Vec::with_capacity(HEADER_LEN + NONCE_LEN + encrypted.len());
    envelope.extend_from_slice(MAGIC);
    envelope.push(ENVELOPE_VERSION);
    envelope.push(XCHACHA20_POLY1305);
    envelope.push(NONCE_LEN as u8);
    envelope.push(0);
    envelope.extend_from_slice(&nonce);
    envelope.extend_from_slice(&encrypted);
    Ok(envelope)
}

pub fn open(
    envelope: &[u8],
    key: &[u8; KEY_LEN],
    associated_data: &[u8],
) -> Result<Vec<u8>, CoreError> {
    if envelope.len() < HEADER_LEN + NONCE_LEN + TAG_LEN {
        return Err(CoreError::Crypto("truncated ciphertext envelope".into()));
    }
    if &envelope[..4] != MAGIC {
        return Err(CoreError::Crypto("invalid ciphertext envelope".into()));
    }
    if envelope[4] != ENVELOPE_VERSION {
        return Err(CoreError::UnsupportedEnvelopeVersion(envelope[4]));
    }
    if envelope[5] != XCHACHA20_POLY1305 || envelope[6] as usize != NONCE_LEN || envelope[7] != 0 {
        return Err(CoreError::Crypto("unsupported ciphertext algorithm".into()));
    }

    let nonce = XNonce::try_from(&envelope[HEADER_LEN..HEADER_LEN + NONCE_LEN])
        .map_err(|_| CoreError::Crypto("invalid ciphertext nonce".into()))?;
    XChaCha20Poly1305::new(key.into())
        .decrypt(
            &nonce,
            Payload {
                msg: &envelope[HEADER_LEN + NONCE_LEN..],
                aad: associated_data,
            },
        )
        .map_err(|_| CoreError::AuthenticationFailed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;
    use std::collections::HashSet;

    const KEY: [u8; KEY_LEN] = [17; KEY_LEN];
    const OTHER_KEY: [u8; KEY_LEN] = [18; KEY_LEN];
    const AAD: &[u8] = b"account:gmail:one/object:m1";

    #[test]
    fn roundtrip_and_versioned_header() {
        let envelope = seal(b"hello", &KEY, AAD).unwrap();
        assert_eq!(&envelope[..4], MAGIC);
        assert_eq!(envelope[4], ENVELOPE_VERSION);
        assert_eq!(open(&envelope, &KEY, AAD).unwrap(), b"hello");
    }

    #[test]
    fn rejects_tampering_wrong_key_and_wrong_context() {
        let envelope = seal(b"sensitive mail", &KEY, AAD).unwrap();
        let mut tampered = envelope.clone();
        let last = tampered.len() - 1;
        tampered[last] ^= 1;

        assert!(matches!(
            open(&tampered, &KEY, AAD),
            Err(CoreError::AuthenticationFailed)
        ));
        assert!(matches!(
            open(&envelope, &OTHER_KEY, AAD),
            Err(CoreError::AuthenticationFailed)
        ));
        assert!(matches!(
            open(&envelope, &KEY, b"another-record"),
            Err(CoreError::AuthenticationFailed)
        ));
    }

    #[test]
    fn fresh_nonce_is_used_for_every_seal() {
        let nonces: HashSet<Vec<u8>> = (0..10_000)
            .map(|_| {
                let envelope = seal(b"same", &KEY, AAD).unwrap();
                envelope[HEADER_LEN..HEADER_LEN + NONCE_LEN].to_vec()
            })
            .collect();
        assert_eq!(nonces.len(), 10_000);
    }

    #[test]
    fn rejects_future_versions_without_rewriting() {
        let mut envelope = seal(b"mail", &KEY, AAD).unwrap();
        envelope[4] = ENVELOPE_VERSION + 1;
        assert!(matches!(
            open(&envelope, &KEY, AAD),
            Err(CoreError::UnsupportedEnvelopeVersion(2))
        ));
    }

    proptest! {
        #[test]
        fn roundtrips_arbitrary_bytes(
            data in prop::collection::vec(any::<u8>(), 0..4096),
            aad in prop::collection::vec(any::<u8>(), 0..256),
        ) {
            let envelope = seal(&data, &KEY, &aad).unwrap();
            let opened = open(&envelope, &KEY, &aad).unwrap();
            prop_assert_eq!(opened, data);
        }
    }
}
