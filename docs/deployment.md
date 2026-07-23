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
bun run tauri:dev          # development (run from repo via package scripts)
bun run tauri:build        # release (enable bundle + icons first)
```

**macOS Dock / menu name:** `productName`, `mainBinaryName`, and the Cargo `[[bin]]` are
all `GalMail`. After pulling, a fresh `tauri:dev` should show **GalMail** in the Dock
(not `galmail-tauri`). No regenerating of iOS Xcode projects is required for this.

**macOS Keychain prompts in `tauri:dev`:** Ad-hoc/linker-signed debug binaries change
identity on every rebuild, so Keychain ACLs re-prompt. `tauri.macos.conf.json` uses
`scripts/macos-dev-runner.sh` to codesign the debug binary with your
`Apple Development:` identity (override with `GALMAIL_DEV_CODESIGN_IDENTITY`). Debug
builds also rewrite GalMail Keychain items with an allow-all-apps ACL (compiled out of
release). Production / Developer ID / notarized builds use the default app-bound ACL
and should **not** prompt every launch when the Team ID stays the same.

If an old item still prompts once after upgrading: unlock Keychain when asked, or delete
`com.galmail.app.vault` / `com.galmail.app.oauth` items in Keychain Access and relaunch
so they are recreated under the new ACL/signature.

iOS: configure `developmentTeam` in `apps/web/src-tauri/tauri.conf.json` and App Group `group.com.galateacorp.mail`.

### TestFlight CI (push to `master`)

The `ios-testflight` workflow builds, signs, and uploads an IPA to App Store
Connect TestFlight on every push to `master` (and on manual
`workflow_dispatch`). It runs on `macos-26` with Xcode 26+ (App Store Connect
rejects iOS SDKs older than 26). Build numbers are
`max(App Store Connect latest + 1, GITHUB_RUN_NUMBER)`.

#### Secrets model (sops)

Apple CI credentials are **committed encrypted** in `secrets/ci/apple.yaml`.
`.sops.yaml` encrypts that path to:

1. **Your SSH key** (`ssh-ed25519` …) — local decrypt/edit (`sops secrets/ci/apple.yaml`)
2. **CI age key** (`age1u6fxm…` / `&galmail_ci`) — GitHub Actions decrypt only

Dev overlays under `secrets/dev*.yaml` stay **operator-only** (CI cannot read them).

The only Actions secret required for TestFlight is:

| Secret         | Value                                                                 |
| -------------- | --------------------------------------------------------------------- |
| `SOPS_AGE_KEY` | Private age key matching `&galmail_ci` in `.sops.yaml` (never commit) |

Contents of `secrets/ci/apple.yaml` (after decrypt):

| Key                                     | Value                                                                                                              |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `APP_STORE_CONNECT_API_KEY_ID`          | Key ID from App Store Connect → Users and Access → Integrations                                                    |
| `APP_STORE_CONNECT_API_ISSUER_ID`       | Issuer ID shown above the keys table                                                                               |
| `APP_STORE_CONNECT_API_KEY`             | Full PEM of the downloaded `AuthKey_*.p8` (App Manager or Admin)                                                   |
| `IOS_DISTRIBUTION_CERTIFICATE_BASE64`   | `base64 < Apple_Distribution.p12` (Distribution identity only)                                                     |
| `IOS_DISTRIBUTION_CERTIFICATE_PASSWORD` | Password for that `.p12`                                                                                           |
| `IOS_PROVISIONING_PROFILES_BASE64`      | Optional. `tar czf - *.mobileprovision \| base64` for the App Store profiles named in `ExportOptions-upload.plist` |
| `IOS_KEYCHAIN_PASSWORD`                 | Optional CI keychain password (defaults to a fixed local value)                                                    |

Keep a backup of `SOPS_AGE_KEY` outside GitHub (for example 1Password). GitHub
does not let you read a secret back after it is set. Rotate by generating a new
age pair, updating `&galmail_ci` in `.sops.yaml`, running
`sops updatekeys secrets/ci/apple.yaml` (decrypts with your SSH key), and
replacing the Actions secret. Revoke/replace the App Store Connect `.p8` and
Distribution certificate the same way you would for any leaked signing material.

Edit locally (SSH-age; works with your normal SSH key):

```bash
sops secrets/ci/apple.yaml
# or re-encrypt after a plaintext fill:
#   cp secrets/ci/apple.example.yaml /tmp/apple.plain.yaml
#   # fill, then: sops -e /tmp/apple.plain.yaml > secrets/ci/apple.yaml
bun run secrets:check   # fail CI/local if any secrets/* file is plaintext
```

Local archive without CI (same env names, plus a path to the `.p8`):

```bash
export APP_STORE_CONNECT_API_KEY_PATH=~/.appstoreconnect/private_keys/AuthKey_$APP_STORE_CONNECT_API_KEY_ID.p8
export GALMAIL_IOS_BUILD_NUMBER=123   # optional override
bun run ios:archive:testflight
```

## Homelab Docker stack (self-hosted)

For operators who want push registration, consent sync, and optional AI on
their own metal first, use the Compose stack under `deploy/homelab/`:

- `services/homelab-api`: Bun/Hono BFF (Postgres-backed)
- `postgres:16`: device tokens, consent, optional retained classify inputs

```bash
cp deploy/homelab/.env.example deploy/homelab/.env
# fill ACCOUNT_AUTH_SECRET, API_ADMIN_TOKEN, POSTGRES_PASSWORD, APNs, AI base URL
docker compose -f deploy/homelab/docker-compose.yml --env-file deploy/homelab/.env up -d --build
curl -s http://127.0.0.1:8789/health
```

Point clients at `VITE_GALMAIL_API_URL` (HTTPS via Caddy/Traefik). Full
architecture, Apple APNs checklist, and route list:
[deploy/homelab/README.md](../deploy/homelab/README.md).

This does **not** replace the Cloudflare Workers plane. Blind relay + opt-in
processor remain the managed edge path; the homelab API is a focused v1
skeleton without R2 sync or Gmail ingress parity.

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
