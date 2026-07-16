# Testable Security and Privacy Requirements

This file turns the threat, privacy, and cryptography models into release
criteria. “Planned” is not evidence. A requirement is complete only when its
named evidence exists and passes for the target artifact.

## Hosted and provider boundaries

- **TM-01 — Default zero-access:** blind relay and encrypted sync reject
  plaintext mail, drafts, contacts, search queries, and provider tokens.
  Evidence: recursive forbidden-field API tests, deployment data-flow review,
  and production payload sampling using synthetic canaries. Status: partial;
  relay top-level rejection exists, encrypted sync does not.
- **TM-02 — Network security:** production endpoints require HTTPS, validate
  certificates, and have no plaintext downgrade. Evidence: configuration test
  and external endpoint scan. Status: planned.
- **TM-03 — Opt-in isolation:** remote processing starts only with current
  per-account consent and stops on revoke. Evidence: consent contract tests,
  cross-account isolation tests, and deletion/expiry tests. Status: partial.
- **TM-04 — Malicious mail isolation:** active content cannot execute in the app
  origin and remote resources are blocked by default. Evidence: malicious MIME
  corpus, CSP/WebView integration tests, and URL/attachment tests. Status:
  planned; sanitizer unit tests alone are insufficient.
- **TM-05 — Lost-device protection:** local mail and credentials remain
  encrypted while the device is locked; device revoke prevents future sync.
  Evidence: Keychain/SQLCipher integration tests and device-revoke test.
  Status: planned.
- **TM-06 — Sync integrity:** tampered, replayed, duplicate, stale, and
  out-of-order state is rejected or reconciled. Evidence: property tests and
  interrupted-sync simulations. Status: planned.

## Privacy and diagnostics

- **PR-01 — Data minimization:** each hosted field has a documented purpose,
  retention period, and deletion trigger. Evidence: API schema review against
  `retention-deletion-policy.md`. Status: policy complete; implementation
  planned.
- **PR-02 — No sensitive default logs:** production diagnostics exclude content,
  addresses, subjects, tokens, queries, keys, and decrypted blobs. Evidence:
  `scripts/security-policy.test.ts`, synthetic-canary tests, and crash SDK
  configuration review. Status: static guard implemented; runtime exporters
  planned.
- **PR-03 — Diagnostics consent:** diagnostics remain off until informed,
  revocable consent and show an export preview. Evidence: clean-install UI test,
  consent-version test, and export snapshot. Status: planned.
- **PR-04 — Deletion:** account removal is idempotent, revokes credentials,
  destroys local keys/data, and removes hosted objects. Evidence: injected
  provider outages, retry tests, and backup-expiry exercise. Status: planned.
- **PR-05 — Remote-processing transparency:** consent identifies exact fields,
  purpose, processor, region, retention, and zero-access consequence. Evidence:
  disclosure snapshot and server rejection of stale versions. Status: partial.
- **PR-06 — No undeclared secondary use:** mail is not sold, used for ads, or
  used to train shared models without separate explicit agreement. Evidence:
  processor inventory, contracts, and annual policy review. Status: manual.

## Cryptography and credentials

- **CR-01 — Public OAuth clients:** native clients use authorization-code PKCE
  with S256 and contain no provider client secret. Evidence:
  `scripts/security-policy.test.ts`, binary string scan, and end-to-end OAuth
  tests. Status: configuration guard implemented; OAuth planned.
- **CR-02 — Token custody:** refresh tokens are stored only through platform
  secure storage and are removed on revoke/account deletion. Evidence: Tauri
  command tests and Keychain integration test. Status: planned.
- **CR-03 — Authenticated storage:** production blobs use reviewed AEAD with
  random nonces and domain-separated associated data. Evidence: known-answer,
  tamper, nonce-uniqueness, and property tests. Status: XChaCha20-Poly1305 and
  browser AES-GCM implementation/tests complete; external review pending.
- **CR-04 — Key separation:** vault, device-wrap, recovery, remote credential,
  and service-authentication keys are independently generated/derived and
  scoped. Evidence: key hierarchy review and cross-purpose failure tests.
  Status: vault/database/blob/device-wrap separation implemented; recovery,
  remote-credential, rotation, and revocation lifecycle work remains.
- **CR-05 — No server plaintext keys:** hosted services never receive vault or
  recovery plaintext keys. Evidence: API schema tests, traffic review, and
  external architecture assessment. Status: planned.
- **CR-06 — Migration safety:** format changes are versioned, transactional,
  interruption-safe, and fail closed on unknown versions. Evidence:
  `schema-versioning.md` migration matrix and recovery tests. Status: SQLCipher
  schema migrations and interruption rollback implemented; backup/restore and
  release downgrade orchestration remain.

## Release evidence

Before beta, every partial/planned requirement affecting shipped behavior needs
passing evidence or a documented feature disablement. Before stable, all
requirements above must pass, provider approvals must be complete, and an
external cryptography/application review must have no unresolved P0/P1 finding.
