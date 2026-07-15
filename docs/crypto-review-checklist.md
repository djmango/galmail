# GalMail Cryptography Review Checklist

Complete before public hosted launch. External review recommended.

## Key hierarchy

- [ ] Vault key: 256-bit random on device
- [ ] Per-device wrap (HPKE / X25519+AEAD) — replace XOR-dev
- [ ] User recovery key wrap; offline backup UX
- [ ] Crypto-erasure by destroying wraps + vault key
- [ ] No server-side plaintext key escrow

## Algorithms (target)

- [ ] AEAD for blobs (XChaCha20-Poly1305 or AES-256-GCM)
- [ ] HKDF for domain separation
- [ ] Authenticated associated data includes account/device ids
- [ ] Constant-time compares for MAC/HMAC (relay already uses `timingSafeEqual`)

## Storage

- [ ] SQLCipher (native) or WebCrypto+OPFS (browser)
- [ ] OAuth tokens in Keychain / non-exportable CryptoKey
- [ ] Reject unauthenticated ciphertext on sync

## Threat coverage

- [ ] Service compromise cannot decrypt mail/tokens/settings
- [ ] Stolen device mitigations documented
- [ ] Opt-in processor isolation + retention enforced
- [ ] No accidental plaintext logging (lint/tests)

## Tests required

- [ ] Key rotation / device revoke
- [ ] Tampered ciphertext rejected
- [ ] Blind relay plaintext field rejection (implemented)
- [ ] HTML sanitization / URL allowlist (implemented stubs)
- [ ] Property tests for seal/open (Rust proptest present for XOR-dev; re-run after AEAD swap)
