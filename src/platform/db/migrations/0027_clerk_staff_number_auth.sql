-- Provider-neutral identity routing and emailless staff onboarding.
-- This migration is additive and intentionally leaves Better Auth tables,
-- memberships, business records, job_runtime, and existing invitations intact.

ALTER TABLE auth."user"
  ALTER COLUMN email DROP NOT NULL;

CREATE TABLE app.auth_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  internal_user_id uuid NOT NULL,
  provider text NOT NULL,
  provider_user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_identities_provider_ck CHECK (provider IN ('BETTER_AUTH', 'CLERK')),
  CONSTRAINT auth_identities_provider_user_id_ck CHECK (btrim(provider_user_id) <> ''),
  CONSTRAINT auth_identities_provider_user_uidx UNIQUE (provider, provider_user_id),
  CONSTRAINT auth_identities_internal_user_provider_uidx UNIQUE (internal_user_id, provider),
  CONSTRAINT auth_identities_internal_user_fk FOREIGN KEY (internal_user_id)
    REFERENCES auth."user" (id) ON DELETE RESTRICT
);

CREATE INDEX auth_identities_internal_user_idx
  ON app.auth_identities (internal_user_id);

-- Provider resolution is deliberately exposed through SECURITY DEFINER
-- capability functions rather than table grants. The app runtime receives
-- only EXECUTE on these functions after the migration owner reviews the
-- deployment role boundary.
CREATE OR REPLACE FUNCTION app.resolve_auth_identity(
  p_provider text,
  p_provider_user_id text
)
RETURNS TABLE (internal_user_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, auth, platform
AS $$
BEGIN
  IF p_provider NOT IN ('BETTER_AUTH', 'CLERK')
     OR p_provider_user_id IS NULL
     OR btrim(p_provider_user_id) = '' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT identity.internal_user_id
  FROM app.auth_identities identity
  WHERE identity.provider = p_provider
    AND identity.provider_user_id = p_provider_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION app.resolve_provider_identity(
  p_provider text,
  p_internal_user_id uuid
)
RETURNS TABLE (provider_user_id text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, auth, platform
AS $$
BEGIN
  IF p_provider NOT IN ('BETTER_AUTH', 'CLERK') OR p_internal_user_id IS NULL THEN
    RETURN;
  END IF;

  IF NOT app.has_active_membership() THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT identity.provider_user_id
  FROM app.auth_identities identity
  WHERE identity.provider = p_provider
    AND identity.internal_user_id = p_internal_user_id
    AND EXISTS (
      SELECT 1
      FROM app.memberships membership
      WHERE membership.tenant_id = app.current_tenant_id()
        AND membership.identity_id = p_internal_user_id
    );
END;
$$;

CREATE TABLE app.staff_number_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  staff_number text NOT NULL,
  normalized_staff_number text NOT NULL,
  reserved_invitation_id uuid,
  internal_user_id uuid,
  status text NOT NULL DEFAULT 'RESERVED',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_number_registry_staff_number_ck
    CHECK (staff_number ~ '^SF-[0-9]{8}$'),
  CONSTRAINT staff_number_registry_normalized_ck
    CHECK (normalized_staff_number = upper(btrim(staff_number))),
  CONSTRAINT staff_number_registry_status_ck
    CHECK (status IN ('RESERVED', 'ASSIGNED')),
  CONSTRAINT staff_number_registry_staff_number_uidx UNIQUE (normalized_staff_number),
  CONSTRAINT staff_number_registry_invitation_uidx UNIQUE (reserved_invitation_id),
  CONSTRAINT staff_number_registry_internal_user_uidx UNIQUE (internal_user_id),
  CONSTRAINT staff_number_registry_invitation_fk FOREIGN KEY (reserved_invitation_id)
    REFERENCES app.staff_invitations (id) ON DELETE RESTRICT,
  CONSTRAINT staff_number_registry_internal_user_fk FOREIGN KEY (internal_user_id)
    REFERENCES auth."user" (id) ON DELETE RESTRICT,
  CONSTRAINT staff_number_registry_owner_ck CHECK (
    (status = 'RESERVED' AND reserved_invitation_id IS NOT NULL AND internal_user_id IS NULL)
    OR (status = 'ASSIGNED' AND reserved_invitation_id IS NULL AND internal_user_id IS NOT NULL)
  )
);

CREATE INDEX staff_number_registry_invitation_idx
  ON app.staff_number_registry (reserved_invitation_id)
  WHERE reserved_invitation_id IS NOT NULL;

CREATE OR REPLACE FUNCTION app.reserve_staff_number(
  p_invitation_id uuid,
  p_staff_number text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, auth, platform
AS $$
DECLARE
  normalized text;
  registry_id uuid;
BEGIN
  normalized := upper(btrim(p_staff_number));
  IF p_invitation_id IS NULL OR normalized !~ '^SF-[0-9]{8}$' THEN
    RAISE EXCEPTION 'staff number reservation unavailable' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM app.staff_invitations invitation
    WHERE invitation.id = p_invitation_id
      AND invitation.tenant_id = app.current_tenant_id()
  ) THEN
    RAISE EXCEPTION 'staff number reservation unavailable' USING ERRCODE = 'P0001';
  END IF;
  IF NOT app.has_active_membership() THEN
    RAISE EXCEPTION 'staff number reservation unavailable' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO app.staff_number_registry (
    staff_number, normalized_staff_number, reserved_invitation_id, status
  ) VALUES (normalized, normalized, p_invitation_id, 'RESERVED')
  RETURNING id INTO registry_id;

  RETURN registry_id;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'staff number reservation unavailable' USING ERRCODE = 'P0001';
END;
$$;

CREATE OR REPLACE FUNCTION app.resolve_staff_number_for_invitation(
  p_invitation_id uuid
)
RETURNS TABLE (staff_number text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, auth, platform
AS $$
BEGIN
  IF p_invitation_id IS NULL THEN
    RETURN;
  END IF;
  IF NOT app.has_active_membership() THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT registry.staff_number
  FROM app.staff_number_registry registry
  JOIN app.staff_invitations invitation
    ON invitation.id = registry.reserved_invitation_id
  WHERE invitation.id = p_invitation_id
    AND invitation.tenant_id = app.current_tenant_id()
    AND registry.status = 'RESERVED';
END;
$$;

CREATE OR REPLACE FUNCTION app.resolve_staff_number_for_user(
  p_internal_user_id uuid
)
RETURNS TABLE (staff_number text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, auth, platform
AS $$
BEGIN
  IF p_internal_user_id IS NULL THEN
    RETURN;
  END IF;
  IF NOT app.has_active_membership() THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT registry.staff_number
  FROM app.staff_number_registry registry
  WHERE registry.internal_user_id = p_internal_user_id
    AND EXISTS (
      SELECT 1
      FROM app.memberships membership
      WHERE membership.tenant_id = app.current_tenant_id()
        AND membership.identity_id = p_internal_user_id
    );
END;
$$;

CREATE OR REPLACE FUNCTION app.resolve_manual_staff_invitation(
  p_token_hash text,
  p_staff_number text
)
RETURNS TABLE (
  invitation_id uuid,
  tenant_id uuid,
  invited_name text,
  assigned_role text,
  scope_type text,
  legal_entity_id uuid,
  registry_id uuid,
  staff_number text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, auth, platform
AS $$
DECLARE
  normalized text;
BEGIN
  normalized := upper(btrim(p_staff_number));
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$'
     OR normalized !~ '^SF-[0-9]{8}$' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT invitation.id,
         invitation.tenant_id,
         invitation.invited_name,
         invitation.assigned_role,
         invitation.scope_type,
         invitation.legal_entity_id,
         registry.id,
         registry.staff_number
  FROM app.staff_invitations invitation
  JOIN app.staff_number_registry registry
    ON registry.id = invitation.staff_number_registry_id
  WHERE invitation.token_hash = p_token_hash
    AND invitation.delivery_method = 'MANUAL'
    AND invitation.status = 'PENDING'
    AND invitation.expires_at > clock_timestamp()
    AND registry.normalized_staff_number = normalized
    AND registry.status = 'RESERVED'
  FOR UPDATE;
END;
$$;

CREATE TABLE app.auth_session_assurance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  provider text NOT NULL,
  provider_session_id text NOT NULL,
  internal_user_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  assurance_level integer NOT NULL DEFAULT 1,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_session_assurance_provider_ck CHECK (provider IN ('BETTER_AUTH', 'CLERK')),
  CONSTRAINT auth_session_assurance_provider_session_uidx
    UNIQUE (provider, provider_session_id),
  CONSTRAINT auth_session_assurance_level_ck CHECK (assurance_level IN (1, 2)),
  CONSTRAINT auth_session_assurance_expiry_ck CHECK (expires_at > created_at),
  CONSTRAINT auth_session_assurance_user_fk FOREIGN KEY (internal_user_id)
    REFERENCES auth."user" (id) ON DELETE CASCADE,
  CONSTRAINT auth_session_assurance_tenant_fk FOREIGN KEY (tenant_id)
    REFERENCES app.tenants (id) ON DELETE RESTRICT
);

CREATE INDEX auth_session_assurance_lookup_idx
  ON app.auth_session_assurance (provider, provider_session_id, internal_user_id, tenant_id)
  WHERE revoked_at IS NULL;

ALTER TABLE app.staff_invitations
  ADD COLUMN delivery_method text NOT NULL DEFAULT 'EMAIL',
  ADD COLUMN staff_number_registry_id uuid;

ALTER TABLE app.staff_invitations
  ALTER COLUMN invited_email DROP NOT NULL;

ALTER TABLE app.staff_invitations
  ADD CONSTRAINT staff_invitations_delivery_method_ck
    CHECK (delivery_method IN ('EMAIL', 'MANUAL')),
  ADD CONSTRAINT staff_invitations_manual_staff_number_ck
    CHECK (delivery_method = 'EMAIL' OR staff_number_registry_id IS NOT NULL),
  ADD CONSTRAINT staff_invitations_staff_number_registry_fk
    FOREIGN KEY (staff_number_registry_id)
    REFERENCES app.staff_number_registry (id) ON DELETE RESTRICT;

DROP INDEX IF EXISTS app.staff_invitations_pending_email_uidx;
CREATE UNIQUE INDEX staff_invitations_pending_email_uidx
  ON app.staff_invitations (tenant_id, invited_email)
  WHERE status = 'PENDING' AND invited_email IS NOT NULL;

CREATE INDEX staff_invitations_pending_staff_number_idx
  ON app.staff_invitations (staff_number_registry_id)
  WHERE status = 'PENDING' AND staff_number_registry_id IS NOT NULL;

ALTER TABLE app.auth_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.auth_identities FORCE ROW LEVEL SECURITY;
ALTER TABLE app.staff_number_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.staff_number_registry FORCE ROW LEVEL SECURITY;
ALTER TABLE app.auth_session_assurance ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.auth_session_assurance FORCE ROW LEVEL SECURITY;

-- These provider/security tables are server-resolver data. No browser-facing
-- tenant policy is granted; security-definer/server commands are the only
-- supported access path. FORCE RLS makes accidental broad runtime queries fail.
CREATE POLICY auth_identities_current_actor ON app.auth_identities
  FOR SELECT
  USING (
    internal_user_id = app.current_actor_id()
    OR (
      provider = current_setting('app.auth_provider', true)
      AND provider_user_id = current_setting('app.provider_user_id', true)
    )
  );

CREATE POLICY auth_identities_bind ON app.auth_identities
  FOR INSERT
  WITH CHECK (
    provider = current_setting('app.auth_provider', true)
    AND provider_user_id = current_setting('app.provider_user_id', true)
    AND (
      internal_user_id = app.current_actor_id()
      OR current_setting('app.allow_identity_bind', true) = '1'
    )
  );

CREATE POLICY auth_session_assurance_current_actor ON app.auth_session_assurance
  FOR ALL
  USING (
    internal_user_id = app.current_actor_id()
    AND tenant_id = app.current_tenant_id()
  )
  WITH CHECK (
    internal_user_id = app.current_actor_id()
    AND tenant_id = app.current_tenant_id()
  );

REVOKE ALL PRIVILEGES ON TABLE app.auth_identities FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE app.staff_number_registry FROM PUBLIC;
REVOKE ALL PRIVILEGES ON TABLE app.auth_session_assurance FROM PUBLIC;

CREATE OR REPLACE FUNCTION app.accept_manual_staff_invitation(
  p_token_hash text,
  p_identity_id uuid,
  p_provider_user_id text,
  p_request_id uuid
)
RETURNS TABLE (membership_id uuid, tenant_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, auth, platform
AS $$
DECLARE
  invitation app.staff_invitations%ROWTYPE;
  new_membership_id uuid;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$'
     OR p_identity_id IS NULL OR p_provider_user_id IS NULL
     OR btrim(p_provider_user_id) = '' THEN
    RAISE EXCEPTION 'manual invitation unavailable' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO invitation
  FROM app.staff_invitations
  WHERE token_hash = p_token_hash
    AND delivery_method = 'MANUAL'
    AND status = 'PENDING'
    AND expires_at > clock_timestamp()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'manual invitation unavailable' USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM app.staff_number_registry registry
    WHERE registry.id = invitation.staff_number_registry_id
      AND registry.status = 'RESERVED'
      AND registry.reserved_invitation_id = invitation.id
  ) THEN
    RAISE EXCEPTION 'staff number reservation unavailable' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO app.auth_identities (internal_user_id, provider, provider_user_id)
  VALUES (p_identity_id, 'CLERK', p_provider_user_id);

  new_membership_id := gen_random_uuid();
  PERFORM set_config('app.actor_id', p_identity_id::text, true);
  PERFORM set_config('app.tenant_id', invitation.tenant_id::text, true);
  PERFORM set_config('app.membership_id', new_membership_id::text, true);
  PERFORM set_config('app.request_id', coalesce(p_request_id::text, ''), true);

  INSERT INTO app.memberships (id, tenant_id, identity_id, status)
  VALUES (new_membership_id, invitation.tenant_id, p_identity_id, 'ACTIVE');

  IF invitation.scope_type = 'STATION' THEN
    IF NOT EXISTS (
      SELECT 1 FROM app.staff_invitation_stations station
      WHERE station.tenant_id = invitation.tenant_id
        AND station.invitation_id = invitation.id
    ) THEN
      RAISE EXCEPTION 'station scope is incomplete' USING ERRCODE = 'P0001';
    END IF;
    INSERT INTO app.membership_role_assignments (
      tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id
    )
    SELECT invitation.tenant_id, new_membership_id, invitation.assigned_role,
           invitation.scope_type, station.legal_entity_id, station.station_id
    FROM app.staff_invitation_stations station
    WHERE station.tenant_id = invitation.tenant_id
      AND station.invitation_id = invitation.id;
  ELSE
    INSERT INTO app.membership_role_assignments (
      tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id
    ) VALUES (
      invitation.tenant_id, new_membership_id, invitation.assigned_role,
      invitation.scope_type, invitation.legal_entity_id, NULL
    );
  END IF;

  UPDATE app.staff_number_registry
  SET reserved_invitation_id = NULL,
      internal_user_id = p_identity_id,
      status = 'ASSIGNED',
      updated_at = clock_timestamp()
  WHERE id = invitation.staff_number_registry_id;

  UPDATE app.staff_invitations
  SET status = 'ACCEPTED', accepted_at = clock_timestamp(),
      accepted_by_user_id = p_identity_id,
      accepted_membership_id = new_membership_id,
      updated_at = clock_timestamp()
  WHERE id = invitation.id;

  membership_id := new_membership_id;
  tenant_id := invitation.tenant_id;
  RETURN NEXT;
END;
$$;

REVOKE ALL PRIVILEGES ON FUNCTION app.resolve_auth_identity(text, text) FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION app.resolve_provider_identity(text, uuid) FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION app.reserve_staff_number(uuid, text) FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION app.resolve_staff_number_for_invitation(uuid) FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION app.resolve_staff_number_for_user(uuid) FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION app.resolve_manual_staff_invitation(text, text) FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION app.accept_manual_staff_invitation(text, uuid, text, uuid) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'job_runtime') THEN
    REVOKE ALL PRIVILEGES ON TABLE app.auth_identities FROM job_runtime;
    REVOKE ALL PRIVILEGES ON TABLE app.staff_number_registry FROM job_runtime;
    REVOKE ALL PRIVILEGES ON TABLE app.auth_session_assurance FROM job_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'diagnostics_readonly') THEN
    REVOKE ALL PRIVILEGES ON TABLE app.auth_identities FROM diagnostics_readonly;
    REVOKE ALL PRIVILEGES ON TABLE app.staff_number_registry FROM diagnostics_readonly;
    REVOKE ALL PRIVILEGES ON TABLE app.auth_session_assurance FROM diagnostics_readonly;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_owner') THEN
    ALTER TABLE app.auth_identities OWNER TO migration_owner;
    ALTER TABLE app.staff_number_registry OWNER TO migration_owner;
    ALTER TABLE app.auth_session_assurance OWNER TO migration_owner;
    ALTER TABLE app.staff_invitations OWNER TO migration_owner;
    ALTER FUNCTION app.resolve_auth_identity(text, text) OWNER TO migration_owner;
    ALTER FUNCTION app.resolve_provider_identity(text, uuid) OWNER TO migration_owner;
    ALTER FUNCTION app.reserve_staff_number(uuid, text) OWNER TO migration_owner;
    ALTER FUNCTION app.resolve_staff_number_for_invitation(uuid) OWNER TO migration_owner;
    ALTER FUNCTION app.resolve_staff_number_for_user(uuid) OWNER TO migration_owner;
    ALTER FUNCTION app.resolve_manual_staff_invitation(text, text) OWNER TO migration_owner;
    ALTER FUNCTION app.accept_manual_staff_invitation(text, uuid, text, uuid) OWNER TO migration_owner;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT EXECUTE ON FUNCTION app.resolve_auth_identity(text, text) TO app_runtime;
    GRANT EXECUTE ON FUNCTION app.resolve_provider_identity(text, uuid) TO app_runtime;
    GRANT EXECUTE ON FUNCTION app.reserve_staff_number(uuid, text) TO app_runtime;
    GRANT EXECUTE ON FUNCTION app.resolve_staff_number_for_invitation(uuid) TO app_runtime;
    GRANT EXECUTE ON FUNCTION app.resolve_staff_number_for_user(uuid) TO app_runtime;
    GRANT EXECUTE ON FUNCTION app.resolve_manual_staff_invitation(text, text) TO app_runtime;
    GRANT EXECUTE ON FUNCTION app.accept_manual_staff_invitation(text, uuid, text, uuid) TO app_runtime;
  END IF;
END
$$;

-- Existing identities remain Better Auth identities during the staged rollout.
INSERT INTO app.auth_identities (internal_user_id, provider, provider_user_id)
SELECT id, 'BETTER_AUTH', id::text
FROM auth."user"
ON CONFLICT (internal_user_id, provider) DO NOTHING;
