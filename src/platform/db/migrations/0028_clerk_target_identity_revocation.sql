-- Tenant-scoped Clerk target-identity resolution for staff deactivation.
--
-- This capability is intentionally narrower than a table grant. The
-- app_runtime role can execute the function, but it cannot select from
-- app.auth_identities directly. The policy exposes at most the one target
-- row selected after the function has checked the caller's tenant role.

CREATE POLICY auth_identities_target_provider_lookup ON app.auth_identities
  FOR SELECT
  USING (
    session_user = 'app_runtime'
    AND current_user = 'migration_owner'
    AND provider = current_setting('app.provider_identity_lookup_provider', true)
    AND internal_user_id = nullif(
      current_setting('app.provider_identity_lookup_target', true),
      ''
    )::uuid
  );

CREATE OR REPLACE FUNCTION app.resolve_provider_identity_for_membership(
  p_provider text,
  p_tenant_id uuid,
  p_membership_id uuid
)
RETURNS TABLE (provider_user_id text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, auth, platform
AS $$
DECLARE
  target_identity_id uuid;
BEGIN
  IF p_provider <> 'CLERK' OR p_tenant_id IS NULL OR p_membership_id IS NULL THEN
    RETURN;
  END IF;

  IF p_tenant_id IS DISTINCT FROM app.current_tenant_id()
     OR NOT app.has_active_membership()
     OR p_membership_id = app.current_membership_id() THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM app.memberships membership
    JOIN app.membership_role_assignments assignment
      ON assignment.tenant_id = membership.tenant_id
     AND assignment.membership_id = membership.id
    WHERE membership.tenant_id = p_tenant_id
      AND membership.id = app.current_membership_id()
      AND membership.status = 'ACTIVE'
      AND assignment.scope_type = 'TENANT'
      AND assignment.role_code IN ('OWNER', 'ADMINISTRATOR')
      AND (assignment.expires_at IS NULL OR assignment.expires_at > clock_timestamp())
  ) THEN
    RETURN;
  END IF;

  SELECT membership.identity_id
  INTO target_identity_id
  FROM app.memberships membership
  WHERE membership.tenant_id = p_tenant_id
    AND membership.id = p_membership_id
    AND membership.status IN ('ACTIVE', 'DISABLED');

  IF target_identity_id IS NULL THEN
    RETURN;
  END IF;

  PERFORM set_config('app.provider_identity_lookup_provider', p_provider, true);
  PERFORM set_config('app.provider_identity_lookup_target', target_identity_id::text, true);

  RETURN QUERY
  SELECT identity.provider_user_id
  FROM app.auth_identities identity
  WHERE identity.provider = p_provider
    AND identity.internal_user_id = target_identity_id
  LIMIT 1;

  -- Do not leave the capability selector available to another operation in
  -- the caller's transaction.
  PERFORM set_config('app.provider_identity_lookup_provider', '', true);
  PERFORM set_config('app.provider_identity_lookup_target', '', true);
END;
$$;

REVOKE ALL PRIVILEGES ON FUNCTION app.resolve_provider_identity_for_membership(text, uuid, uuid)
  FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_owner') THEN
    ALTER FUNCTION app.resolve_provider_identity_for_membership(text, uuid, uuid)
      OWNER TO migration_owner;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT EXECUTE ON FUNCTION app.resolve_provider_identity_for_membership(text, uuid, uuid)
      TO app_runtime;
  END IF;
END
$$;
