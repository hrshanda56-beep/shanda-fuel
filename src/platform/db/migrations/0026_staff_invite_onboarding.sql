-- Staff invitation onboarding. This migration is forward-only and intentionally
-- does not mutate existing memberships or business data.
CREATE UNIQUE INDEX auth_user_normalized_email_uidx
  ON auth."user" (lower(btrim(email)));
--> statement-breakpoint

CREATE TABLE app.staff_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  invited_email text NOT NULL,
  invited_name text NOT NULL,
  assigned_role text NOT NULL,
  scope_type text NOT NULL,
  legal_entity_id uuid,
  token_hash text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid NOT NULL,
  created_by_membership_id uuid NOT NULL,
  revoked_by_user_id uuid,
  accepted_by_user_id uuid,
  accepted_membership_id uuid,
  CONSTRAINT staff_invitations_tenant_id_id_uidx UNIQUE (tenant_id, id),
  CONSTRAINT staff_invitations_tenant_id_id_legal_entity_uidx UNIQUE (tenant_id, id, legal_entity_id),
  CONSTRAINT staff_invitations_token_hash_uidx UNIQUE (token_hash),
  CONSTRAINT staff_invitations_email_ck CHECK (invited_email = lower(btrim(invited_email))),
  CONSTRAINT staff_invitations_name_ck CHECK (btrim(invited_name) <> ''),
  CONSTRAINT staff_invitations_token_hash_ck CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT staff_invitations_status_ck CHECK (status IN ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED')),
  CONSTRAINT staff_invitations_scope_ck CHECK (
    (scope_type = 'TENANT' AND legal_entity_id IS NULL AND assigned_role IN ('OWNER', 'ADMINISTRATOR'))
    OR (scope_type = 'LEGAL_ENTITY' AND legal_entity_id IS NOT NULL AND assigned_role = 'FINANCE')
    OR (scope_type = 'STATION' AND legal_entity_id IS NOT NULL AND assigned_role IN ('FINANCE', 'SUPERVISOR', 'ATTENDANT'))
  ),
  CONSTRAINT staff_invitations_lifecycle_ck CHECK (
    (status = 'PENDING' AND accepted_at IS NULL AND revoked_at IS NULL)
    OR (status = 'ACCEPTED' AND accepted_at IS NOT NULL AND revoked_at IS NULL)
    OR (status = 'REVOKED' AND accepted_at IS NULL AND revoked_at IS NOT NULL)
    OR (status = 'EXPIRED' AND accepted_at IS NULL AND revoked_at IS NULL)
  ),
  CONSTRAINT staff_invitations_expiry_ck CHECK (expires_at > created_at),
  CONSTRAINT staff_invitations_tenant_fk FOREIGN KEY (tenant_id)
    REFERENCES app.tenants (id),
  CONSTRAINT staff_invitations_role_fk FOREIGN KEY (assigned_role)
    REFERENCES platform.role_definitions (code),
  CONSTRAINT staff_invitations_legal_entity_fk FOREIGN KEY (tenant_id, legal_entity_id)
    REFERENCES app.legal_entities (tenant_id, id),
  CONSTRAINT staff_invitations_created_by_user_fk FOREIGN KEY (created_by_user_id)
    REFERENCES auth."user" (id),
  CONSTRAINT staff_invitations_created_by_membership_fk FOREIGN KEY (tenant_id, created_by_membership_id)
    REFERENCES app.memberships (tenant_id, id),
  CONSTRAINT staff_invitations_revoked_by_user_fk FOREIGN KEY (revoked_by_user_id)
    REFERENCES auth."user" (id),
  CONSTRAINT staff_invitations_accepted_by_user_fk FOREIGN KEY (accepted_by_user_id)
    REFERENCES auth."user" (id),
  CONSTRAINT staff_invitations_accepted_membership_fk FOREIGN KEY (tenant_id, accepted_membership_id)
    REFERENCES app.memberships (tenant_id, id)
);
--> statement-breakpoint

CREATE TABLE app.staff_invitation_stations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  invitation_id uuid NOT NULL,
  legal_entity_id uuid NOT NULL,
  station_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_invitation_stations_tenant_id_id_uidx UNIQUE (tenant_id, id),
  CONSTRAINT staff_invitation_stations_invitation_station_uidx UNIQUE (tenant_id, invitation_id, station_id),
  CONSTRAINT staff_invitation_stations_invitation_fk FOREIGN KEY (tenant_id, invitation_id, legal_entity_id)
    REFERENCES app.staff_invitations (tenant_id, id, legal_entity_id),
  CONSTRAINT staff_invitation_stations_station_fk FOREIGN KEY (tenant_id, legal_entity_id, station_id)
    REFERENCES app.stations (tenant_id, legal_entity_id, id)
);
--> statement-breakpoint

