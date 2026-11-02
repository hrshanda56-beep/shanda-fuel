-- Changing a staff member's access replaces their role assignments: the command deletes the old
-- rows and inserts the new ones in one transaction (with a security event). The application role
-- could insert and update assignments but not delete them, so every change was refused with
-- "permission denied". Granting DELETE adds no power the role did not already have (it can already
-- rewrite or expire any assignment); row-level security still confines it to the caller's own
-- organisation, and the command still requires an owner or administrator with a fresh step-up.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT DELETE ON app.membership_role_assignments TO app_runtime;
  END IF;
END
$$;
