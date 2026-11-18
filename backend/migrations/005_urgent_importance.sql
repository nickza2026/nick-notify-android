-- Widen the original named constraint without rewriting existing records or hashes.
ALTER TABLE alerts DROP CONSTRAINT IF EXISTS alerts_importance_check;
ALTER TABLE alerts ADD CONSTRAINT alerts_importance_check
  CHECK (importance IN ('normal', 'urgent', 'critical'));
