PRAGMA foreign_keys = ON;

CREATE TABLE accounts (
  account_id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
) STRICT;

CREATE TABLE devices (
  account_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  identity_jwk TEXT NOT NULL,
  approved_by TEXT,
  approved_at INTEGER NOT NULL,
  revoked_at INTEGER,
  last_seen_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, device_id),
  FOREIGN KEY (account_id) REFERENCES accounts(account_id) ON DELETE CASCADE
) STRICT;

CREATE INDEX devices_active_account
  ON devices(account_id, revoked_at, last_seen_at);

CREATE TABLE device_invites (
  invite_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  created_by TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (account_id, created_by)
    REFERENCES devices(account_id, device_id) ON DELETE CASCADE
) STRICT;

CREATE INDEX device_invites_expiry ON device_invites(expires_at, used_at);

CREATE TABLE replay_nonces (
  account_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  nonce_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, device_id, nonce_hash),
  FOREIGN KEY (account_id, device_id)
    REFERENCES devices(account_id, device_id) ON DELETE CASCADE
) STRICT;

CREATE INDEX replay_nonces_expiry ON replay_nonces(expires_at);

CREATE TABLE sync_blobs (
  account_id TEXT NOT NULL,
  blob_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (
    kind IN ('settings', 'preferences', 'wrapped_key', 'device_record')
  ),
  object_key TEXT NOT NULL UNIQUE,
  ciphertext_sha256 TEXT NOT NULL,
  byte_length INTEGER NOT NULL,
  envelope_version INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER,
  PRIMARY KEY (account_id, blob_id),
  FOREIGN KEY (account_id, updated_by)
    REFERENCES devices(account_id, device_id) ON DELETE CASCADE
) STRICT;

CREATE INDEX sync_blobs_account_updated
  ON sync_blobs(account_id, updated_at);
CREATE INDEX sync_blobs_expiry ON sync_blobs(expires_at);

CREATE TABLE push_routes (
  route_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('apns', 'webpush')),
  endpoint_ciphertext TEXT NOT NULL,
  endpoint_nonce TEXT NOT NULL,
  endpoint_key_version INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  disabled_at INTEGER,
  FOREIGN KEY (account_id, device_id)
    REFERENCES devices(account_id, device_id) ON DELETE CASCADE
) STRICT;

CREATE INDEX push_routes_account_device
  ON push_routes(account_id, device_id, disabled_at);
CREATE INDEX push_routes_inactive ON push_routes(last_seen_at, disabled_at);

CREATE TABLE relay_events (
  event_id TEXT PRIMARY KEY,
  route_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type = 'mail.hint'),
  accepted_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  delivery_state TEXT NOT NULL CHECK (
    delivery_state IN ('queued', 'delivered', 'failed')
  ),
  provider_status INTEGER,
  FOREIGN KEY (route_id) REFERENCES push_routes(route_id) ON DELETE CASCADE
) STRICT;

CREATE INDEX relay_events_expiry ON relay_events(expires_at);

CREATE TABLE audit_events (
  audit_id TEXT PRIMARY KEY,
  account_id TEXT,
  action TEXT NOT NULL,
  actor_device_id TEXT,
  coarse_hour INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
) STRICT;

CREATE INDEX audit_events_expiry ON audit_events(expires_at);

CREATE TABLE deletion_receipts (
  operation_id TEXT PRIMARY KEY,
  account_id_hash TEXT NOT NULL,
  state TEXT NOT NULL,
  coarse_hour INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
) STRICT;

CREATE INDEX deletion_receipts_expiry ON deletion_receipts(expires_at);
