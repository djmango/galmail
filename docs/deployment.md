# GalMail Reproducible Deployment

## Client (web)

```bash
nix develop
bun install --frozen-lockfile
bun run build
bun run --filter @galmail/web preview
```

Static `apps/web/dist` can be served by any HTTPS origin (Cloudflare Pages, nginx, etc.).

## Client (Tauri macOS / iOS)

```bash
# Requires Rust + platform SDKs (Xcode for Apple targets)
bun install --frozen-lockfile
bun run tauri:dev          # development
bun run tauri:build        # release (enable bundle + icons first)
```

iOS: configure `developmentTeam` in `apps/web/src-tauri/tauri.conf.json` and App Group `group.app.galmail.client`.

## Cloudflare hosted service plane

The two Hono services are Workers modules with local Wrangler/Miniflare
bindings. They are intentionally separate deployments and D1 databases:

- `services/blind-relay`: authenticated opaque push hints, APNs/Web Push
  dispatch, ciphertext-only R2 sync, device approval/link/revoke, and account
  deletion.
- `services/opt-in-processor`: separately consented per-account processing,
  encrypted provider tokens, bounded retained inputs, and provider revocation.

No production resource IDs or credentials are committed. The checked-in
`wrangler.jsonc` files declare reproducible resource names and let Wrangler
provision bindings; an operator must authenticate the target Cloudflare
account and explicitly create/configure the external credentials below.

### Local setup

```bash
bun install --frozen-lockfile

z services/blind-relay
cp .dev.vars.example .dev.vars
bun run db:migrate:local
bun run types:check
bun run dev

# In a second shell:
z services/opt-in-processor
cp .dev.vars.example .dev.vars
bun run db:migrate:local
bun run types:check
bun run dev -- --port 8788
```

Use local-only test credentials. `TOKEN_ENCRYPTION_KEY` is a base64url-encoded
32-byte random value. `ACCOUNT_AUTH_SECRET` signs short-lived account-scoped
HS256 bearer tokens issued by the future authenticated account control plane;
it must never ship in a client. Device requests to relay data endpoints also
carry a P-256 signature, timestamp, and single-use nonce.

Apply and inspect local migrations without starting either Worker:

```bash
bun run --filter @galmail/blind-relay db:migrate:local
bun run --filter @galmail/opt-in-processor db:migrate:local
```

### Cloudflare staging/production setup

For each environment, authenticate Wrangler to the intended account, then
create the queues and dead-letter queues named in the corresponding config.
D1, R2, Analytics Engine, Queue, and rate-limit bindings are environment
specific. Never point staging at production resources.

```bash
# Create named queues once per environment (example: staging).
bunx wrangler queues create galmail-push-staging
bunx wrangler queues create galmail-push-dlq-staging
bunx wrangler queues create galmail-revocation-staging
bunx wrangler queues create galmail-revocation-dlq-staging

# Provision/resolve the D1 and R2 declarations, then apply migrations.
z services/blind-relay
bunx wrangler d1 migrations apply DB --env staging --remote
bun run deploy:dry-run

z ../opt-in-processor
bunx wrangler d1 migrations apply DB --env staging --remote
bun run deploy:dry-run
```

Set every required secret interactively for each service/environment with
`wrangler secret put NAME --env staging` (and separately with
`--env production`). Do not pass values on the command line. Required secrets
are declared in each `wrangler.jsonc`.

Relay external setup:

1. Create an APNs token key and record its team ID, key ID, private key, and
   GalMail app topic. APNs payloads are always generic and contain no mail
   fields.
2. Generate a P-256 VAPID key pair and HTTPS `mailto:`/URL subject for Web
   Push. The Worker sends an empty Web Push signal; the client fetches Gmail.
3. Issue a distinct high-entropy `RELAY_INGRESS_SECRET` only to the trusted
   Gmail notification ingestion component.
4. Place WAF/API Shield rules in front of public routes. The in-Worker
   rate-limit bindings are a second layer, not a replacement for zone-level
   abuse controls.

Processor external setup:

1. Deploy into the documented Cloudflare region/jurisdiction and make the
   consent screen's region exactly match `PROCESSING_REGION`.
2. Keep the processor on a separate hostname and least-privilege deployment
   token from the blind relay.
3. Complete Google OAuth restricted-scope approval before accepting real
   provider tokens. Revocation uses Google's documented token revocation
   endpoint and retries through a queue.

After resources and secrets exist:

```bash
bun run --filter @galmail/blind-relay deploy:staging
bun run --filter @galmail/opt-in-processor deploy:staging
# Repeat the reviewed migration/dry-run/deploy process for production.
```

Cloudflare R2 encryption at rest is supplemented by client-side authenticated
ciphertext: the sync Worker accepts only the versioned ciphertext media type,
hash, and monotonically increasing revision. It never receives a vault key.
Configure an R2 lifecycle safety net only after confirming it cannot delete
active sync objects; the hourly Worker retention task is the source of truth.

### Operational privacy and deletion

Workers Logs are sampled but application code emits no request/content logs.
Analytics Engine records only service event, coarse outcome, environment, and
count. D1 audit rows contain opaque IDs or account hashes and expire
automatically. Blind event metadata expires within 24 hours; stale push routes
disable after 90 days; audit/deletion receipts expire after 30 days.

Account deletion removes R2 objects before D1 account metadata. Remote consent
revocation immediately disables processing, erases retained input, removes the
active token, and queues provider revocation. The encrypted retry credential is
destroyed after success or after the configured 24-hour retry ceiling.

## Reproducibility notes

- JavaScript runtime/package manager: Bun 1.3.14 (`packageManager` and Nix shell)
- Lockfile: `bun.lock`; CI uses `bun install --frozen-lockfile`
- Dev shell: `flake.nix` and `flake.lock` pin Bun, Rust, Tauri dependencies, and Apple build helpers
- The Nix macOS shell currently targets Apple Silicon; Intel packaging remains a later release decision
- Rust: `Cargo.lock` (commit after first `cargo test`)
- macOS native builds require Xcode Command Line Tools in addition to `nix develop`
- Fixture mode works without OAuth registration
- Native production OAuth uses provider public-client IDs and PKCE; never
  provision a provider client secret to a distributed app

## Hosted service posture

Default hosted offering = blind relay + ciphertext blob store only. Opt-in processor is a separate product surface with explicit consent.

Production blockers that cannot be created from this repository are:
Cloudflare account/domain/WAF ownership, deployment API tokens, final resource
IDs after provisioning, APNs credentials/topic, VAPID keys, the authenticated
account-token issuer, trusted Gmail hint ingestion, Google OAuth verification,
and a reviewed production region/retention disclosure.
