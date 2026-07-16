# Security and Privacy Incident Response

## Severity

- **P0:** active compromise, exposed tokens or mail content, destructive
  cross-account access, or unsafe release broadly deployed.
- **P1:** likely sensitive-data exposure, exploitable auth boundary failure, or
  material deletion/retention failure with limited scope.
- **P2:** contained weakness without known sensitive-data access.
- **P3:** hardening or policy issue with no immediate exploit.

P0/P1 incidents block stable releases. The incident commander owns containment
and may disable hosted features, revoke credentials, or stop an update channel.

## Runbook

1. **Receive and record:** open a restricted incident record, assign commander,
   timestamp, severity, affected systems, and evidence owner.
2. **Contain:** preserve privacy-safe evidence; isolate services and accounts;
   rotate affected service credentials; revoke provider tokens if warranted.
3. **Assess:** identify data classes, users, regions, time range, root cause,
   attacker access, and whether backups or processors are affected.
4. **Eradicate and recover:** patch, test, deploy progressively, verify
   revocation/deletion, and monitor content-free indicators.
5. **Notify:** security and privacy owners decide user, provider, regulator, and
   processor notices against applicable deadlines. Legal review is required;
   the runbook does not assume a universal notification period.
6. **Close:** publish an appropriate summary, track corrective actions, and
   complete a blameless review within ten business days of recovery.

## Evidence handling

Never copy mail content, recipients, subjects, tokens, decrypted blobs, or
search queries into tickets, chat, logs, or postmortems. Use opaque incident,
account, request, and device identifiers. If content is essential, obtain
documented time-bounded approval, encrypt it separately, restrict access, and
destroy it when the incident closes.

## Required records

The restricted record contains the timeline, decisions and approvers, affected
data categories, credential rotations, deletion/revocation results,
notifications, release hashes, and corrective-action owners. Access is limited
to the response team.

## Exercises

Run a tabletop before beta, before stable, and at least annually thereafter.
Run a restore/deletion exercise at least quarterly once hosted storage exists.
Record gaps as release-blocking P1 items when they can expose or lose user data.
