-- Supervisor role: separate finance reports from operational reports, let a supervisor approve
-- shift closes and expenses up to an owner-set limit, and read the station's staff and activity.
INSERT INTO platform.permission_definitions (code, description)
VALUES
  ('report.finance.view', 'View profit, financial position and finance reports'),
  ('expense.approve.any_amount', 'Approve an expense of any amount (otherwise the supervisor limit applies)'),
  ('membership.view.station', 'View the staff of a station (read only, no contact or access details)'),
  ('audit.view.station', 'View the activity log of a station (read only)')
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
INSERT INTO platform.role_permissions (role_code, permission_code)
VALUES
  ('OWNER', 'report.finance.view'), ('ADMINISTRATOR', 'report.finance.view'), ('FINANCE', 'report.finance.view'),
  ('OWNER', 'expense.approve.any_amount'), ('ADMINISTRATOR', 'expense.approve.any_amount'), ('FINANCE', 'expense.approve.any_amount'),
  ('OWNER', 'membership.view.station'), ('OWNER', 'audit.view.station'),
  ('SUPERVISOR', 'reconciliation.approve'), ('SUPERVISOR', 'expense.approve'),
  ('SUPERVISOR', 'membership.view.station'), ('SUPERVISOR', 'audit.view.station')
ON CONFLICT (role_code, permission_code) DO NOTHING;
--> statement-breakpoint
ALTER TABLE app.expense_policies ADD COLUMN supervisor_approval_limit numeric(20,4);
--> statement-breakpoint
ALTER TABLE app.expense_policies ADD CONSTRAINT expense_policies_supervisor_limit_ck
  CHECK (supervisor_approval_limit IS NULL OR supervisor_approval_limit >= 0);
--> statement-breakpoint
-- A supervisor cannot read other people's membership rows (RLS), so the station staff list is a
-- narrow definer function. It checks the caller itself, returns only a display name and a role
-- (no email, staff number or access details), and only for people assigned to that station.
CREATE FUNCTION app.station_staff_directory(p_tenant_id uuid, p_station_id uuid)
RETURNS TABLE (display_name text, role_code text)
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
    JOIN platform.role_permissions rp
      ON rp.role_code = mine.role_code AND rp.permission_code = 'membership.view.station'
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
  SELECT u.name, a.role_code
  FROM app.membership_role_assignments a
  JOIN app.memberships m ON m.tenant_id = a.tenant_id AND m.id = a.membership_id
  JOIN app.users u ON u.id = m.identity_id
  WHERE a.tenant_id = p_tenant_id
    AND a.scope_type = 'STATION'
    AND a.station_id = p_station_id
    AND m.status = 'ACTIVE'
    AND (a.expires_at IS NULL OR a.expires_at > now())
  ORDER BY u.name, a.role_code;
END;
$$;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION app.station_staff_directory(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_owner') THEN
    ALTER FUNCTION app.station_staff_directory(uuid, uuid) OWNER TO migration_owner;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT EXECUTE ON FUNCTION app.station_staff_directory(uuid, uuid) TO app_runtime;
  END IF;
END
$$;
