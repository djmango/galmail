# Schema, Envelope, and Rollback Policy

App versions use SemVer. Persistent formats have independent monotonically
increasing integer versions:

- `database_schema_version` for SQLCipher tables and indexes;
- `blob_envelope_version` for encrypted local/sync objects;
- `consent_version` for remote-processing disclosures; and
- provider cursor versions for normalized provider state.

Changing a persistent shape requires a version bump, migration, compatibility
fixture, failure test, and release note. App SemVer never substitutes for a data
version.

## Migration rules

Migrations are ordered, transactional, idempotent where retried, and never
silently skip an unknown version. Before a destructive migration, verify free
space and create an encrypted, integrity-checked backup. The backup key remains
in platform secure storage and the backup expires after the release reaches a
healthy state.

Each migration test covers empty, representative, maximum-supported prior, and
interrupted databases. Ciphertext migrations authenticate the old envelope
before writing the new one and preserve associated-data bindings.

## Compatibility

Stable supports direct upgrade from the previous stable minor release. Older
installations must step through a documented migrator or export/import path.
Readers reject unknown future major envelope versions and preserve their bytes
without destructive rewriting.

Additive fields use safe defaults. Removing or reinterpreting a field requires
a new format version. Consent never migrates implicitly to a broader purpose,
field set, processor, region, or retention period.

## Rollback

A release declares its minimum and maximum readable schema and envelope
versions. The updater checks these before launch. If an older binary cannot read
current data safely, downgrade fails closed with recovery instructions.

Rollback order is:

1. stop rollout and disable the affected feature;
2. prefer a forward fix that retains current data;
3. use a tested reversible down-migration only when it loses no accepted user
   operation; or
4. restore the encrypted pre-migration backup with explicit confirmation and a
   clear list of operations that occurred after the backup.

Never restore ciphertext under reused nonces or restore provider cursors without
forcing reconciliation. Failed migration and recovery attempts emit only
content-free status codes.
