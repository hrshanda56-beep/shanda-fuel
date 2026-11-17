-- Approving a reconciliation posts sale movements, cost attributions and revenue. Several of the
-- validation triggers on those inserts take a row lock (SELECT ... FOR SHARE) on rows they only
-- read: meter segments, inventory movements and cost events. Postgres treats any row lock as an
-- UPDATE, and the application role deliberately has no UPDATE on those tables (0003 revoked it
-- from meter_segments, and the others are append-only). As invoker, each trigger therefore failed
-- with "permission denied" and no reconciliation with pump readings could be approved. The tests
-- did not see it because they connect as a privileged role.
--
-- Two more validators have the same fault and are fixed the same way: the provider settlement
-- allocation guard (it locks payment evidence and the settlement) and the cost revaluation line
-- validator (it locks the revaluation, the sale movement and the cost event).
--
-- The application role is not given any new right on any table. Instead these validators run as
-- their owner (migration_owner, the table owner) with a fixed search path, in the same shape as
-- app.upsert_inventory_cost_stream_state (0012). They still read only rows of the tenant and
-- station on the row being written, and Force RLS still applies to the owner, so the tenant
-- boundary is unchanged. The bodies are not touched.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_owner') THEN
    RAISE EXCEPTION 'migration_owner role is required for the approval trigger locks';
  END IF;
END
$$;
--> statement-breakpoint
ALTER FUNCTION app.a12_validate_meter_segment_sale_source() OWNER TO migration_owner;
--> statement-breakpoint
ALTER FUNCTION app.a12_validate_meter_segment_sale_source()
  SECURITY DEFINER SET search_path = pg_catalog, app;
--> statement-breakpoint
ALTER FUNCTION app.a12_validate_reconciliation_meter_reading_segment() OWNER TO migration_owner;
--> statement-breakpoint
ALTER FUNCTION app.a12_validate_reconciliation_meter_reading_segment()
  SECURITY DEFINER SET search_path = pg_catalog, app;
--> statement-breakpoint
ALTER FUNCTION app.a12_validate_sale_cost_attribution() OWNER TO migration_owner;
--> statement-breakpoint
ALTER FUNCTION app.a12_validate_sale_cost_attribution()
  SECURITY DEFINER SET search_path = pg_catalog, app;
--> statement-breakpoint
ALTER FUNCTION app.rev1_validate_sale_recognition_movement() OWNER TO migration_owner;
--> statement-breakpoint
ALTER FUNCTION app.rev1_validate_sale_recognition_movement()
  SECURITY DEFINER SET search_path = pg_catalog, app;
--> statement-breakpoint
ALTER FUNCTION app.a9_provider_allocation_guard() OWNER TO migration_owner;
--> statement-breakpoint
ALTER FUNCTION app.a9_provider_allocation_guard()
  SECURITY DEFINER SET search_path = pg_catalog, app;
--> statement-breakpoint
ALTER FUNCTION app.a12_validate_revaluation_line() OWNER TO migration_owner;
--> statement-breakpoint
ALTER FUNCTION app.a12_validate_revaluation_line()
  SECURITY DEFINER SET search_path = pg_catalog, app;
