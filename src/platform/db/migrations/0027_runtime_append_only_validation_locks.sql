-- Append-only source validation must remain readable by app_runtime without
-- granting UPDATE merely to satisfy PostgreSQL row-lock privilege checks.
-- The command layer locks the mutable stream owner (the tank/revaluation
-- envelope) before validation; these immutable source reads do not need a
-- second row lock and are safe under the append-only triggers.

-- This is a narrowly scoped capability lookup used when one station operator
-- records a boundary on behalf of another. It remains fail-closed: the
-- caller's tenant and active membership context must match, and the lookup is
-- constrained to the supplied tenant/station/membership tuple.
CREATE OR REPLACE FUNCTION app.is_station_operator(
  p_tenant_id uuid,
  p_station_id uuid,
  p_membership_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app
AS $$
  SELECT app.current_tenant_id() IS NOT DISTINCT FROM p_tenant_id
     AND app.has_active_membership()
     AND EXISTS (
       SELECT 1
       FROM app.memberships AS membership
       JOIN app.membership_role_assignments AS assignment
         ON assignment.tenant_id = membership.tenant_id
        AND assignment.membership_id = membership.id
       WHERE membership.tenant_id = p_tenant_id
         AND membership.id = p_membership_id
         AND membership.status = 'ACTIVE'
         AND assignment.scope_type = 'STATION'
         AND assignment.station_id = p_station_id
         AND assignment.role_code IN ('ATTENDANT', 'SUPERVISOR')
         AND (assignment.expires_at IS NULL OR assignment.expires_at > now())
     );
$$;

REVOKE ALL ON FUNCTION app.is_station_operator(uuid, uuid, uuid) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_owner') THEN
    ALTER FUNCTION app.is_station_operator(uuid, uuid, uuid) OWNER TO migration_owner;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT EXECUTE ON FUNCTION app.is_station_operator(uuid, uuid, uuid) TO app_runtime;
  END IF;
END
$$;

DO $$
DECLARE
  function_definition text;
BEGIN
  FOR function_definition IN
    SELECT pg_get_functiondef(p.oid)
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'app'
       AND p.proname IN (
         'a12_validate_reconciliation_meter_reading_segment',
         'a12_validate_meter_segment_sale_source',
         'a12_validate_sale_cost_attribution',
         'a12_validate_revaluation_line'
       )
  LOOP
    function_definition := regexp_replace(
      function_definition,
      E'\\n[[:space:]]+FOR SHARE;',
      ';',
      'g'
    );
    EXECUTE function_definition;
  END LOOP;
END
$$;
