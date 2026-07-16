# GalMail Full Client Roadmap

## Product boundary

GalMail will remain a shared React client in Tauri 2, with Rust owning durable local
storage, cryptography, MIME processing, and platform integrations. Gmail and Microsoft
365 keep their native semantics behind provider adapters.

Today the repository is a **fixture-backed prototype**: unified threads, optimistic
mutations, compose/PiP, keyboard commands, device linking, notifications, remote
processing, and encrypted storage are demonstrations or in-memory contracts unless
`docs/status.md` explicitly says otherwise. It does not yet authenticate real accounts,
persist a production mailbox, or send real mail.

The default hosted path is zero-access: provider tokens and message plaintext stay on
user devices. Remote processing is an explicit, revocable, per-account opt-in with
disclosed retention. Ordinary email is readable by providers, recipients, forwarders,
and organizational retention systems; GalMail must not claim end-to-end encryption for
messages sent to ordinary recipients.

## Staged vertical slices

Each slice must work end-to-end in one provider before parity work begins. Gmail is the
first proving provider; Microsoft Graph follows through the same capability interfaces.

### 1. Account and OAuth foundation

- Implement OAuth 2.0 authorization-code + PKCE in Tauri and browser-safe development
  flows, secure callback handling, account add/remove, token refresh, revocation, and
  Keychain/Keystore-backed token wrapping.
- Preserve fixture mode and add explicit provider capability/error states.

**Dependencies:** registered Google/Microsoft apps, reviewed scopes, Tauri deep links,
OS secure storage.  
**Acceptance:** a user connects and revokes one Gmail account; restart refreshes tokens
without exposing them to logs or hosted GalMail services; cancellation and expired
consent recover cleanly.

### 2. Provider sync and encrypted local model

- Implement paginated initial sync plus Gmail History and Graph delta sync, bounded
  retries/backoff, cursor invalidation recovery, and provider-native IDs.
- Build a versioned Rust data model for accounts, folders/labels, threads, messages,
  drafts, attachments, cursors, and outbox records over SQLCipher (or an equivalently
  reviewed encrypted store), with migration, key rotation, backup, and corruption UX.

**Dependencies:** slice 1, audited AEAD/key wrapping replacing development crypto,
storage schema and migration policy.  
**Acceptance:** 100k-message fixtures sync incrementally after restart; duplicate and
out-of-order deltas converge; the database, tokens, drafts, and attachment cache are
encrypted at rest; interrupted migrations can resume or roll back.

### 3. Real threads, MIME, HTML, and attachments

- Normalize Gmail threads and Graph conversations without losing provider semantics.
- Parse multipart MIME in Rust; select text/HTML alternatives; sanitize and isolate
  HTML; block remote images by default; support inline content IDs, quoted history,
  calendar parts, attachment metadata, streaming download, preview, and quarantine.

**Dependencies:** slice 2, sanitizer policy, attachment cache and OS file APIs.  
**Acceptance:** corpus tests render plain text, complex HTML, RTL, inline images,
multi-message history, and malformed MIME safely; participant headers and dates match
provider source; large attachments stream without loading fully into UI memory.

### 4. Compose, send, drafts, replies, and forwarding

- Add address autocomplete, To/Cc/Bcc, rich and plain text, signatures, attachments,
  reply/reply-all/forward threading headers, provider draft autosave, send, undo-send,
  and PiP restoration.

**Dependencies:** slices 1–3, durable outbox, MIME generation, upload APIs.  
**Acceptance:** drafts survive crash/offline restart and reconcile with provider
drafts; reply/forward recipients and headers are correct; attachments upload with
progress/cancel; send is idempotent and clearly reports permanent failure.

### 5. Folders, labels, and search

- Implement Gmail label and Microsoft folder/category operations, system views,
  archive/trash/spam/snooze, multi-account filters, and local full-text search with
  provider search fallback for uncached mail.

**Dependencies:** slices 2–4, encrypted FTS index and query grammar.  
**Acceptance:** moves/labels round-trip without semantic loss; search covers sender,
  recipients, subject, body, dates, attachment names, and scoped accounts; indexing
  and representative queries meet `docs/performance-budgets.md`.

### 6. Offline outbox and conflict recovery

- Persist every mutation before optimistic UI, use idempotency keys, order dependent
  operations, retry transient failures, surface permanent failures, and reconcile
  remote changes with local drafts/actions.

**Dependencies:** slices 2, 4, and 5; provider-specific conflict rules.  
**Acceptance:** airplane-mode triage/compose works across restart; reconnect drains in
  order without duplicate sends; revoked auth, deleted remote objects, quota errors,
  and concurrent edits have actionable recovery paths.

### 7. Notifications and privacy-labeled receipts

- Complete blind push hints, device-side fetch/decrypt, native actions, notification
  preferences, and generic fallback when background execution is unavailable.
- Distinguish standards-based read receipts, tracking-pixel inference, and no signal;
  block remote pixels by default and explain that receipts are unreliable and can
  affect recipient privacy.

**Dependencies:** stable sync/outbox, APNs/Web Push credentials, validated Tauri mobile
extension path.  
**Acceptance:** no plaintext mail enters blind relay payloads; actions are idempotent;
locked-device notifications obey preview settings; UI never presents inferred opens as
certain or promises receipt support where providers/recipients do not provide it.

### 8. Settings, device linking, and optional remote processing

- Replace local linking scaffolds with authenticated invite approval, device list,
  revoke/recovery/key rotation, encrypted settings sync, account-specific privacy
  controls, data export/deletion, and advanced diagnostics.
- Isolate remote processors by account and purpose; version consent and enforce
  deletion/retention.

**Dependencies:** production cryptography, authenticated sync service, slices 1–2.  
**Acceptance:** a second device links only after explicit approval and can be revoked;
new key material cannot be read by revoked devices; remote processing starts only for
the selected account, expires/deletes data as disclosed, and returning to zero-access
is verifiable.

### 9. Hardening and release

- Add provider contract tests, MIME/security corpora, migration/property tests,
  accessibility and keyboard tests, deterministic sync simulations, offline E2E tests,
  performance traces, threat-model review, dependency/SBOM scanning, signed updates,
  crash recovery, telemetry consent, and staged release channels.

**Dependencies:** all prior slices, Google verification, Microsoft publisher
verification, Apple/desktop signing and release infrastructure.  
**Acceptance:** release gates cover both providers, three layouts, two themes, keyboard
navigation, offline recovery, migration, and rollback; security review has no open
critical findings; sync/search/render budgets pass on supported hardware; production
claims match `docs/privacy-model.md`.

## Cross-cutting completion rule

A slice is complete only when fixture, Gmail, and (after Gmail validation) Microsoft
contract behavior are documented; encrypted persistence and offline/restart behavior
are tested; accessibility and keyboard paths work; privacy copy reflects actual data
flow; and prototype-only controls remain clearly labeled in Advanced settings.
