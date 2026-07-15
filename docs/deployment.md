# GalMail Reproducible Deployment

## Client (web)

```bash
pnpm install
pnpm build
pnpm --filter @galmail/web preview
```

Static `apps/web/dist` can be served by any HTTPS origin (Cloudflare Pages, nginx, etc.).

## Client (Tauri macOS / iOS)

```bash
# Requires Rust + platform SDKs (Xcode for Apple targets)
pnpm install
pnpm tauri:dev          # development
pnpm tauri:build        # release (enable bundle + icons first)
```

iOS: configure `developmentTeam` in `apps/web/src-tauri/tauri.conf.json` and App Group `group.app.galmail.client`.

## Blind relay (self-host)

```bash
export RELAY_HMAC_SECRET="$(openssl rand -hex 32)"
export PORT=8787
pnpm --filter @galmail/blind-relay start
```

Deploy as a container or Cloudflare Worker port of the Hono app. The relay must never persist mail content.

## Opt-in processor (optional, isolated)

```bash
export OPTIN_DEFAULT_RETENTION_HOURS=0
export PORT=8788
pnpm --filter @galmail/opt-in-processor start
```

Run in a separate trust domain from the blind relay. Encrypt token vault at rest. Disable content logs.

## Reproducibility notes

- Lockfile: `pnpm-lock.yaml` (committed after first install)
- Rust: `Cargo.lock` (commit after first `cargo test`)
- Node 20+, pnpm 9+, Rust stable
- Fixture mode works without OAuth secrets

## Hosted service posture

Default hosted offering = blind relay + ciphertext blob store only. Opt-in processor is a separate product surface with explicit consent.
