# GalMail Status — Production vs Prototype

**As of:** 2026-07-15

## Production-ready (foundation quality)

| Area                                      | Notes                                                                                                                                  |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Monorepo layout                           | Bun + Cargo workspaces, reproducible Nix shell, MIT license, README                                                                    |
| Threat model / product / privacy docs     | Living docs under `docs/`                                                                                                              |
| Shared capability API                     | `@galmail/core-api` types + MemorySyncEngine + tests                                                                                   |
| MIME and message security                 | Multipart parse/generate, international headers, alternatives, attachments, and malicious-message tests                                |
| Gmail fixture provider                    | Vertical slice without OAuth registration                                                                                              |
| Microsoft fixture + unified inbox         | Cross-provider merge tests                                                                                                             |
| Keyboard registry                         | Superhuman-compatible defaults + conflict detection                                                                                    |
| Hosted zero-access service plane          | Workers relay/sync with D1/R2, queues, rate limits, P-256 device linking, retention/deletion, and safe metrics                         |
| Isolated opt-in processor                 | Current versioned per-account consent, encrypted tokens, bounded retention, revoke retries, and account isolation                      |
| Remote opt-in consent contracts + UX copy | Disclosure versioning enforced                                                                                                         |
| Rust `galmail-core`                       | Versioned XChaCha20-Poly1305 envelopes, HKDF key hierarchy, SQLCipher migrations/FTS, durable storage tests                            |
| macOS secure-storage bootstrap            | Random vault key wrapped by an app-local Keychain key; no key or generic seal command crosses the webview                              |
| Gmail live provider contract              | Paginated snapshots, History deltas, expired-history reconciliation, bounded backoff, normalized mutations                             |
| Native Gmail OAuth/token boundary         | Loopback PKCE, one-shot state, refresh/revoke/removal, Keychain-only tokens, native authenticated HTTP                                 |
| Native Gmail durability                   | Atomic encrypted cursors/messages/threads/labels/contacts/attachment metadata/outbox records and restart tests                         |
| Microsoft 365 live provider               | Native public-client PKCE/Keychain boundary, Graph delta/throttling, folders/categories/conversations, and normalized unified inbox    |
| iOS repository project                    | Generated Tauri Xcode project, APNs/actions, NSE blind fallback, shared Keychain/App Group, background/share extensions, build gates   |
| Public web security evaluation            | Evidence-backed no-go decision covering browser keys, eviction/recovery, service workers, background sync, and notifications           |
| macOS release packaging                   | Valid icon set, sandbox/hardened-runtime entitlements, deep links, channel updater config, and release CI                              |
| Native recovery surfaces                  | Safe mode, database verification, encrypted same-device export/reset, and content-free diagnostics                                     |
| Security/privacy policy foundation        | Public drafts, testable requirements, OAuth/release/schema decisions                                                                   |
| Static security guards                    | No direct production logs or provider secrets in public clients                                                                        |
| Core Gmail mail workflows                 | Conversations, compose/drafts, durable delayed send, undo/retry/cancel, labels, bulk actions, and local search                         |
| Safe reading pane                         | Allowlist sanitizer plus sandboxed CSP document, remote-image controls, tracking stripping, and plain text                             |
| Attachment quarantine                     | Chunked Gmail download into encrypted native records with executable/oversize quarantine checks                                        |
| Local quality gates                       | Provider/sync/migration/MIME/service/Tauri tests, Playwright keyboard/offline/settings flows, axe, bundle and dependency policy checks |

## Prototype / stub (compilable scaffolding)

| Area                                    | Notes                                                                                                                                          |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Live Gmail account validation           | Engineering path is implemented; a registered Google Desktop client, test user, and restricted-scope verification are external                 |
| Microsoft Graph credentialed validation | Repository implementation is complete; Entra registration, tenant/admin approval, and real-mailbox validation are external                     |
| WebCrypto non-exportable keys + OPFS    | Authenticated WebCrypto envelope and fail-closed recovery/quota policy scaffolding exist; storage remains memory-only and keys are byte arrays |
| Wasm package                            | Uses the native XChaCha envelope format; not yet built into the Vite pipeline                                                                  |
| Signed/notarized macOS release          | Packaging and fail-closed CI are implemented; real Developer ID/updater secrets and Apple notarization remain external                         |
| APNs / Web Push dispatch                | Generic-only dispatch is implemented; production keys, topics/endpoints, and real-device delivery remain externally unvalidated                |
| Actionable iOS notifications            | Swift queue/build path complete; APNs provisioning and real-device provider reconciliation are unvalidated                                     |
| Notification Service Extension          | Encrypted local enrichment + generic fallback builds; **highest risk** App Group/Keychain/locked-device delivery remains unproven              |
| On-device ML classifier                 | Rules + corrections only                                                                                                                       |
| Receipt pixels / standard receipts      | Honest optional compose UI and local status contract; no production callback service                                                           |
| Remote AI processor                     | Consent boundary and rules processing are implemented; no external AI vendor is selected or enabled                                            |
| Hardware performance evidence           | Deterministic browser/bundle proxies are gated; packaged launch, 100k-message memory, and search need a pinned reference Mac                   |

