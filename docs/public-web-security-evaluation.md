# Public web client security and reliability evaluation

**Decision (2026-07-15): no-go for a production public web client.**

The native macOS/iOS clients remain the production targets. A web build may be
used for fixtures and UI testing, but it must not silently become a live-mail
fallback. The browser platform cannot currently provide the same key custody,
durability, wakeup, and notification guarantees as Keychain plus SQLCipher in a
native application.

This is an engineering decision, not a claim that Web Crypto, IndexedDB, OPFS,
service workers, or Web Push are broken. They are useful controls with different
failure modes. A future web milestone must implement and test the controls below
before this decision can change.

## Browser key custody

Web Crypto can generate a `CryptoKey` with `extractable: false`, and `CryptoKey`
objects are serializable into IndexedDB without exposing raw key bytes. This is
materially better than the current browser development adapter, which keeps
exportable bytes in JavaScript memory.

It is not equivalent to native Keychain or a hardware-backed non-exportable key:

- A same-origin script injection can invoke decryption/signing with a
  non-extractable key even when it cannot export the key. The Web Crypto
  specification explicitly warns that injected script can transfer key
  capabilities and cause cryptographic operations.
- Browser profiles, extensions, debugging interfaces, origin compromise, and
  browser implementation policy remain in the trust boundary.
- IndexedDB eviction removes the stored `CryptoKey` together with local recovery
  metadata unless recovery is deliberately separated and tested.

Required design before a live web pilot:

1. Generate an AES-GCM wrapping `CryptoKey` as non-extractable and store the
   object directly in IndexedDB. Never serialize a raw vault key.
2. Use a versioned AEAD envelope compatible with the native data format and
   bind account, record type, record id, and schema version as associated data.
3. Adopt a strict CSP without `unsafe-eval`, Trusted Types where supported,
   dependency integrity controls, isolated mail rendering, and a narrow service
   worker scope. A non-extractable key does not mitigate XSS by itself.
4. Require a separately tested recovery path (existing-device approval or a
   user-held recovery secret). Recovery material must not be stored in the same
   evictable origin bucket as the only copy of the key.

Evidence:

- [MDN: SubtleCrypto — storing keys](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto#storing_keys)
- [Web Cryptography Level 2 — key storage and script-injection warning](https://w3c.github.io/webcrypto/#security-developers)
- [MDN: `CryptoKey.extractable`](https://developer.mozilla.org/en-US/docs/Web/API/CryptoKey/extractable)

## IndexedDB, OPFS, eviction, and recovery

Recommended split:

- IndexedDB: non-extractable wrapping key, encrypted metadata, cursors, outbox,
  and transaction journal.
- OPFS: large encrypted message bodies and attachments.
- Cache Storage: immutable application shell only, never decrypted mail.

Both IndexedDB and OPFS are best-effort storage by default. Under storage
pressure, a browser can evict an origin without prompting; quota writes can fail
with `QuotaExceededError`. Eviction is generally origin-wide, so placing a
second copy in another API under the same origin is not recovery.

Required behavior:

1. Call `navigator.storage.estimate()`, show quota pressure before downloads,
   and stop body/attachment hydration at a conservative configurable threshold.
2. Request `navigator.storage.persist()` after an explicit user explanation.
   Treat refusal as normal and visible, not as an exceptional state.
3. At every startup, validate a small manifest in IndexedDB against OPFS
   generation ids. If either side is absent or inconsistent, enter recovery
   mode; never create a new key and present ciphertext as an empty mailbox.
4. Rebuild provider data from Graph/Gmail only after reauthorization and rebuild
   local-only drafts/outbox from encrypted sync or user recovery. Clearly list
   unrecoverable local-only items before reset.
5. Test full-origin deletion, partial transaction interruption,
   `QuotaExceededError`, private-browsing limits, persistence refusal, and
   concurrent-tab upgrades in every supported browser.

Evidence:

- [MDN: storage quotas and eviction criteria](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)
- [MDN: Storage API and persistent buckets](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API)
- [WebKit: storage policy and origin-wide eviction](https://webkit.org/blog/14403/updates-to-storage-policy/)

## Service workers and background sync

A service worker is suitable for an offline application shell, ciphertext
uploads, and retrying an already authorized outbox operation. It must not hold
decrypted mail or long-lived provider refresh tokens.

One-off Background Sync is not Baseline and is absent from Safari and Firefox.
Browsers decide when to run it, may cap execution/retries, and may terminate the
worker. Therefore it cannot satisfy a mail client's freshness or send-time SLA.
Periodic sync is even less portable.

Required behavior:

- Foreground startup/resume is the correctness path for provider delta sync.
- The durable encrypted outbox remains pending until an acknowledged provider
  response; service-worker execution is an optimization only.
- Idempotency keys and provider reconciliation are mandatory because a worker
  can be interrupted after the remote mutation but before the local commit.
- No UI may promise scheduled send or timely background refresh based only on
  browser Background Sync.

Evidence:

- [MDN: Background Synchronization API — limited availability](https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API)
- [MDN: offline/background PWA operation and retry limits](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation)
- [WICG Background Sync specification — user-agent scheduling and time limits](https://wicg.github.io/background-sync/spec/)

## Web Push and notifications

Web Push can wake a service worker, but permission is user-controlled and
delivery is not a durable mailbox event log. Browser policies require
user-visible notifications and do not provide reliable silent push.

GalMail's blind relay rule is unchanged:

- Push data contains only an authenticated opaque route id and generic event
  type. Never sender, recipients, subject, snippet, body, category, or provider
  ids.
- The notification is generic. The client fetches deltas directly from the mail
  provider after user interaction or a permitted wakeup.
- Notification actions may enqueue an opaque local operation but must
  reauthenticate and reconcile before applying it.
- Permission denial, expired subscriptions, browser data clearing, and missed
  delivery must degrade to foreground sync without data loss.

Evidence:

- [MDN: Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API)
- [MDN: Notifications API](https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API)
- [MDN PWA guide — silent push is unsupported for privacy reasons](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation#push)

## Promotion gate

A public web pilot remains blocked until all of these are demonstrated in
Chrome, Safari, and Firefox (desktop and supported mobile variants):

- Non-extractable IndexedDB key custody and XSS/Trusted Types penetration tests.
- OPFS/IndexedDB quota, persistence, eviction, recovery, and cross-tab migration
  tests with no silent local-only data loss.
- Foreground correctness with service worker/background sync disabled.
- Generic blind Web Push with missed/expired/denied subscription recovery.
- Provider OAuth approval for browser redirect origins and an explicit privacy
  review of the enlarged browser/extension/origin trust boundary.

Passing these tests would permit a limited pilot; it would not make browser
guarantees identical to the native applications.

## Repository scaffolding delivered by this evaluation

`@galmail/browser-adapters` now exposes fail-closed, dependency-injected
scaffolding for the future milestone. It compares an IndexedDB manifest
generation with an OPFS generation marker before mailbox startup, reports quota
pressure and blocks hydration at a configurable threshold, requests persistence
only after explicit acknowledgement, and registers only an explicitly enabled
same-origin application-shell service worker. Mocked tests cover missing and
mismatched storage, quota pressure, persistence refusal, and cross-origin worker
rejection.

This is recovery-policy scaffolding, not an IndexedDB/OPFS mail store, service
worker implementation, browser token store, or live-web enablement. It does not
change the no-go decision or satisfy the cross-browser promotion gate.
