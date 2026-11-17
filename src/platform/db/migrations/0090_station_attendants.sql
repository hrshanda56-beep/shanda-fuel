-- A supervisor cannot read other people's membership rows (RLS), so the "who is on shift" list on
-- the daily figures screen came back empty. This is a narrow definer function in the same shape as
-- app.station_staff_directory: it checks the caller itself, returns only a membership id and a
-- display name (no email or access details), and only for people assigned ATTENDANT at that station.
CREATE FUNCTION app.station_attendants(p_tenant_id uuid, p_station_id uuid, p_at timestamptz)
RETURNS TABLE (id uuid, name text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, platform
AS $$
BEGIN
  IF p_tenant_id IS NULL OR p_station_id IS NULL
     OR p_tenant_id IS DISTINCT FROM app.current_tenant_id()
     OR NOT app.has_active_membership() THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM app.membership_role_assignments mine
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
  SELECT DISTINCT m.id, u.name
  FROM app.membership_role_assignments a
  JOIN app.memberships m ON m.tenant_id = a.tenant_id AND m.id = a.membership_id
  JOIN app.users u ON u.id = m.identity_id
  WHERE a.tenant_id = p_tenant_id
    AND a.scope_type = 'STATION'
    AND a.station_id = p_station_id
    AND a.role_code = 'ATTENDANT'
    AND m.status = 'ACTIVE'
    AND (a.expires_at IS NULL OR a.expires_at > COALESCE(p_at, now()))
  ORDER BY u.name, m.id;
END;
$$;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION app.station_attendants(uuid, uuid, timestamptz) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_owner') THEN
    ALTER FUNCTION app.station_attendants(uuid, uuid, timestamptz) OWNER TO migration_owner;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT EXECUTE ON FUNCTION app.station_attendants(uuid, uuid, timestamptz) TO app_runtime;
  END IF;
END
$$;
