-- Naming the responsible attendant for a shift, a meter reading or a meter exception checks that
-- the person is an active attendant at the station. That check read app.memberships directly, which
-- row-level security hides from everyone except tenant-wide owners and administrators, so a station
-- supervisor was always told "not eligible". This is a narrow yes/no answer instead: the caller must
-- hold a role covering the station, and only true or false comes back (no names, emails or access
-- details). Same shape and checks as app.station_attendants (0090).
CREATE FUNCTION app.is_station_attendant(p_tenant_id uuid, p_station_id uuid, p_membership_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, platform
AS $$
BEGIN
  IF p_tenant_id IS NULL OR p_station_id IS NULL OR p_membership_id IS NULL
     OR p_tenant_id IS DISTINCT FROM app.current_tenant_id()
     OR NOT app.has_active_membership() THEN
    RETURN false;
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
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM app.memberships m
    JOIN app.membership_role_assignments a
      ON a.tenant_id = m.tenant_id AND a.membership_id = m.id
    WHERE m.tenant_id = p_tenant_id
      AND m.id = p_membership_id
      AND m.status = 'ACTIVE'
      AND a.scope_type = 'STATION'
      AND a.station_id = p_station_id
      AND a.role_code = 'ATTENDANT'
      AND (a.expires_at IS NULL OR a.expires_at > now())
  );
END;
$$;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION app.is_station_attendant(uuid, uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_owner') THEN
    ALTER FUNCTION app.is_station_attendant(uuid, uuid, uuid) OWNER TO migration_owner;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT EXECUTE ON FUNCTION app.is_station_attendant(uuid, uuid, uuid) TO app_runtime;
  END IF;
END
$$;
