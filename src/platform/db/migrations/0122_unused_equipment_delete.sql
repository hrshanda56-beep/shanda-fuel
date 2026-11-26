-- Removing station equipment that was set up by mistake and never used (#315).
--
-- Migration 0020 took DELETE away from app_runtime on every app table that had no authoritative
-- delete command. The setup screens now have those commands: delete a fuel (Setup.DeleteProduct,
-- which until now could not run as app_runtime), a tank, a pump or a nozzle, each only while
-- nothing has been recorded against it. This grants DELETE on exactly the tables those commands
-- remove rows from, and nothing else.
--
-- History stays protected by the database, not only by the application:
--   * every table that records use of a tank, pump, nozzle, meter or meter installation (dips,
--     deliveries, stock movements, costs, readings, segments, meter problems, reconciliations,
--     sales, opening balances) refers to it through a NO ACTION foreign key, so a delete of a used
--     row fails;
--   * tanks keep the tanks_history_delete_guard trigger from 0004;
--   * the tenant_context RLS policies (FOR ALL, FORCE RLS) still limit every delete to the
--     current tenant.
-- Calibration points are a tank's own setup, not history, and go with the tank.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT DELETE ON
      app.products,
      app.tanks,
      app.tank_calibration_points,
      app.pumps,
      app.nozzles,
      app.meters,
      app.meter_installations
    TO app_runtime;
  END IF;
END
$$;
