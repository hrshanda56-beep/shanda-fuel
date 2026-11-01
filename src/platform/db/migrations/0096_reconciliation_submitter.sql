-- Finance and the owner need to see who submitted a day for review. A person cannot read other
-- people's membership rows (RLS), so the name cannot be looked up from the application. This is a
-- narrow definer function in the same shape as app.station_attendants (0090): it checks the caller
-- itself, holds to one reconciliation, and returns only the submitter's display name and the time
-- (no email, staff number or access details). The caller must hold reconciliation.view over the
-- station, the same permission the screen's own API enforces.
CREATE FUNCTION app.reconciliation_submitter(
  p_tenant_id uuid,
  p_station_id uuid,
  p_reconciliation_id uuid
)
RETURNS TABLE (name text, submitted_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, platform
AS $$
BEGIN
  IF p_tenant_id IS NULL OR p_station_id IS NULL OR p_reconciliation_id IS NULL
     OR p_tenant_id IS DISTINCT FROM app.current_tenant_id()
     OR NOT app.has_active_membership() THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM app.membership_role_assignments mine
    JOIN platform.role_permissions rp
      ON rp.role_code = mine.role_code AND rp.permission_code = 'reconciliation.view'
    JOIN app.stations st
      ON st.tenant_id = p_tenant_id AND st.id = p_station_id
    WHERE mine.tenant_id = p_tenant_id
      AND mine.membership_id = app.current_membership_id()
      AND (mine.expires_at IS NULL OR mine.expires_at > now())
      AND (
        mine.scope_type = 'TENANT'
        OR (mine.scope_type = 'LEGAL_ENTITY' AND mine.legal_entity_id = st.legal_entity_id)
        OR (mine.scope_type = 'STATION' AND mine.station_id = st.id)
      )
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT NULLIF(btrim(u.name), ''), r.submitted_at
  FROM app.reconciliations r
  JOIN app.memberships m ON m.tenant_id = r.tenant_id AND m.id = r.submitted_by
  JOIN app.users u ON u.id = m.identity_id
  WHERE r.tenant_id = p_tenant_id
    AND r.station_id = p_station_id
    AND r.id = p_reconciliation_id;
END;
$$;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION app.reconciliation_submitter(uuid, uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_owner') THEN
    ALTER FUNCTION app.reconciliation_submitter(uuid, uuid, uuid) OWNER TO migration_owner;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT EXECUTE ON FUNCTION app.reconciliation_submitter(uuid, uuid, uuid) TO app_runtime;
  END IF;
END
$$;
