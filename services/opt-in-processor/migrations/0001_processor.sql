CREATE TABLE account_consents (
  account_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  consent_version TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('gmail')),
  purpose TEXT NOT NULL CHECK (purpose = 'priority-classification'),
  allowed_fields_json TEXT NOT NULL,
  processing_region TEXT NOT NULL,
  retention_hours INTEGER NOT NULL CHECK (retention_hours BETWEEN 0 AND 24),
  allow_ai INTEGER NOT NULL CHECK (allow_ai IN (0, 1)),
  token_ciphertext TEXT,
  token_nonce TEXT,
  token_key_version INTEGER,
  consented_at INTEGER NOT NULL,
  revoked_at INTEGER,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE INDEX account_consents_active
  ON account_consents(enabled, consent_version, updated_at);

CREATE TABLE retained_inputs (
  input_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  nonce TEXT NOT NULL,
  key_version INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (account_id) REFERENCES account_consents(account_id) ON DELETE CASCADE
) STRICT;

CREATE INDEX retained_inputs_expiry ON retained_inputs(expires_at);
CREATE INDEX retained_inputs_account ON retained_inputs(account_id, expires_at);

CREATE TABLE provider_revocations (
  operation_id TEXT PRIMARY KEY,
  account_id_hash TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('gmail')),
  token_ciphertext TEXT NOT NULL,
  token_nonce TEXT NOT NULL,
  token_key_version INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('queued', 'complete', 'expired')),
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  completed_at INTEGER
) STRICT;

CREATE INDEX provider_revocations_pending
  ON provider_revocations(state, expires_at);

CREATE TABLE processor_audit (
  audit_id TEXT PRIMARY KEY,
  account_id_hash TEXT NOT NULL,
  action TEXT NOT NULL,
  coarse_hour INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
) STRICT;

CREATE INDEX processor_audit_expiry ON processor_audit(expires_at);

CREATE TABLE deletion_receipts (
  operation_id TEXT PRIMARY KEY,
  account_id_hash TEXT NOT NULL,
  state TEXT NOT NULL,
  coarse_hour INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
) STRICT;

CREATE INDEX processor_deletion_receipts_expiry
  ON deletion_receipts(expires_at);
