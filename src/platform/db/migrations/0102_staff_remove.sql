-- Removing a deactivated staff member from the Staff list. A person with no records is erased; a
-- person who appears in shifts, cash, approvals or other records cannot be erased without breaking
-- those records, so they are hidden from the list instead and their history stays intact.
-- The application role has no DELETE right on memberships (a deliberate hardening), so this is a
-- narrow function: only a tenant-wide owner or administrator of the organisation may call it, only
-- for a deactivated member other than themself, and only in their own organisation.
ALTER TABLE app.memberships ADD COLUMN removed_at timestamptz;
--> statement-breakpoint
CREATE FUNCTION app.remove_staff_membership(p_tenant_id uuid, p_membership_id uuid)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, platform
AS $$
BEGIN
  IF p_tenant_id IS NULL OR p_membership_id IS NULL
     OR p_tenant_id IS DISTINCT FROM app.current_tenant_id()
     OR NOT app.has_active_membership()
     OR p_membership_id IS NOT DISTINCT FROM app.current_membership_id() THEN
    RETURN NULL;
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
    RETURN NULL;
  END IF;

  -- Only someone already deactivated can be removed. Active staff are deactivated first.
  IF NOT EXISTS (
    SELECT 1 FROM app.memberships
    WHERE tenant_id = p_tenant_id AND id = p_membership_id
      AND status <> 'ACTIVE' AND removed_at IS NULL
  ) THEN
    RETURN NULL;
  END IF;

  BEGIN
    DELETE FROM app.membership_role_assignments
    WHERE tenant_id = p_tenant_id AND membership_id = p_membership_id;
    DELETE FROM app.memberships
    WHERE tenant_id = p_tenant_id AND id = p_membership_id;
    RETURN 'DELETED';
  EXCEPTION WHEN OTHERS THEN
    -- Any record that points at this person (or a guard protecting such records) refuses the
    -- erase. The subtransaction is rolled back, so nothing was deleted; hide them instead.
    UPDATE app.memberships
    SET removed_at = clock_timestamp(), updated_at = clock_timestamp()
    WHERE tenant_id = p_tenant_id AND id = p_membership_id;
    RETURN 'HIDDEN';
  END;
END;
$$;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION app.remove_staff_membership(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_owner') THEN
    ALTER FUNCTION app.remove_staff_membership(uuid, uuid) OWNER TO migration_owner;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT EXECUTE ON FUNCTION app.remove_staff_membership(uuid, uuid) TO app_runtime;
  END IF;
END
$$;
