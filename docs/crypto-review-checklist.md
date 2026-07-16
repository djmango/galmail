# GalMail Cryptography Review Checklist

Complete before public hosted launch. External review recommended.
Requirement IDs and status live in
[security-requirements.md](security-requirements.md); unchecked items are not
implemented production controls.

## Key hierarchy (CR-04, CR-05)

- [x] Vault key: 256-bit random on device
- [ ] Per-device wrap (HPKE / X25519+AEAD) — native macOS currently uses
      XChaCha20-Poly1305 with a 256-bit wrapping key stored only in Keychain;
      multi-device public-key wrapping is not implemented
- [ ] User recovery key wrap; offline backup UX
- [ ] Crypto-erasure by destroying wraps + vault key
- [ ] No server-side plaintext key escrow

## Algorithms (CR-03, CR-04)

- [x] AEAD for blobs (XChaCha20-Poly1305 native/Wasm; AES-256-GCM browser)
- [x] HKDF for domain separation
- [ ] Authenticated associated data includes account/device ids
- [ ] Constant-time compares for MAC/HMAC (relay already uses `timingSafeEqual`)

## Storage (CR-02, CR-03)

- [x] SQLCipher native storage with transactional schema migrations and FTS;
      browser OPFS durability remains pending
- [ ] OAuth tokens in Keychain / non-exportable CryptoKey
- [ ] Reject unauthenticated ciphertext on sync

## Threat coverage (TM-01, TM-03, PR-02)

- [ ] Service compromise cannot decrypt mail/tokens/settings
- [ ] Stolen device mitigations documented
- [ ] Opt-in processor isolation + retention enforced
- [x] Direct production logging and provider client-secret static guards
- [ ] Runtime canary tests for logs, traces, crashes, and diagnostic exports

## Tests required

- [ ] Key rotation / device revoke
- [x] Tampered ciphertext rejected
- [ ] Blind relay plaintext field rejection (implemented)
- [ ] HTML sanitization / URL allowlist (implemented stubs)
- [x] Property tests for AEAD seal/open, wrong keys, tampering, nonce uniqueness,
      restart durability, rollback, deletion, and representative scale
- [x] Public-client configuration rejects provider client-secret assumptions
- [ ] Built application binary scan contains no provider client secret