CREATE INDEX staff_invitations_tenant_status_idx
  ON app.staff_invitations (tenant_id, status);
--> statement-breakpoint
CREATE INDEX staff_invitations_expiry_idx
  ON app.staff_invitations (tenant_id, expires_at);
--> statement-breakpoint
CREATE UNIQUE INDEX staff_invitations_pending_email_uidx
  ON app.staff_invitations (tenant_id, invited_email)
  WHERE status = 'PENDING';
--> statement-breakpoint
CREATE INDEX staff_invitation_stations_station_idx
  ON app.staff_invitation_stations (tenant_id, station_id);
--> statement-breakpoint

-- Staff-management policies inspect role assignments while the active-membership
-- helper inspects memberships. Cache one context-local result so those checks do
-- not recurse through each other under forced RLS.
CREATE OR REPLACE FUNCTION app.has_active_membership() RETURNS boolean
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  context_key text;
  cached_key text;
  cached_result text;
  active boolean;
BEGIN
  context_key := concat_ws(
    '|',
    coalesce(current_setting('app.tenant_id', true), ''),
    coalesce(current_setting('app.actor_id', true), ''),
    coalesce(current_setting('app.membership_id', true), '')
  );
  cached_key := current_setting('app.active_membership_check_key', true);
  cached_result := current_setting('app.active_membership_check_result', true);

  IF cached_key = context_key AND cached_result IN ('t', 'f') THEN
    RETURN cached_result = 't';
  END IF;

  IF current_setting('app.active_membership_checking', true) = '1' THEN
    RETURN false;
  END IF;

  PERFORM set_config('app.active_membership_checking', '1', true);
  SELECT EXISTS (
    SELECT 1
    FROM app.memberships membership
    WHERE membership.tenant_id = app.current_tenant_id()
      AND membership.id = app.current_membership_id()
      AND membership.identity_id = app.current_actor_id()
      AND membership.status = 'ACTIVE'
  ) INTO active;
  PERFORM set_config('app.active_membership_checking', '0', true);
  PERFORM set_config('app.active_membership_check_key', context_key, true);
  PERFORM set_config('app.active_membership_check_result', active::text, true);
  RETURN active;
EXCEPTION
  WHEN OTHERS THEN
    PERFORM set_config('app.active_membership_checking', '0', true);
    RAISE;
END;
$$;
--> statement-breakpoint

ALTER TABLE app.staff_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.staff_invitations FORCE ROW LEVEL SECURITY;
ALTER TABLE app.staff_invitation_stations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.staff_invitation_stations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

CREATE POLICY staff_invitations_tenant_context ON app.staff_invitations
  USING (tenant_id = app.current_tenant_id() AND app.has_active_membership())
  WITH CHECK (tenant_id = app.current_tenant_id() AND app.has_active_membership());
--> statement-breakpoint
CREATE POLICY staff_invitations_token_lookup ON app.staff_invitations
  FOR SELECT
  USING (
    token_hash = current_setting('app.invitation_token_hash', true)
    AND status = 'PENDING'
    AND expires_at > clock_timestamp()
  );
--> statement-breakpoint
CREATE POLICY staff_invitations_token_accept ON app.staff_invitations
  FOR UPDATE
  USING (
    token_hash = current_setting('app.invitation_token_hash', true)
    AND status = 'PENDING'
  )
  WITH CHECK (
    token_hash = current_setting('app.invitation_token_hash', true)
    AND status = 'ACCEPTED'
  );
--> statement-breakpoint

CREATE POLICY staff_invitation_stations_tenant_context ON app.staff_invitation_stations
  USING (tenant_id = app.current_tenant_id() AND app.has_active_membership())
  WITH CHECK (tenant_id = app.current_tenant_id() AND app.has_active_membership());
--> statement-breakpoint
CREATE POLICY staff_invitation_stations_token_lookup ON app.staff_invitation_stations
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM app.staff_invitations invitation
      WHERE invitation.tenant_id = staff_invitation_stations.tenant_id
        AND invitation.id = staff_invitation_stations.invitation_id
        AND invitation.token_hash = current_setting('app.invitation_token_hash', true)
        AND invitation.status = 'PENDING'
        AND invitation.expires_at > clock_timestamp()
    )
  );
--> statement-breakpoint

CREATE POLICY memberships_staff_invitation_acceptance ON app.memberships
  FOR ALL
  USING (
    tenant_id = app.current_tenant_id()
    AND identity_id = app.current_actor_id()
    AND current_setting('app.invitation_token_hash', true) <> ''
    AND EXISTS (
      SELECT 1
      FROM app.staff_invitations invitation
      WHERE invitation.tenant_id = app.current_tenant_id()
        AND invitation.token_hash = current_setting('app.invitation_token_hash', true)
        AND invitation.status = 'PENDING'
        AND invitation.expires_at > clock_timestamp()
    )
  )
  WITH CHECK (
    tenant_id = app.current_tenant_id()
    AND identity_id = app.current_actor_id()
    AND current_setting('app.invitation_token_hash', true) <> ''
  );
