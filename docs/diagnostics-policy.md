# Diagnostics Policy

Diagnostics and crash reporting are off by default. Operational health metrics
for hosted services are content-free and do not enable product analytics.

## Always forbidden

Default logs, metrics, traces, crash reports, support bundles, and incident
tickets must not contain:

- mail bodies, MIME parts, attachments, drafts, snippets, or decrypted blobs;
- subjects, sender/recipient addresses, contacts, or search queries;
- access tokens, refresh tokens, authorization codes, PKCE verifiers, cookies,
  session credentials, encryption keys, or push tokens; or
- raw request/response payloads from Gmail, Microsoft Graph, or remote
  processors.

Production source must not call direct logging APIs. The repository security
guard fails CI when direct console/Rust logging is added. Future structured
logging must accept an allowlisted event type and typed content-free fields,
with tests proving sensitive fields cannot be serialized.

## Allowed operational fields

Allowlisted fields are app/service version, release channel, platform and coarse
OS version, operation name, success/failure class, duration bucket, retry count,
HTTP status class, coarse region, queue depth, schema version, and random
request/incident identifiers. Account, message, device, and route identifiers
must be rotated or keyed hashes when correlation is essential.

URLs are recorded as route templates without query strings. Exceptions and
provider errors are mapped to stable error codes; raw messages and stack-local
values are excluded.

## User-consented diagnostics

An export preview shows every included field before sharing. Consent states the
recipient, purpose, expiration, and deletion date and can be withdrawn.
Content-bearing diagnostics require a separate support workflow and are never
enabled by the general diagnostics toggle. They are encrypted, access-limited,
and deleted when the support purpose ends.

## Verification

- CI runs `bun run security:check`.
- Tests use canary subjects, addresses, tokens, and body text and assert they
  never appear in emitted records or exported bundles.
- Release review verifies crash SDK configuration, sampling, scrubbing, and
  retention before each channel is enabled.
- Any logging exception requires a security architecture decision and a
  negative test.
