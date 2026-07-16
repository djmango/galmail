# Security Policy

## Supported releases

GalMail has not published a stable release. Prototype builds are unsupported
and must not be used with sensitive accounts. Once releases begin, the current
stable minor release receives security fixes; alpha and beta builds receive
best-effort fixes and may require upgrading.

## Report a vulnerability

Email `security@galmail.app` with:

- affected version, platform, and component;
- reproduction steps and impact;
- proof-of-concept material with secrets and personal data removed; and
- a safe way to contact you.

Do not file public issues for undisclosed vulnerabilities. Do not access data
that is not yours, disrupt service, send bulk traffic, or retain personal data.
We do not currently operate a bug bounty and cannot promise payment.

We target acknowledgement within two business days, initial triage within five
business days, and a remediation plan within ten business days. Timelines may
change with severity and dependency or provider coordination. We will credit
reporters who request credit after a coordinated disclosure date is agreed.

## Response ownership

The security owner is the release incident commander until a dedicated
security lead is assigned. That owner triages reports, assigns severity, keeps
an incident record, coordinates provider notices, approves fixes, and decides
disclosure timing. A stable release is blocked by any open P0/P1 security or
data-loss issue.

## Security boundaries

The default hosted path is designed not to receive plaintext mail or OAuth
tokens. This claim does not apply when a user explicitly enables remote
processing for an account. Gmail and Microsoft retain provider-hosted mail, and
GalMail cannot prevent recipient retention, organizational eDiscovery, or
lawful access to a user's device.

See `docs/threat-model.md`, `docs/privacy-policy.md`, and
`docs/incident-response.md` for the current controls and response process.
