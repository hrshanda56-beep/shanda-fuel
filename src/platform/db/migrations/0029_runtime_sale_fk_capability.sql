-- The runtime role inserts immutable REV1 sale-recognition rows. PostgreSQL
-- requires REFERENCES on each foreign-key parent during that insert; this
-- grant does not permit reads, writes, DDL, or RLS bypass on the parent tables.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT REFERENCES ON
      app.inventory_movements,
      app.legal_entities,
      app.memberships,
      app.meter_segments,
      app.nozzles,
      app.products,
      app.reconciliation_meter_readings,
      app.reconciliation_revisions,
      app.reconciliations,
      app.shifts,
      app.stations,
      app.tanks,
      app.tenants
    TO app_runtime;
  END IF;
END
$$;
