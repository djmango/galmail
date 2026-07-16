# Retention and Deletion Policy

**Effective date:** July 15, 2026

## Default retention

| Data                                            | Default period                                        | Deletion trigger                                                          |
| ----------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------- |
| Local mail cache, indexes, drafts, and settings | Until account removal or app uninstall                | Account removal performs key destruction and deletes the account database |
| OAuth tokens on device                          | Until revocation, account removal, or provider expiry | Revoke at provider, then remove Keychain entry                            |
| Encrypted sync blobs and wrapped keys           | Until account/device removal                          | Delete blobs, wraps, and device records                                   |
| Blind relay event records                       | At most 24 hours                                      | Automatic expiry or account removal                                       |
| Push routing registrations                      | Until device/account removal or 90 days inactive      | Delete registration                                                       |
| Service security/audit events                   | 30 days                                               | Automatic expiry                                                          |
| Default diagnostics                             | Not collected                                         | Not applicable                                                            |
| User-consented diagnostics                      | 14 days unless the consent screen states less         | Automatic expiry or verified deletion request                             |
| Remote-processing content                       | Zero hours by default; request-scoped in memory       | Destroy after response                                                    |
| Remote-processing credentials                   | While consent is active                               | Revoke and delete when disabled                                           |

Backups, when introduced, must be encrypted, access-controlled, and expire
within 30 days. Deleted records may persist in an immutable backup until that
backup expires, but must not be restored into active service except for
disaster recovery.

## Deletion behavior

Account removal is an idempotent workflow:

1. stop synchronization, queued work, notifications, and remote processing;
2. revoke provider and remote credentials where supported;
3. destroy local keys and delete local databases, attachments, and indexes;
4. delete encrypted sync blobs, key wraps, device records, and relay routes;
5. retain only a content-free deletion receipt containing operation ID,
   completion state, and coarse timestamp for 30 days.

If a provider is unavailable, local deletion continues and provider revocation
is retried. The UI must show partial completion without claiming full deletion.
Deletion does not remove mail held by Gmail, Microsoft, recipients, employers,
or legal archives.

## Exceptions

GalMail may preserve the minimum records required for fraud prevention, legal
obligations, dispute resolution, or a litigation hold. The reason, scope,
approver, and expiration must be recorded. Mail content is not retained merely
for analytics or product improvement.

## Verification requirements

- Automated expiry tests cover each hosted data class.
- Account-removal tests prove retries are idempotent and keys become
  inaccessible.
- Quarterly restore exercises confirm expired data is not returned to active
  systems.
- Production launch is blocked until the implemented storage jobs match this
  policy.
