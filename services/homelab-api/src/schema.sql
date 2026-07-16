-- Homelab v1: device push tokens, consent, optional retained AI inputs.
-- Mail sync stays on-device; this DB holds only hosted-plane state.

CREATE TABLE IF NOT EXISTS devices (
  device_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('apns', 'fcm', 'webpush')),
  push_token TEXT NOT NULL,
  sandbox BOOLEAN NOT NULL DEFAULT TRUE,
  display_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_push_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS devices_account_token_uq
  ON devices (account_id, platform, push_token)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS devices_account_active_idx
  ON devices (account_id)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS account_consents (
  account_id TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  allow_ai BOOLEAN NOT NULL DEFAULT FALSE,
  retention_hours INTEGER NOT NULL DEFAULT 0 CHECK (retention_hours >= 0),
  disclosure_version TEXT NOT NULL,
  consented_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS retained_inputs (
  input_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES account_consents (account_id) ON DELETE CASCADE,
  purpose TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS retained_inputs_expires_idx
  ON retained_inputs (expires_at);
