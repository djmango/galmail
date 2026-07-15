# GalMail

**GalMail** is an open-source, privacy-first, keyboard-first email client for **Gmail** and **Microsoft 365** on **macOS**, **iOS**, and **web**.

One React/TypeScript UI ships everywhere. Tauri 2 hosts Apple shells (WKWebView). A Rust native core handles sync, encrypted storage, MIME, search, and mutation queues. Browsers use Wasm + IndexedDB/OPFS + WebCrypto adapters. The default hosted relay is **blind** (no plaintext mail or OAuth tokens). Per-account remote processing/AI is **opt-in** with explicit consent.

> GalMail is privacy-first. It is **not** subpoena-proof. Provider-hosted plaintext, recipient copies, forwarding systems, and organizational archives remain outside GalMail’s control.

## Architecture

```
Gmail API / Microsoft Graph
        │
        ▼
 Blind event relay ──► APNs / Web Push
        │
 Shared React app ──► Browser (Wasm + adapters)
        │          └─► Tauri macOS/iOS (Rust core)
        │
 Encrypted blob sync (settings/vault) ◄── zero-access
 Opt-in remote processor (per account, isolated)
```

| Layer | Role |
|-------|------|
| `apps/web` | Shared React + Vite UI; Tauri 2 shell in `src-tauri` |
| `packages/core-api` | Shared capability contracts (`MailProvider`, `SyncEngine`, …) |
| `packages/providers` | Gmail + Microsoft Graph adapters (fixture mode by default) |
| `packages/browser-adapters` | IndexedDB/OPFS/WebCrypto storage & crypto |
| `packages/keyboard` | Superhuman-compatible command registry |
| `packages/sync` | Device linking & encrypted settings/vault sync |
| `packages/notifications` | Classification pipeline & receipt labels |
| `packages/remote-opt-in` | Consent, retention, remote processor client |
| `crates/galmail-core` | Rust sync/storage/MIME/search/outbox/crypto |
| `crates/galmail-wasm` | Bounded Wasm bindings for browser |
| `services/blind-relay` | Opaque webhook → push hints (no plaintext) |
| `services/opt-in-processor` | Isolated opt-in sync/AI service stub |
| `swift/GalMailApple` | Thin APNs / Keychain / OAuth presentation glue |

## Privacy model (default)

- Vault key generated on-device; wrapped per authorized device + recovery key.
- Server stores authenticated ciphertext and opaque routing metadata only.
- OAuth tokens stay in Keychain (native) or non-exportable WebCrypto (browser).
- Telemetry off by default; remote images blocked; HTML sanitized/isolated.
- Blind notifications may be delayed/generic — explained in settings, not silently weakened.

See [docs/threat-model.md](docs/threat-model.md), [docs/privacy-model.md](docs/privacy-model.md), and [docs/status.md](docs/status.md).

## Quick start

```bash
# Prerequisites: Node 20+, pnpm 9+ (corepack pnpm if needed), Rust stable (for native/core)
corepack pnpm install   # or: pnpm install
pnpm --filter @galmail/core-api build
pnpm --filter @galmail/providers build
pnpm --filter @galmail/web build
pnpm test
pnpm core:test

# Web UI (fixture Gmail mailbox — no OAuth secrets required)
pnpm dev

# Blind relay (local)
pnpm relay:dev

# Tauri desktop (requires Rust + platform deps)
pnpm tauri:dev
```

### Environment templates

Copy and fill only when using real OAuth (never commit secrets):

```bash
cp .env.example .env
```

Fixture mode is the default (`GALMAIL_PROVIDER_MODE=fixture`).

## Performance budgets

| Metric | Target |
|--------|--------|
| Cold launch | < 800 ms |
| Warm launch | < 300 ms |
| Local inbox/search first results | < 100 ms |
| Keyboard action visual feedback | < 50 ms |

Harness stubs live under `benches/` and `packages/core-api` benchmarks. Methodology: [docs/performance-budgets.md](docs/performance-budgets.md).

## Local-first workflow

1. Hydrate from encrypted local store  
2. Render from in-memory observable graph  
3. Optimistic mutate + durable outbox  
4. Incremental provider deltas  
5. Lazy body/attachment hydration + virtualized lists  

## Status

This repository is a **solid foundation + Gmail vertical slice** with Microsoft, sync, notifications, and remote opt-in scaffolding. See [docs/status.md](docs/status.md) for production-ready vs prototype/stub and known blockers (especially Tauri iOS notification extensions).

## License

MIT — see [LICENSE](LICENSE).
