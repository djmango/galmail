# GalMail Threat Model

**Version:** 0.1 · **Status:** Living document · **Product:** GalMail

GalMail optimizes for privacy-first local-first mail. It does **not** claim subpoena resistance or immunity from provider/org retention.

## Assets

| Asset | Sensitivity | Default location |
|-------|-------------|------------------|
| OAuth refresh/access tokens | Critical | Keychain / non-exportable WebCrypto |
| Vault key + device wraps | Critical | Device secure storage; wraps may sync as ciphertext |
| Message bodies / attachments | High | Encrypted local DB (native) / OPFS+WebCrypto (browser) |
| Drafts, outbox mutations | High | Encrypted local + durable outbox |
| Settings / labels preferences | Medium | Encrypted blob sync |
| Push routing tokens | Medium | Blind relay (opaque) |
| Opt-in remote tokens (if enabled) | Critical | Isolated processor vault only |

## Adversaries

1. **Compromised GalMail hosted service** — default blind relay operator or infrastructure attacker.
2. **Network attacker** — MITM, malicious Wi‑Fi, compromised CDN.
3. **Malicious email content** — HTML/JS, tracking pixels, phishing URLs, weaponized attachments.
4. **Stolen / lost device** — physical access, forensic extraction of app data.
5. **Malicious remote AI / processor vendor** — if user opts an account into remote processing.
6. **Insider / forced disclosure** — lawful process against GalMail operator or user.
7. **Provider compromise** — Gmail / Microsoft tenant already holds plaintext.

## Trust boundaries

```
[User device] --OAuth--> [Gmail / Graph]
[User device] --opaque events--> [Blind relay] --hints--> [APNs / Web Push]
[User device] --ciphertext blobs--> [Encrypted sync store]
[Opted-in account only] --tokens+mail--> [Opt-in processor]
```

Default hosted path must never receive plaintext mail, drafts, or provider tokens.

## Threats and mitigations

### T1 — Service compromise (blind relay / blob store)

| Risk | Mitigation |
|------|------------|
| Read user mail | No plaintext on server; authenticated encryption client-side |
| Steal OAuth tokens | Tokens never leave device in default mode |
| Correlate activity | Opaque IDs, minimize metadata; document residual metadata |
| Inject push spam | HMAC-signed registration; device attestation later |

**Residual:** metadata (approx. event times, device count) may leak.

### T2 — Malicious email HTML

| Risk | Mitigation |
|------|------------|
| XSS in WebView | Sanitize + isolate HTML; CSP; no inline script |
| Tracking | Block remote images by default; proxy optional later |
| Phishing | URL rewrite/preview; warn on lookalikes |
| Attachments | Quarantine; open externally with OS handlers |

### T3 — Stolen device

| Risk | Mitigation |
|------|------------|
| Read cache | SQLCipher / WebCrypto at rest; OS lockscreen |
| Exfil tokens | Keychain / non-exportable keys |
| Recovery abuse | Recovery key held by user; crypto-erasure via key destroy |

### T4 — Telemetry / analytics

Default: **off**. If enabled later, must be opt-in, minimal, and never include message content.

### T5 — Remote AI / processing (opt-in)

| Risk | Mitigation |
|------|------------|
| Silent zero-access break | Explicit per-account consent UX with plain-language consequence |
| Long retention | Configurable zero/short retention; default zero hours |
| Logging | Prohibit content logging; isolate tokens per account |
| Vendor subpoena | Disclose residual; not marketed as subpoena-proof |

### T6 — Account recovery

Recovery key is user-held. Lost recovery key + all devices = permanent vault loss (by design for zero-access). Document clearly; no server-side “reset password” for vault contents.

### T7 — Sync / cursor attacks

Property tests for duplicate delivery, stale Gmail history IDs, Graph ID changes, offline conflicts, crash recovery. Reject unauthenticated ciphertext.

## Out of scope (explicit)

- Making provider deletion revoke recipient copies
- Defeating corporate eDiscovery / journaling
- Hiding metadata from mail providers
- Guaranteeing unread/open privacy against privacy proxies

## Security tests (required before hosted launch)

See [crypto-review-checklist.md](crypto-review-checklist.md) and CI security tests for HTML sanitization, URL handling, attachment isolation, key rotation, encrypted sync validation, and plaintext-log guards.
