CREATE TABLE IF NOT EXISTS alerts (
  id text PRIMARY KEY,
  idempotency_hash bytea NOT NULL UNIQUE,
  body_hash bytea NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  importance text NOT NULL DEFAULT 'critical' CHECK (importance IN ('normal','critical')),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  capability_hash bytea,
  outcome text NOT NULL DEFAULT 'delivery_unknown' CHECK (outcome IN ('delivery_unknown','provider_accepted','provider_failed')),
  provider_accepted_at timestamptz,
  completed_at timestamptz,
  failure_code text
);
CREATE INDEX IF NOT EXISTS alerts_page_idx ON alerts (created_at DESC, id DESC);
CREATE TABLE IF NOT EXISTS ack_actions (
  alert_id text NOT NULL REFERENCES alerts(id),
  client_action_id uuid NOT NULL,
  client_acked_at timestamptz,
  received_at timestamptz NOT NULL,
  PRIMARY KEY (alert_id, client_action_id)
);
CREATE INDEX IF NOT EXISTS ack_actions_received_idx ON ack_actions (alert_id, received_at);
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS first_ack_at timestamptz;
ALTER TABLE alerts ADD COLUMN IF NOT EXISTS importance text NOT NULL DEFAULT 'critical';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'alerts_importance_check' AND conrelid = 'alerts'::regclass) THEN
    ALTER TABLE alerts ADD CONSTRAINT alerts_importance_check CHECK (importance IN ('normal','critical'));
  END IF;
END $$;
UPDATE alerts a SET first_ack_at = (SELECT MIN(x.received_at) FROM ack_actions x WHERE x.alert_id=a.id)
WHERE a.first_ack_at IS NULL AND EXISTS (SELECT 1 FROM ack_actions x WHERE x.alert_id=a.id);
