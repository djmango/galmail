# Release Channel Policy

All distributable builds are signed, channel-scoped, and traceable to source,
dependencies, provenance, and release notes. Promotion copies an already-tested
artifact; it does not rebuild it.

## macOS distribution

The first desktop release is a direct-download, Developer ID signed and Apple
notarized DMG for Apple Silicon (`aarch64-apple-darwin`) on macOS 12 or newer.
Intel universal binaries are intentionally deferred until measured user demand
justifies the larger build and test matrix. The app uses hardened runtime and
App Sandbox entitlements for outbound provider access, the OAuth loopback
listener, user-selected exports, and WebKit JIT. Generic-password Keychain
items remain device-local; no Keychain access-group or Apple team identifier is
committed to source.

The `macOS release` workflow refuses to build without a Developer ID
certificate, notarization account credentials, team ID, Tauri updater private
key/password, updater public key, and signing identity. A successful job
verifies code signatures, Gatekeeper assessment, notarization staples, updater
signatures, and SHA-256 checksums before publishing. It also emits an SPDX SBOM
and GitHub artifact provenance. CI output is not evidence of Apple acceptance
unless every notarization and stapler check passes.

## Channels

### Alpha

Internal dogfood and named testers only. Data reset may be required. Feature
flags and migrations may change, but destructive changes require an export or
explicit reset confirmation. Alpha may collect only explicitly consented
diagnostics.

Entry requires CI, security guards, migration tests, and a documented known-risk
list. Exit requires no open P0 issue and successful recovery on supported test
devices.

### Beta

Invited external testers. Data compatibility is supported across beta updates;
reset-only migration is not acceptable. Privacy and support policies must be
published, provider test-user limits must be respected, and all content-bearing
features require final consent copy.

Entry requires no open P0/P1 security or data-loss issue, signed/notarized
artifacts, tested update and rollback paths, and successful account
revocation/deletion tests.

### Stable

General availability. Stable receives urgent security fixes and supports
migration from the prior stable minor release. Stable never auto-downgrades a
data or cryptographic format.

Entry requires beta evidence against documented crash-free and sync-success
targets, completed external security/crypto review, Google OAuth verification
for requested restricted scopes, legal review of public policies, restore
exercise, and zero open P0/P1 issues.

## Rollout and rollback

Rollouts progress 1% → 10% → 50% → 100% with health review between stages.
Security may halt any stage. Application rollback is allowed only when the
installed binary declares support for the current schema and envelope versions.
Otherwise, disable the affected feature, roll forward, or restore a
pre-migration encrypted backup after explicit user confirmation.

Revoked or known-vulnerable builds are denied updates and provider operations
where technically feasible. Emergency releases still require signing,
provenance, focused tests, and an incident record.

Each channel has its own bundle identifier and updater manifest:
`app.galmail.client.alpha`, `app.galmail.client.beta`, and
`app.galmail.client`. Update archives are signed and channel manifests point to
immutable versioned release assets. The updater must never cross channels or
offer a lower semantic version. Database or cryptographic format rollback still
requires the compatibility checks above.

## Recovery and diagnostics

Native recovery commands expose safe-mode restart, database
verification/migration, encrypted local-data export, explicit local reset, and
redacted diagnostics export. Safe mode does not open the database and disables
provider/account network operations. Raw recovery exports are encrypted but
remain tied to the current device Keychain key; they are not a portable
recovery mechanism. Portable account recovery requires the separately reviewed
device-link/recovery-key design and must not be simulated by exporting plaintext
keys.

## Ownership

The release owner approves promotion; the security owner can veto it; the data
owner approves migration/rollback compatibility; and the privacy owner approves
new collection, retention, or consent behavior. One person may hold multiple
roles during the prototype, but each approval is recorded.
