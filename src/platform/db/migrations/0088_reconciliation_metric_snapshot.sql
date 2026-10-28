-- Keep the submitted reconciliation's computed metrics separate from the
-- payment-declaration JSON array so approval can detect stale source facts.
ALTER TABLE app.reconciliation_revisions
  ADD COLUMN metric_snapshot text;
