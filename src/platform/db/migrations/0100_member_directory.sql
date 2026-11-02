-- Row-level security lets a person read only their own membership unless they hold a tenant-wide
-- owner or administrator role. Anything that joins app.memberships (and so app.users, which is
-- visible only through a membership) therefore saw nothing for station-level staff: names on cash
-- handovers, reports, documents and costing showed as "Unknown" or blank, a supervisor could not
-- pick an owner or administrator as an approver, and a station-level owner looked like the only
-- owner. This is a narrow directory instead: for the caller's own organisation it returns each
-- member's id, display name (no email or sign-in details), status and whether they can currently
-- sign in. The caller must be an active member of that organisation. Role assignments are already
-- readable by every member, so callers combine the two.
CREATE FUNCTION app.member_directory(p_tenant_id uuid)
RETURNS TABLE (id uuid, name text, status text, usable boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, platform
AS $$
BEGIN
  IF p_tenant_id IS NULL
     OR p_tenant_id IS DISTINCT FROM app.current_tenant_id()
     OR NOT app.has_active_membership() THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT m.id,
         nullif(u.name, '')::text,
         m.status::text,
         (m.status = 'ACTIVE'
           AND m.disabled_at IS NULL
           AND m.suspended_at IS NULL
           AND m.locked_at IS NULL)
  FROM app.memberships m
  LEFT JOIN app.users u ON u.id = m.identity_id
  WHERE m.tenant_id = p_tenant_id;
END;
$$;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION app.member_directory(uuid) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_owner') THEN
    ALTER FUNCTION app.member_directory(uuid) OWNER TO migration_owner;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT EXECUTE ON FUNCTION app.member_directory(uuid) TO app_runtime;
  END IF;
END
$$;
