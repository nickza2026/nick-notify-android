-- The configured application key is represented by a public identifier, never its secret.
CREATE TABLE IF NOT EXISTS client_keys (
  key_id text PRIMARY KEY CHECK (key_id = 'primary'),
  owner_id smallint NOT NULL REFERENCES dashboard_owner(id),
  name text NOT NULL,
  managed boolean NOT NULL DEFAULT false
);
INSERT INTO client_keys(key_id,owner_id,name)
SELECT 'primary',1,'การแจ้งเตือนหลัก' FROM dashboard_owner ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS client_devices (
  id uuid PRIMARY KEY,
  owner_id smallint NOT NULL REFERENCES dashboard_owner(id),
  installation_id uuid NOT NULL UNIQUE,
  device_name text NOT NULL,
  legacy_import boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS client_subscriptions (
  device_id uuid NOT NULL REFERENCES client_devices(id),
  key_id text NOT NULL REFERENCES client_keys(key_id),
  token_hash bytea NOT NULL CHECK (octet_length(token_hash)=32),
  token_cipher bytea NOT NULL,
  PRIMARY KEY(device_id,key_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS client_subscriptions_token_unique ON client_subscriptions(token_hash);
CREATE TABLE IF NOT EXISTS client_sessions (
  token_hash bytea PRIMARY KEY CHECK (octet_length(token_hash)=32),
  owner_id smallint NOT NULL REFERENCES dashboard_owner(id),
  installation_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS client_sessions_installation_idx ON client_sessions(installation_id);
CREATE TABLE IF NOT EXISTS device_deliveries (
  alert_id text NOT NULL REFERENCES alerts(id),
  device_id uuid NOT NULL REFERENCES client_devices(id),
  device_name text NOT NULL,
  token_hash bytea NOT NULL,
  capability_hash bytea NOT NULL UNIQUE CHECK (octet_length(capability_hash)=32),
  outcome text NOT NULL DEFAULT 'delivery_unknown' CHECK (outcome IN ('delivery_unknown','provider_accepted','provider_failed')),
  failure_code text,
  provider_accepted_at timestamptz,
  completed_at timestamptz,
  first_ack_at timestamptz,
  PRIMARY KEY(alert_id,device_id)
);
CREATE TABLE IF NOT EXISTS device_ack_actions (
  alert_id text NOT NULL,
  device_id uuid NOT NULL,
  client_action_id uuid NOT NULL,
  client_acked_at timestamptz,
  received_at timestamptz NOT NULL,
  PRIMARY KEY(alert_id,device_id,client_action_id),
  FOREIGN KEY(alert_id,device_id) REFERENCES device_deliveries(alert_id,device_id)
);
CREATE INDEX IF NOT EXISTS device_ack_alert_idx ON device_ack_actions(alert_id,received_at);
CREATE OR REPLACE VIEW all_ack_actions AS
SELECT x.alert_id,NULL::uuid AS device_id,NULL::text AS device_name,x.client_action_id,x.client_acked_at,x.received_at FROM ack_actions x
UNION ALL
SELECT x.alert_id,x.device_id,d.device_name,x.client_action_id,x.client_acked_at,x.received_at FROM device_ack_actions x JOIN device_deliveries d ON (d.alert_id=x.alert_id AND d.device_id=x.device_id);
