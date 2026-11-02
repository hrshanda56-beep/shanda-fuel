-- Changing a staff member's access replaces their role assignments: the command removes the old
-- rows and inserts the new ones in one transaction (with a security event). The application role
-- has no DELETE right on role assignments (a deliberate hardening, asserted by db.smoke), so every
-- change was refused with "permission denied". Rather than widen the role's table rights, the
-- removal is a narrow function: only a tenant-wide owner or administrator of the organisation (the
-- same people the staff-management policy on memberships admits) may call it, and it removes one
-- member's assignments in that organisation and nothing else. The command still applies its own
-- scope, privilege and step-up rules before calling it and writes the new assignments with the
-- application role's ordinary insert right.
CREATE FUNCTION app.clear_membership_assignments(p_tenant_id uuid, p_membership_id uuid)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, platform
AS $$
DECLARE
  removed integer;
BEGIN
  IF p_tenant_id IS NULL OR p_membership_id IS NULL
     OR p_tenant_id IS DISTINCT FROM app.current_tenant_id()
     OR NOT app.has_active_membership() THEN
    RETURN 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM app.membership_role_assignments mine
    WHERE mine.tenant_id = p_tenant_id
      AND mine.membership_id = app.current_membership_id()
      AND mine.scope_type = 'TENANT'
      AND mine.role_code IN ('OWNER', 'ADMINISTRATOR')
      AND (mine.expires_at IS NULL OR mine.expires_at > now())
  ) THEN
    RETURN 0;
  END IF;

  DELETE FROM app.membership_role_assignments
  WHERE tenant_id = p_tenant_id AND membership_id = p_membership_id;
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION app.clear_membership_assignments(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_owner') THEN
    ALTER FUNCTION app.clear_membership_assignments(uuid, uuid) OWNER TO migration_owner;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT EXECUTE ON FUNCTION app.clear_membership_assignments(uuid, uuid) TO app_runtime;
  END IF;
END
$$;
