# GalMail Privacy Model

This architecture model is implemented only where `docs/status.md` says so.
Test evidence and current status are tracked as PR-01 through PR-06 in
[security-requirements.md](security-requirements.md). The public-facing notice
is [privacy-policy.md](privacy-policy.md).

## Default: zero-access hosted path

The default GalMail service (blind relay + encrypted blob store) is designed so the operator **cannot** decrypt:

- Email bodies / attachments
- Drafts
- OAuth tokens
- Settings / vault content

Server-side objects are opaque ciphertext or routing metadata.

## What GalMail cannot protect

- Provider-hosted plaintext (Gmail / Microsoft)
- Recipient copies and forwarders
- Organizational retention / journaling / eDiscovery
- Lawful process against the user or their devices
- Residual metadata (approx. sync times, device count)

**Do not claim GalMail is subpoena-proof.**

## Modes

| Mode                        | Mail plaintext to GalMail servers | Tokens on GalMail servers |
| --------------------------- | --------------------------------- | ------------------------- |
| Blind (default)             | No                                | No                        |
| Remote opt-in (per account) | Yes, for that account             | Yes, isolated processor   |

## Crypto sketch

1. Generate random vault key on device
2. Wrap vault key for each authorized device + user recovery key
3. Store only authenticated ciphertext server-side
4. Crypto-erasure = destroy keys (ciphertext becomes unreadable)

## Client protections

- Block remote images by default
- Sanitize and isolate HTML
- Quarantine active attachments
- Telemetry disabled by default

## User rights

Users must be able to inspect, export, revoke, and delete every server-side object and device key (implemented as API contracts + UI scaffolding in this repo).

Release evidence must include a clean-install diagnostics-consent test, remote
consent-version test, account deletion with injected provider failure, automatic
retention expiry, and an export showing every GalMail-controlled object.
