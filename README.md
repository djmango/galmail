# GalMail

**GalMail** is an open-source, privacy-first, keyboard-first email client for **Gmail** and **Microsoft 365** on **macOS**, **iOS**, and **web**.

One React/TypeScript UI ships everywhere. Tauri 2 hosts Apple shells (WKWebView). A Rust native core handles sync, encrypted storage, MIME, search, and mutation queues. Browser support is currently fixture-only while WebCrypto and storage-recovery adapters are evaluated. The default hosted relay is **blind** (no plaintext mail or OAuth tokens). Per-account remote processing/AI is **opt-in** with explicit consent.

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

| Layer                       | Role                                                          |
| --------------------------- | ------------------------------------------------------------- |
| `apps/web`                  | Shared React + Vite UI; Tauri 2 shell in `src-tauri`          |
| `packages/core-api`         | Shared capability contracts (`MailProvider`, `SyncEngine`, …) |
| `packages/providers`        | Gmail + Microsoft Graph adapters (fixture mode by default)    |
| `packages/browser-adapters` | WebCrypto plus IndexedDB/OPFS recovery-policy scaffolding     |
| `packages/keyboard`         | Superhuman-compatible command registry                        |
| `packages/sync`             | Device linking & encrypted settings/vault sync                |
| `packages/notifications`    | Classification pipeline & receipt labels                      |
| `packages/remote-opt-in`    | Consent, retention, remote processor client                   |
| `crates/galmail-core`       | Rust sync/storage/MIME/search/outbox/crypto                   |
| `crates/galmail-wasm`       | Bounded Wasm bindings for browser                             |
| `services/blind-relay`      | Opaque webhook → push hints (no plaintext)                    |
| `services/opt-in-processor` | Isolated opt-in sync/AI service stub                          |
| `swift/GalMailApple`        | Thin APNs / Keychain / OAuth presentation glue                |

## Privacy model (default)

- Vault key generated on-device; wrapped per authorized device + recovery key.
- Server stores authenticated ciphertext and opaque routing metadata only.
- OAuth tokens stay in Keychain (native) or non-exportable WebCrypto (browser).
- Telemetry off by default; remote images blocked; HTML sanitized/isolated.
- Blind notifications may be delayed/generic — explained in settings, not silently weakened.

See [docs/threat-model.md](docs/threat-model.md),
[docs/privacy-model.md](docs/privacy-model.md),
[docs/architecture-decisions.md](docs/architecture-decisions.md), and
[docs/status.md](docs/status.md).

## Quick start

```bash
# Recommended: reproducible Bun, Rust, and Tauri prerequisites
nix develop

# Without Nix: install Bun 1.3.14 and stable Rust
bun install --frozen-lockfile
bun run build
bun test
bun run rust:test

# Web UI (fixture Gmail mailbox — no OAuth registration required)
bun run dev

# Blind relay (local)
bun run relay:dev

# Tauri desktop (macOS also requires Xcode Command Line Tools)
bun run tauri:dev
```

`package.json`, `bun.lock`, `flake.nix`, and `flake.lock` pin the package
manager, JavaScript graph, and Nix shell. CI installs with
`bun install --frozen-lockfile`; update dependencies with Bun 1.3.14 and commit
the resulting lockfile.

### Local secrets (sops, no `.env`)

Dev config lives in `secrets/dev.json` (SSH-age encrypted). Never create a
`.env`. `bun run dev` / `bun run tauri:dev` load secrets via
`sops exec-env`.

```bash
# first time: encrypt from the example, then import Google Desktop client JSON
cp secrets/dev.example.json secrets/dev.json
sops -e -i secrets/dev.json
bun scripts/import-google-oauth-json.ts ~/Downloads/client_secret_*.json

# edit later
bun run secrets:edit   # opens sops secrets/dev.json

# fixture UI without decrypting secrets
bun run dev:fixture
```

`VITE_GOOGLE_DESKTOP_CLIENT_ID` is the public client ID (safe for the webview).
`GOOGLE_DESKTOP_OAUTH_JSON` (in `secrets/google-desktop-oauth.json` or
`secrets/dev.json`) holds the Desktop client download, including Google’s
desktop `client_secret`. Google still requires that secret on the token
endpoint even with PKCE; only the native Tauri process reads it from sops.

Security and privacy policies: [SECURITY.md](SECURITY.md),
[privacy policy](docs/privacy-policy.md), and
[testable requirements](docs/security-requirements.md).
## Performance budgets

| Metric                           | Target   |
| -------------------------------- | -------- |
| Cold launch                      | < 800 ms |
| Warm launch                      | < 300 ms |
| Local inbox/search first results | < 100 ms |
| Keyboard action visual feedback  | < 50 ms  |

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