--> statement-breakpoint
CREATE POLICY membership_roles_staff_invitation_acceptance ON app.membership_role_assignments
  FOR INSERT
  WITH CHECK (
    tenant_id = app.current_tenant_id()
    AND membership_id = app.current_membership_id()
    AND app.has_active_membership()
    AND EXISTS (
      SELECT 1
      FROM app.staff_invitations invitation
      WHERE invitation.tenant_id = app.current_tenant_id()
        AND invitation.token_hash = current_setting('app.invitation_token_hash', true)
        AND invitation.status = 'PENDING'
        AND invitation.expires_at > clock_timestamp()
    )
  );
--> statement-breakpoint
CREATE POLICY tenants_staff_invitation_lookup ON app.tenants
  FOR SELECT
  USING (
    id = (
      SELECT invitation.tenant_id
      FROM app.staff_invitations invitation
      WHERE invitation.token_hash = current_setting('app.invitation_token_hash', true)
        AND invitation.status = 'PENDING'
        AND invitation.expires_at > clock_timestamp()
      LIMIT 1
    )
  );
--> statement-breakpoint

CREATE POLICY memberships_staff_management ON app.memberships
  FOR SELECT
  USING (
    tenant_id = app.current_tenant_id()
    AND app.has_active_membership()
    AND EXISTS (
      SELECT 1
      FROM app.membership_role_assignments assignment
      WHERE assignment.tenant_id = app.current_tenant_id()
        AND assignment.membership_id = app.current_membership_id()
        AND assignment.scope_type = 'TENANT'
        AND assignment.role_code IN ('OWNER', 'ADMINISTRATOR')
    )
  );