## Blockers / risks

1. **Google live integration** — supply a Desktop client ID, complete consent-screen/test-user setup, add a real-account smoke test, and finish restricted-scope verification. The repository contains no provider credentials.
2. **Apple release authority** — supply a Developer ID Application certificate, Apple team/notarization credentials, and Tauri updater signing keys. No credential or notarization result is stored or claimed by the repository.
3. **Tauri iOS notification extensions** — NSE enrichment without leaking plaintext to APNs needs device validation; until then keep blind generic notifications.
4. **OAuth restricted scopes** — production domains/client IDs, Google
   verification and any required assessment are external; Microsoft app and
   publisher verification are required for its later release.
5. **External crypto review and portable recovery** — The AEAD/SQLCipher
   foundation is implemented but has not received an external audit. Safe-mode
   same-device export/reset exists, but public-key device linking, portable
   recovery, key rotation/revocation, and a truly non-exportable Secure Enclave
   wrapping design remain release blockers.
6. **Million-message search budgets** — Needs hardware baselines and production-scale profiling.
7. **Public web milestone** — The documented evaluation is no-go. Mocked recovery/quota/service-worker policy scaffolding exists, but non-exportable browser key custody, a durable OPFS/IndexedDB store, cross-browser eviction/background tests, and Web Push validation are not implemented release features.
8. **Provider/platform mail limits** — Gmail has no public snooze API, so snooze is a durable local archive/wake pair. Gmail send scheduling is not exposed; GalMail provides a durable local delayed-send outbox. Malware scanning after encrypted download depends on macOS quarantine and installed security tooling.
9. **Receipt reliability** — Standard receipts are recipient-controlled, and tracking pixels are distorted by Apple Mail Privacy Protection and image proxies. Neither can prove a human read a message.
10. **Hosted infrastructure ownership** — Cloudflare account/domain/WAF,
    deployment tokens, provisioned resource IDs, APNs/VAPID credentials,
    account-token issuance, trusted Gmail hint ingestion, and production
    region approval are external. The repository contains local configs and
    dry-run-ready Workers but no deployed resources or production credentials.
11. **Independent and staged evidence** — Cryptographic review, penetration
    testing, privacy review, disaster-recovery evidence, dogfood/alpha/beta
    metrics, and zero-open-P0/P1 confirmation remain required for stable. See
    `docs/release-candidate-checklist.md`.

## Recommended next engineering slice

1. Validate Gmail OAuth/sync/send/draft/mutation flows against a registered test account
2. Add the connection-state UI and native browser handoff
3. Provision Apple iOS identifiers/capabilities and validate APNs, NSE, actions,
   background work, and share handling on physical locked/unlocked devices
4. Register an Entra public client and validate Graph flows in consumer and
   enterprise tenants, including admin/conditional-access states
5. Keep the public web client disabled until every gate in
   `docs/public-web-security-evaluation.md` passes

## Latest local quality evidence

On 2026-07-15, `bun run quality:local` passed as one consolidated gate:

- 102 Bun tests, 16 Rust workspace tests, 10 Tauri command/native tests, and 4
  Playwright Chromium flows passed with no failures.
- All 10 TypeScript workspaces typechecked; seven packages, two Workers, the web
  app, and the local Tauri app/DMG bundles built successfully.
- Playwright covered keyboard mail/compose, settings persistence, offline local
  navigation, axe WCAG 2 A/AA, and a sub-50 ms keyboard-feedback browser proxy.
- The web output was 274,925 uncompressed bytes; JavaScript was 80.68 KiB gzip
  and CSS was 3.82 KiB gzip, all within enforced budgets.
- Bun reported zero known dependency vulnerabilities. RustSec reported zero
  vulnerabilities; it also reported 17 allowed warnings in Tauri's
  cross-platform dependency graph (primarily unmaintained Linux GTK3
  dependencies plus `RUSTSEC-2024-0429`). These warnings are not part of the
  macOS target but remain supply-chain cleanup evidence.
- License policy passed for 550 locked components and a CycloneDX 1.6 SBOM was
  generated successfully. Formatting, clippy with warnings denied, service
  dry-runs, and `git diff --check` passed.
- The credential-free iOS gate compiled the host Swift bridge, Notification
  Service Extension, share extension, and mock test bundle with signing disabled;
  two blind-payload XCTest cases passed on an iPhone 17 simulator, and the Rust
  shell cross-checked for `aarch64-apple-ios-sim`. A Tauri-orchestrated unsigned
  simulator archive also built locally using a transient non-signing team
  placeholder, which is not provisioning or device evidence.

This evidence makes the combined tree locally quality-gate-clean, but **not a
stable release candidate**. No local P0 defect is known. Remaining P1 release
issues are Google credentialed integration/verification, signed and notarized
Apple artifacts, deployed Cloudflare/APNs validation, independent crypto and
penetration reviews, portable recovery/key rotation, pinned-hardware
launch/search/memory measurements, and real staged-beta reliability evidence.
