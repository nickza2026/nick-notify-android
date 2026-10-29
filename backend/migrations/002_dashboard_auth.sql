CREATE TABLE IF NOT EXISTS dashboard_owner (
  id smallint PRIMARY KEY CHECK (id = 1),
  username text NOT NULL,
  password_hash text NOT NULL,
  bootstrap_hash text NOT NULL,
  must_change_password boolean NOT NULL DEFAULT true,
  login_failures integer NOT NULL DEFAULT 0,
  login_window timestamptz,
  change_failures integer NOT NULL DEFAULT 0,
  change_window timestamptz
);
CREATE TABLE IF NOT EXISTS dashboard_sessions (
  token_hash bytea PRIMARY KEY CHECK (octet_length(token_hash) = 32),
  owner_id smallint NOT NULL REFERENCES dashboard_owner(id),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS dashboard_sessions_expiry_idx ON dashboard_sessions(expires_at);
