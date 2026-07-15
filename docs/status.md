# GalMail Status — Production vs Prototype

**As of:** 2026-07-15

## Production-ready (foundation quality)

| Area | Notes |
|------|-------|
| Monorepo layout | pnpm + Cargo workspaces, MIT license, README |
| Threat model / product / privacy docs | Living docs under `docs/` |
| Shared capability API | `@galmail/core-api` types + MemorySyncEngine + tests |
| HTML/URL security helpers | Sanitizer unit tests |
| Gmail fixture provider | Vertical slice without OAuth secrets |
| Microsoft fixture + unified inbox | Cross-provider merge tests |
| Keyboard registry | Superhuman-compatible defaults + conflict detection |
| Blind relay service | Rejects plaintext fields; HMAC registration helpers |
| Remote opt-in consent contracts + UX copy | Disclosure versioning enforced |
| Rust `galmail-core` | Outbox, seal/open, MIME helper, proptest seal roundtrip |

## Prototype / stub (compilable scaffolding)

| Area | Notes |
|------|-------|
| Live Gmail / Graph OAuth | Throws until `.env` secrets + token exchange implemented |
| SQLCipher / FTS | Not wired; encrypted blob store is in-memory / XOR-dev crypto |
| WebCrypto non-exportable keys + OPFS | Adapter flags + memory fallback only |
| Wasm package | Bindings present; not yet built into Vite pipeline |
| Tauri 2 macOS/iOS shell | Config + commands scaffolded; icons/bundle disabled; needs platform toolchain validation |
| APNs / Web Push dispatch | Relay queues hints only |
| Actionable iOS notifications | Swift stubs only |
| Notification Service Extension | Swift stub; **highest risk** — App Group + Keychain + Tauri wake unproven |
| On-device ML classifier | Rules + corrections only |
| Receipt pixels / standard receipts | Local status labels only |
| Opt-in processor | Isolated HTTP stub; no real provider sync/AI |
| Benchmark gates | Microbench stubs; not CI-hard-failing on hardware budgets |

## Blockers / risks

1. **Tauri iOS notification extensions** — NSE enrichment without leaking plaintext to APNs needs device validation; until then keep blind generic notifications.
2. **OAuth restricted scopes** — Google verification + Microsoft publisher verification required before real accounts.
3. **Production crypto** — Replace XOR-dev seal with audited AEAD (e.g. XChaCha20-Poly1305) + proper key wrap (HPKE/NaCl box).
4. **Million-message search budgets** — Needs SQLCipher/FTS implementation + hardware baselines.
5. **Browser eviction recovery** — OPFS quota UX not implemented.

## Recommended next engineering slice

1. Real OAuth PKCE for Gmail in fixture→live switch  
2. SQLCipher store behind `EncryptedStore` in Rust  
3. Wire Wasm seal into browser adapters  
4. Xcode validation of NSE + actionable categories  
