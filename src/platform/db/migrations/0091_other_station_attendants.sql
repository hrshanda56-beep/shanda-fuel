-- An attendant sometimes works a shift at a station other than their usual one. This is the read
-- side of that: the attendants assigned to the organisation's OTHER stations, so a supervisor can
-- add one to a shift. Same shape and checks as app.station_attendants (0090): the caller must hold
-- a role covering the station, and only a membership id, display name and usual station name come
-- back (no email or access details).
CREATE FUNCTION app.other_station_attendants(p_tenant_id uuid, p_station_id uuid, p_at timestamptz)
RETURNS TABLE (id uuid, name text, station_name text)
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
  SELECT DISTINCT ON (m.id) m.id, u.name, s.name
  FROM app.membership_role_assignments a
  JOIN app.memberships m ON m.tenant_id = a.tenant_id AND m.id = a.membership_id
  JOIN app.users u ON u.id = m.identity_id
  JOIN app.stations s ON s.tenant_id = a.tenant_id AND s.id = a.station_id
  WHERE a.tenant_id = p_tenant_id
    AND a.scope_type = 'STATION'
    AND a.station_id <> p_station_id
    AND a.role_code = 'ATTENDANT'
    AND m.status = 'ACTIVE'
    AND (a.expires_at IS NULL OR a.expires_at > COALESCE(p_at, now()))
    AND NOT EXISTS (
      SELECT 1 FROM app.membership_role_assignments here
      WHERE here.tenant_id = a.tenant_id
        AND here.membership_id = a.membership_id
        AND here.scope_type = 'STATION'
        AND here.station_id = p_station_id
        AND here.role_code = 'ATTENDANT'
        AND (here.expires_at IS NULL OR here.expires_at > COALESCE(p_at, now()))
    )
  ORDER BY m.id, u.name;
END;
$$;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION app.other_station_attendants(uuid, uuid, timestamptz) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_owner') THEN
    ALTER FUNCTION app.other_station_attendants(uuid, uuid, timestamptz) OWNER TO migration_owner;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT EXECUTE ON FUNCTION app.other_station_attendants(uuid, uuid, timestamptz) TO app_runtime;
  END IF;
END
$$;
