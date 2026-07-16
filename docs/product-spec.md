# GalMail Product Specification

**Version:** 0.1 · **Codename:** GalMail

## Vision

A Superhuman-speed, Linear-style local-first mail client that does not force users to trust a hosted service with their inbox — unless they explicitly opt a specific account into remote processing.

## Platforms

| Platform  | Shell               | UI                        |
| --------- | ------------------- | ------------------------- |
| Web / PWA | Browser adapters    | Shared React              |
| macOS     | Tauri 2 + WKWebView | Shared React              |
| iOS       | Tauri 2 + WKWebView | Shared React (responsive) |

Thin Swift only for APNs, notification actions/extensions, Keychain, OAuth presentation, App Groups.

## Personas

1. **Power triage user** — keyboard-first, multi-account, offline drafts.
2. **Privacy-conscious professional** — wants zero-access defaults.
3. **Self-hoster** — runs blind relay + optional processor.

## Core capabilities (v0.1 target)

- Gmail + Microsoft public-client OAuth (fixture mode until PKCE clients are registered and implemented)
- Initial + incremental sync; multi-account unified inbox
- Threads, labels/folders (provider semantics preserved)
- Compose / reply / forward; automatic drafts; attachments
- Local search; snooze; send later; undo
- Command palette + Superhuman-compatible shortcuts (`j/k`, archive, etc.)
- Offline durable outbox
- Blind push relay
- Encrypted device linking + settings/vault sync
- Actionable notifications (native path scaffolded)
- Local classification pipeline + privacy-labeled receipts
- Per-account remote opt-in with consent + retention

## Non-goals (v0.1)

- Full PGP/S/MIME production UX (post-core)
- Competing with Spark’s migration tooling day one
- Claiming subpoena-proof hosting

## UX principles

1. Hydrate local before network.
2. Optimistic UI + durable outbox.
3. One composition for primary views; adaptive layout, not separate apps.
4. Privacy consequences always visible when features weaken zero-access.
5. Keyboard discoverability (palette + cheatsheet).

## Provider semantics

Normalized view layer over:

- **Gmail:** labels, threads, history API
- **Microsoft Graph:** folders, categories, delta queries, conversation IDs

Unified inbox must not erase provider-specific identity (label vs folder).

## Open source & hosting

- MIT license
- Self-hostable blind relay and opt-in processor
- Optional hosted service with same privacy defaults

## Acceptance criteria (from plan)

- Same accounts work on macOS, iOS, web without losing drafts/actions/semantics
- Platform-specific code limited to reviewed adapters + Apple lifecycle glue
- Offline reading/triage/compose/search meet published budgets on supported hardware
- Default hosted service cannot decrypt mail/tokens/drafts/settings/vault
- Users can inspect, export, revoke, delete server-side objects and device keys
- Notification/AI settings show privacy consequence per account