--> statement-breakpoint
CREATE POLICY memberships_staff_management_update ON app.memberships
  FOR UPDATE
  USING (
    tenant_id = app.current_tenant_id()
    AND app.has_active_membership()
    AND EXISTS (
      SELECT 1
      FROM app.membership_role_assignments assignment
      WHERE assignment.tenant_id = app.current_tenant_id()
        AND assignment.membership_id = app.current_membership_id()
        AND assignment.scope_type = 'TENANT'
        AND assignment.role_code IN ('OWNER', 'ADMINISTRATOR')
    )
  )
  WITH CHECK (tenant_id = app.current_tenant_id());
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.resolve_staff_invitation(p_token_hash text)
RETURNS TABLE (
  invitation_id uuid,
  organisation_name text,
  invited_email text,
  invited_name text,
  existing_identity boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, auth
AS $$
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN;
  END IF;

  PERFORM set_config('app.invitation_token_hash', p_token_hash, true);

  RETURN QUERY
  SELECT invitation.id,
         tenant.name,
         invitation.invited_email,
         invitation.invited_name,
         EXISTS (
           SELECT 1
           FROM auth."user" identity
           WHERE lower(btrim(identity.email)) = invitation.invited_email
         )
  FROM app.staff_invitations invitation
  JOIN app.tenants tenant ON tenant.id = invitation.tenant_id
  WHERE invitation.token_hash = p_token_hash
    AND invitation.status = 'PENDING'
    AND invitation.expires_at > clock_timestamp();
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.accept_staff_invitation(
  p_token_hash text,
  p_identity_id uuid,
  p_request_id uuid
)
RETURNS TABLE (
  invitation_id uuid,
  tenant_id uuid,
  membership_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app, auth, platform
AS $$
DECLARE
  invitation app.staff_invitations%ROWTYPE;
  existing_membership app.memberships%ROWTYPE;
  identity_email text;
  new_membership_id uuid;
BEGIN
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' OR p_identity_id IS NULL THEN
    RAISE EXCEPTION 'invitation unavailable' USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('app.invitation_token_hash', p_token_hash, true);
  PERFORM set_config('app.actor_id', p_identity_id::text, true);
  PERFORM set_config('app.request_id', COALESCE(p_request_id::text, ''), true);

  SELECT * INTO invitation
  FROM app.staff_invitations
  WHERE token_hash = p_token_hash
    AND status = 'PENDING'
    AND expires_at > clock_timestamp()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invitation unavailable' USING ERRCODE = 'P0001';
  END IF;

  SELECT email INTO identity_email
  FROM auth."user"
  WHERE id = p_identity_id;

  IF NOT FOUND OR lower(btrim(identity_email)) <> invitation.invited_email THEN
    RAISE EXCEPTION 'invitation unavailable' USING ERRCODE = 'P0001';
  END IF;

  PERFORM 1 FROM app.tenants WHERE id = invitation.tenant_id FOR UPDATE;

  SELECT * INTO existing_membership
  FROM app.memberships
  WHERE app.memberships.tenant_id = invitation.tenant_id
    AND app.memberships.identity_id = p_identity_id
  FOR UPDATE;

  IF FOUND THEN
    RAISE EXCEPTION 'staff membership already exists' USING ERRCODE = 'P0001';
  END IF;

  new_membership_id := gen_random_uuid();
  PERFORM set_config('app.tenant_id', invitation.tenant_id::text, true);
  PERFORM set_config('app.membership_id', new_membership_id::text, true);

  INSERT INTO app.memberships (id, tenant_id, identity_id, status)
  VALUES (new_membership_id, invitation.tenant_id, p_identity_id, 'ACTIVE');

  IF invitation.scope_type = 'STATION' THEN
    IF NOT EXISTS (
      SELECT 1 FROM app.staff_invitation_stations
      WHERE app.staff_invitation_stations.tenant_id = invitation.tenant_id
        AND app.staff_invitation_stations.invitation_id = invitation.id
    ) THEN
      RAISE EXCEPTION 'station scope is incomplete' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO app.membership_role_assignments (
      tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id
    )
    SELECT invitation.tenant_id,
           new_membership_id,
           invitation.assigned_role,
           invitation.scope_type,
           station.legal_entity_id,
           station.station_id
    FROM app.staff_invitation_stations station
    WHERE station.tenant_id = invitation.tenant_id
      AND station.invitation_id = invitation.id;
  ELSE
    INSERT INTO app.membership_role_assignments (
      tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id
    )
    VALUES (
      invitation.tenant_id,
      new_membership_id,
      invitation.assigned_role,
      invitation.scope_type,
      invitation.legal_entity_id,
      NULL
    );
  END IF;

  UPDATE app.staff_invitations
  SET status = 'ACCEPTED',
      accepted_at = clock_timestamp(),
      accepted_by_user_id = p_identity_id,
      accepted_membership_id = new_membership_id,
      updated_at = clock_timestamp()
  WHERE id = invitation.id;

  invitation_id := invitation.id;
  tenant_id := invitation.tenant_id;
  membership_id := new_membership_id;
  RETURN NEXT;
END;
$$;
--> statement-breakpoint

REVOKE ALL PRIVILEGES ON FUNCTION app.resolve_staff_invitation(text) FROM PUBLIC;
REVOKE ALL PRIVILEGES ON FUNCTION app.accept_staff_invitation(text, uuid, uuid) FROM PUBLIC;
--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_owner') THEN
    ALTER TABLE app.staff_invitations OWNER TO migration_owner;
    ALTER TABLE app.staff_invitation_stations OWNER TO migration_owner;
    ALTER INDEX app.staff_invitations_tenant_id_id_uidx OWNER TO migration_owner;
    ALTER INDEX app.staff_invitations_tenant_id_id_legal_entity_uidx OWNER TO migration_owner;
    ALTER INDEX app.staff_invitations_token_hash_uidx OWNER TO migration_owner;
    ALTER INDEX app.staff_invitations_pending_email_uidx OWNER TO migration_owner;
    ALTER INDEX app.staff_invitations_tenant_status_idx OWNER TO migration_owner;
    ALTER INDEX app.staff_invitations_expiry_idx OWNER TO migration_owner;
    ALTER INDEX app.staff_invitation_stations_tenant_id_id_uidx OWNER TO migration_owner;
    ALTER INDEX app.staff_invitation_stations_invitation_station_uidx OWNER TO migration_owner;
    ALTER INDEX app.staff_invitation_stations_station_idx OWNER TO migration_owner;
    ALTER INDEX auth.auth_user_normalized_email_uidx OWNER TO migration_owner;
    ALTER FUNCTION app.resolve_staff_invitation(text) OWNER TO migration_owner;
    ALTER FUNCTION app.accept_staff_invitation(text, uuid, uuid) OWNER TO migration_owner;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON app.staff_invitations TO app_runtime;
    GRANT SELECT, INSERT, UPDATE ON app.staff_invitation_stations TO app_runtime;
    GRANT EXECUTE ON FUNCTION app.resolve_staff_invitation(text) TO app_runtime;
    GRANT EXECUTE ON FUNCTION app.accept_staff_invitation(text, uuid, uuid) TO app_runtime;
    REVOKE DELETE ON app.staff_invitations, app.staff_invitation_stations FROM app_runtime;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'job_runtime') THEN
    REVOKE ALL PRIVILEGES ON app.staff_invitations, app.staff_invitation_stations FROM job_runtime;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'diagnostics_readonly') THEN
    REVOKE ALL PRIVILEGES ON app.staff_invitations, app.staff_invitation_stations FROM diagnostics_readonly;
  END IF;
END
$$;
