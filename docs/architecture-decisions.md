# Production Architecture Decisions

Status: accepted baseline for the production roadmap. These decisions describe
the intended trust boundaries; prototype implementations that do not yet meet
them remain identified in `docs/status.md`.

## Local storage

Rust owns the native source of truth. Mail metadata, bodies, indexes,
attachments, cursors, and the durable outbox use a versioned SQLCipher database.
Browser storage remains a development and future-web adapter, not a fallback for
native production builds.

## Cryptography and keys

Versioned XChaCha20-Poly1305 envelopes protect stored and synchronized blobs.
Each device keeps a non-exportable wrapping key in the platform keychain. Vault,
device-link, recovery, and remote-service keys have separate purposes. No fixed
keys, XOR encryption, or plaintext key synchronization is permitted in
production.

## OAuth clients

macOS and iOS are public OAuth clients using authorization-code PKCE and native
redirects. They contain no client secret. The future browser client uses its own
public-client registration and redirect allowlist. Tokens stay in native secure
storage; any opted-in remote processor receives separately controlled,
revocable credentials only after versioned consent.

For the first Gmail/macOS release, the Desktop app client uses a random-port
`127.0.0.1` callback, PKCE S256, and
`openid email gmail.modify calendar`. Microsoft later uses its public
desktop registration with `http://localhost` and
`openid email offline_access User.Read Mail.ReadWrite Mail.Send Calendars.ReadWrite`.
General app deep links never carry OAuth material. See `oauth-architecture.md`.

## Cloudflare services

The blind relay, ciphertext sync service, and opt-in processor deploy as
separate Cloudflare trust domains with separate bindings and credentials. The
relay handles opaque authenticated hints, encrypted sync stores ciphertext and
non-content indexes, and remote processing is disabled by default and isolated
per account.

## Diagnostics

Operational metrics are content-free by default. Mail bodies, subjects,
addresses, recipients, OAuth tokens, decrypted blobs, and search queries are
forbidden in logs and crash reports. User-exported diagnostics are redacted;
content-bearing diagnostics require explicit, time-bounded consent.
Direct production logging is prohibited until a typed allowlist logger and
synthetic sensitive-data canary tests exist. See `diagnostics-policy.md`.

## Release channels

Alpha, beta, and stable are distinct signed update channels. Database and
envelope formats are versioned independently of app releases. Stable promotion
requires migration compatibility and rollback protection; downgrades that
cannot safely read current data fail closed.
Promotion and rollback gates are defined in `release-policy.md`; persistent
format compatibility is defined in `schema-versioning.md`.

## Data deletion

Account removal revokes provider and remote credentials, deletes local keys and
data, removes ciphertext sync blobs and device records, and cancels queued
processing. Deletion is idempotent and auditable without retaining mail
metadata. Provider-hosted mail and recipient copies are explicitly outside this
boundary.

Hosted expiry periods and partial-failure behavior are defined in
`retention-deletion-policy.md`.
