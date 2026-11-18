-- Owner-controlled per-device mute. Existing devices keep their current audible behavior.
ALTER TABLE client_devices ADD COLUMN IF NOT EXISTS silent boolean NOT NULL DEFAULT false;
