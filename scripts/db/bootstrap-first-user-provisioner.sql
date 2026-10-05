-- Disposable-test prerequisite for migration 0021.
-- Keep this definition aligned with the reviewed first-user provisioning
-- fixture. Migration 0021 remains responsible for its own fail-closed role
-- validation and reviewed CONNECT/schema/function grants.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'first_user_provisioner') THEN
    EXECUTE 'CREATE ROLE first_user_provisioner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS';
  END IF;
END
$$;

ALTER ROLE first_user_provisioner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOINHERIT NOREPLICATION NOBYPASSRLS;
ALTER ROLE first_user_provisioner RESET ALL;

DO $$
DECLARE
  granted_role name;
BEGIN
  FOR granted_role IN
    SELECT parent.rolname
    FROM pg_auth_members membership
    JOIN pg_roles parent ON parent.oid = membership.roleid
    JOIN pg_roles member ON member.oid = membership.member
    WHERE member.rolname = 'first_user_provisioner'
  LOOP
    EXECUTE format('REVOKE %I FROM first_user_provisioner', granted_role);
  END LOOP;
END
$$;
