-- First-user provisioning capability.
--
-- The caller receives only EXECUTE on the fixed API below.  It receives no
-- application-table privileges and no caller-activatable RLS policy.  The
-- trusted migration_owner SECURITY DEFINER owner performs the complete,
-- tenant-validated operation internally.  No bootstrap authorization decision
-- depends on session_user or a caller-set custom GUC.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_owner') THEN
    RAISE EXCEPTION 'migration_owner role is required for first-user provisioning capability';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'first_user_provisioner') THEN
    RAISE EXCEPTION 'first_user_provisioner role is required for first-user provisioning capability';
  END IF;
END
$$;

-- 0021 is unmerged and may replace the earlier review-blocked shape.  Remove
-- its caller-controlled policies/functions when this migration is applied to
-- a disposable database that already contains that unmerged revision.
DROP POLICY IF EXISTS first_user_provisioning_scope_read ON app.tenants;
DROP POLICY IF EXISTS first_user_provisioning_scope_lock ON app.tenants;
DROP POLICY IF EXISTS first_user_provisioning_scope_read ON app.legal_entities;
DROP POLICY IF EXISTS first_user_provisioning_scope_lock ON app.legal_entities;
DROP POLICY IF EXISTS first_user_provisioning_scope_read ON app.stations;
DROP POLICY IF EXISTS first_user_provisioning_scope_lock ON app.stations;
DROP POLICY IF EXISTS first_user_provisioning_membership_read ON app.memberships;
DROP POLICY IF EXISTS first_user_provisioning_membership_insert ON app.memberships;
DROP POLICY IF EXISTS first_user_provisioning_membership_revoke ON app.memberships;
DROP POLICY IF EXISTS first_user_provisioning_role_assignment_read ON app.membership_role_assignments;
DROP POLICY IF EXISTS first_user_provisioning_grant_read ON app.temporary_permission_grants;
DROP POLICY IF EXISTS first_user_provisioning_grant_insert ON app.temporary_permission_grants;
DROP POLICY IF EXISTS first_user_provisioning_grant_revoke ON app.temporary_permission_grants;
DROP POLICY IF EXISTS first_user_provisioning_audit_append ON platform.security_events;

DROP FUNCTION IF EXISTS platform.first_user_provisioning_require_caller();
DROP FUNCTION IF EXISTS platform.first_user_provisioning_set_context(text, uuid, uuid, uuid, uuid, uuid);
DROP FUNCTION IF EXISTS platform.first_user_provisioning_permission_definitions(text[]);
DROP FUNCTION IF EXISTS platform.first_user_provisioning_revoke(uuid, uuid, uuid, uuid, uuid, uuid, uuid[], jsonb);

CREATE TABLE platform.first_user_provisioning_operations (
  operation_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL UNIQUE REFERENCES app.tenants (id),
  legal_entity_id uuid NOT NULL,
  station_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES auth."user" (id),
  membership_id uuid NOT NULL,
  email text NOT NULL,
  status text NOT NULL CHECK (status IN ('PROVISIONED', 'REVOKED')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz,
  CONSTRAINT first_user_provisioning_operations_legal_entity_fk
    FOREIGN KEY (tenant_id, legal_entity_id)
    REFERENCES app.legal_entities (tenant_id, id),
  CONSTRAINT first_user_provisioning_operations_station_fk
    FOREIGN KEY (tenant_id, legal_entity_id, station_id)
    REFERENCES app.stations (tenant_id, legal_entity_id, id),
  CONSTRAINT first_user_provisioning_operations_membership_fk
    FOREIGN KEY (tenant_id, membership_id)
    REFERENCES app.memberships (tenant_id, id),
  CONSTRAINT first_user_provisioning_operations_status_time_ck
    CHECK ((status = 'PROVISIONED' AND revoked_at IS NULL)
      OR (status = 'REVOKED' AND revoked_at IS NOT NULL))
);

CREATE TABLE platform.first_user_provisioning_operation_grants (
  operation_id uuid NOT NULL REFERENCES platform.first_user_provisioning_operations (operation_id),
  tenant_id uuid NOT NULL,
  grant_id uuid NOT NULL,
  permission_code text NOT NULL,
  scope_type text NOT NULL,
  legal_entity_id uuid,
  station_id uuid,
  PRIMARY KEY (operation_id, permission_code),
  UNIQUE (operation_id, grant_id),
  CONSTRAINT first_user_provisioning_operation_grants_grant_fk
    FOREIGN KEY (tenant_id, grant_id)
    REFERENCES app.temporary_permission_grants (tenant_id, id)
);

ALTER TABLE platform.first_user_provisioning_operations OWNER TO migration_owner;
ALTER TABLE platform.first_user_provisioning_operation_grants OWNER TO migration_owner;
ALTER TABLE platform.first_user_provisioning_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.first_user_provisioning_operations FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.first_user_provisioning_operation_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.first_user_provisioning_operation_grants FORCE ROW LEVEL SECURITY;
REVOKE ALL ON platform.first_user_provisioning_operations FROM PUBLIC;
REVOKE ALL ON platform.first_user_provisioning_operation_grants FROM PUBLIC;

-- The trusted definer owner is the only principal allowed through these
-- policies.  They are not activated by session_user, custom GUCs, or caller
-- input.  The provisioner has no table privilege that could use them.
CREATE POLICY first_user_provisioning_definer ON app.tenants
  FOR ALL USING (current_user = 'migration_owner')
  WITH CHECK (current_user = 'migration_owner');
CREATE POLICY first_user_provisioning_definer ON app.legal_entities
  FOR ALL USING (current_user = 'migration_owner')
  WITH CHECK (current_user = 'migration_owner');
CREATE POLICY first_user_provisioning_definer ON app.stations
  FOR ALL USING (current_user = 'migration_owner')
  WITH CHECK (current_user = 'migration_owner');
CREATE POLICY first_user_provisioning_definer ON app.memberships
  FOR ALL USING (current_user = 'migration_owner')
  WITH CHECK (current_user = 'migration_owner');
CREATE POLICY first_user_provisioning_definer ON app.membership_role_assignments
  FOR ALL USING (current_user = 'migration_owner')
  WITH CHECK (current_user = 'migration_owner');
CREATE POLICY first_user_provisioning_definer ON app.temporary_permission_grants
  FOR ALL USING (current_user = 'migration_owner')
  WITH CHECK (current_user = 'migration_owner');
CREATE POLICY first_user_provisioning_definer ON platform.security_events
  FOR ALL USING (current_user = 'migration_owner')
  WITH CHECK (current_user = 'migration_owner');
CREATE POLICY first_user_provisioning_definer ON platform.first_user_provisioning_operations
  FOR ALL USING (current_user = 'migration_owner')
  WITH CHECK (current_user = 'migration_owner');
CREATE POLICY first_user_provisioning_definer ON platform.first_user_provisioning_operation_grants
  FOR ALL USING (current_user = 'migration_owner')
  WITH CHECK (current_user = 'migration_owner');

CREATE OR REPLACE FUNCTION platform.first_user_provisioning_assert_runtime_role()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, platform, app, auth
AS $$
DECLARE
  v_role oid;
  v_expected_functions oid[];
BEGIN
  SELECT oid INTO v_role FROM pg_roles WHERE rolname = 'first_user_provisioner';
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'first_user_provisioner role is missing' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE oid = v_role
      AND (NOT rolcanlogin OR rolsuper OR rolbypassrls OR rolcreaterole
        OR rolcreatedb OR rolinherit OR rolreplication OR rolconfig IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'first_user_provisioner role attributes are unsafe' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_database WHERE datname = current_database() AND datdba = v_role)
     OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspowner = v_role)
     OR EXISTS (SELECT 1 FROM pg_class WHERE relowner = v_role)
     OR EXISTS (SELECT 1 FROM pg_auth_members WHERE member = v_role)
  THEN
    RAISE EXCEPTION 'first_user_provisioner has an unsafe owner or role membership' USING ERRCODE = '42501';
  END IF;

  IF has_database_privilege('first_user_provisioner', current_database(), 'CREATE')
     OR has_schema_privilege('first_user_provisioner', 'app', 'CREATE')
     OR has_schema_privilege('first_user_provisioner', 'auth', 'CREATE')
     OR has_schema_privilege('first_user_provisioner', 'platform', 'CREATE')
     OR has_schema_privilege('first_user_provisioner', 'app', 'USAGE')
     OR has_schema_privilege('first_user_provisioner', 'auth', 'USAGE')
     OR NOT has_schema_privilege('first_user_provisioner', 'platform', 'USAGE')
  THEN
    RAISE EXCEPTION 'first_user_provisioner has an unsafe database or schema privilege' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
     WHERE n.nspname IN ('app', 'auth', 'platform')
       AND acl.grantee = v_role
  ) THEN
    RAISE EXCEPTION 'first_user_provisioner has an unexpected direct table privilege' USING ERRCODE = '42501';
  END IF;

  v_expected_functions := ARRAY[
    'platform.first_user_provisioning_assert_runtime_role()'::regprocedure::oid,
    'platform.first_user_provisioning_scope_options(uuid,uuid,uuid)'::regprocedure::oid,
    'platform.first_user_provisioning_identity(text,uuid)'::regprocedure::oid,
    'platform.first_user_provisioning_permission_definitions()'::regprocedure::oid,
    'platform.first_user_provisioning_grants(uuid,uuid,uuid)'::regprocedure::oid,
    'platform.first_user_provisioning_provision(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,timestamptz,jsonb,jsonb)'::regprocedure::oid,
    'platform.first_user_provisioning_revoke(uuid,uuid,uuid,uuid,uuid,uuid,jsonb)'::regprocedure::oid,
    'platform.first_user_provisioning_append_failure(uuid,jsonb)'::regprocedure::oid
  ];

  IF EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
     WHERE n.nspname IN ('app', 'auth', 'platform')
       AND acl.grantee = v_role
       AND p.oid <> ALL(v_expected_functions)
  ) OR EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'platform'
       AND p.oid <> ALL(v_expected_functions)
       AND has_function_privilege('first_user_provisioner', p.oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'first_user_provisioner has an unexpected function EXECUTE privilege' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM unnest(v_expected_functions) expected(function_oid)
     WHERE NOT has_function_privilege('first_user_provisioner', expected.function_oid, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'first_user_provisioner is missing a required function EXECUTE privilege' USING ERRCODE = '42501';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION platform.first_user_provisioning_scope_options(
  p_tenant_id uuid DEFAULT NULL,
  p_legal_entity_id uuid DEFAULT NULL,
  p_station_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, platform, app, auth
AS $$
DECLARE
  v_tenants jsonb;
  v_legal_entities jsonb;
  v_stations jsonb;
BEGIN
  PERFORM platform.first_user_provisioning_assert_runtime_role();
  IF p_tenant_id IS NULL AND (p_legal_entity_id IS NOT NULL OR p_station_id IS NOT NULL) THEN
    RAISE EXCEPTION 'legal entity and station filters require a tenant filter' USING ERRCODE = '22023';
  END IF;
  IF p_legal_entity_id IS NULL AND p_station_id IS NOT NULL THEN
    RAISE EXCEPTION 'station filter requires a legal entity filter' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id::text, 'name', t.name, 'status', t.status
  ) ORDER BY t.name, t.id), '[]'::jsonb)
    INTO v_tenants
    FROM app.tenants t
   WHERE t.status = 'ACTIVE'
     AND (p_tenant_id IS NULL OR t.id = p_tenant_id);

  IF p_tenant_id IS NULL THEN
    v_legal_entities := '[]'::jsonb;
    v_stations := '[]'::jsonb;
  ELSE
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id::text, 'tenantId', e.tenant_id::text,
      'name', e.legal_name, 'status', e.status
    ) ORDER BY e.legal_name, e.id), '[]'::jsonb)
      INTO v_legal_entities
      FROM app.legal_entities e
     WHERE e.tenant_id = p_tenant_id
       AND e.status = 'ACTIVE'
       AND (p_legal_entity_id IS NULL OR e.id = p_legal_entity_id);

    IF p_legal_entity_id IS NULL THEN
      v_stations := '[]'::jsonb;
    ELSE
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id::text, 'tenantId', s.tenant_id::text,
        'legalEntityId', s.legal_entity_id::text, 'code', s.code,
        'name', s.name, 'status', s.status
      ) ORDER BY s.code, s.id), '[]'::jsonb)
        INTO v_stations
        FROM app.stations s
       WHERE s.tenant_id = p_tenant_id
         AND s.legal_entity_id = p_legal_entity_id
         AND s.status = 'ACTIVE'
         AND (p_station_id IS NULL OR s.id = p_station_id);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'tenants', v_tenants,
    'legalEntities', v_legal_entities,
    'stations', v_stations
  );
END
$$;

CREATE OR REPLACE FUNCTION platform.first_user_provisioning_identity(
  p_email text,
  p_tenant_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, platform, app, auth
AS $$
DECLARE
  v_user auth."user"%ROWTYPE;
  v_accounts jsonb;
  v_memberships jsonb;
BEGIN
  PERFORM platform.first_user_provisioning_assert_runtime_role();
  IF p_email IS NULL OR p_email <> lower(btrim(p_email)) OR length(p_email) > 320 THEN
    RAISE EXCEPTION 'first-user provisioning email is invalid' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_user FROM auth."user" u WHERE u.email = p_email LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id::text, 'accountId', a.account_id,
    'providerId', a.provider_id, 'userId', a.user_id::text,
    'hasPassword', a.password IS NOT NULL
  ) ORDER BY a.id), '[]'::jsonb)
    INTO v_accounts
    FROM auth.account a WHERE a.user_id = v_user.id;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id::text, 'tenantId', m.tenant_id::text,
    'identityId', m.identity_id::text, 'status', m.status,
    'roleAssignmentCount', (
      SELECT count(*)::integer FROM app.membership_role_assignments a
       WHERE a.tenant_id = m.tenant_id AND a.membership_id = m.id
    )
  ) ORDER BY m.tenant_id, m.id), '[]'::jsonb)
    INTO v_memberships
    FROM app.memberships m
   WHERE m.identity_id = v_user.id
     AND (p_tenant_id IS NULL OR m.tenant_id = p_tenant_id);

  RETURN jsonb_build_object(
    'id', v_user.id::text, 'name', v_user.name, 'email', v_user.email,
    'accounts', v_accounts, 'memberships', v_memberships
  );
END
$$;

CREATE OR REPLACE FUNCTION platform.first_user_provisioning_permission_definitions()
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, platform, app, auth
AS $$
DECLARE
  v_allowed constant text[] := ARRAY[
    'tenant.context.select', 'tenant.view', 'legal_entity.view',
    'station.view', 'business_day.view', 'shift.view',
    'supplier.view', 'supplier.creditor.review', 'inventory.view',
    'provider.settlement.view', 'cash.collection.view', 'cash.deposit.view'
  ]::text[];
  v_codes text[];
BEGIN
  PERFORM platform.first_user_provisioning_assert_runtime_role();
  SELECT coalesce(array_agg(p.code ORDER BY array_position(v_allowed, p.code)), ARRAY[]::text[])
    INTO v_codes
    FROM platform.permission_definitions p
   WHERE p.code = ANY(v_allowed);
  RETURN v_codes;
END
$$;

CREATE OR REPLACE FUNCTION platform.first_user_provisioning_grants(
  p_tenant_id uuid,
  p_membership_id uuid,
  p_operation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, platform, app, auth
AS $$
BEGIN
  PERFORM platform.first_user_provisioning_assert_runtime_role();
  IF NOT EXISTS (
    SELECT 1 FROM platform.first_user_provisioning_operations o
     WHERE o.operation_id = p_operation_id
       AND o.tenant_id = p_tenant_id
       AND o.membership_id = p_membership_id
  ) THEN
    RAISE EXCEPTION 'first-user provisioning operation was not found for this scope' USING ERRCODE = '22023';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', g.id::text, 'tenantId', g.tenant_id::text,
      'membershipId', g.membership_id::text, 'permissionCode', g.permission_code,
      'scopeType', g.scope_type, 'legalEntityId', g.legal_entity_id::text,
      'stationId', g.station_id::text, 'reason', g.reason
    ) ORDER BY g.id)
      FROM app.temporary_permission_grants g
      JOIN platform.first_user_provisioning_operation_grants og
        ON og.tenant_id = g.tenant_id AND og.grant_id = g.id
       AND og.operation_id = p_operation_id
     WHERE g.tenant_id = p_tenant_id
       AND g.membership_id = p_membership_id
       AND g.revoked_at IS NULL
  ), '[]'::jsonb);
END
$$;

CREATE OR REPLACE FUNCTION platform.first_user_provisioning_validate_event(
  p_event jsonb,
  p_expected_code text,
  p_tenant_id uuid,
  p_membership_id uuid,
  p_subject_id uuid,
  p_operation_id uuid
)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, platform, app, auth
AS $$
BEGIN
  IF p_event IS NULL
     OR p_event->>'eventId' IS NULL
     OR p_event->>'tenantId' IS DISTINCT FROM p_tenant_id::text
     OR p_event->>'membershipId' IS DISTINCT FROM p_membership_id::text
     OR p_event->>'eventCode' IS DISTINCT FROM p_expected_code
     OR p_event->>'requestId' IS NULL
     OR p_event->>'occurredAt' IS NULL
     OR p_event->>'keyId' IS NULL
     OR p_event->>'algorithm' IS DISTINCT FROM 'hmac-sha256'
     OR p_event->>'signature' IS NULL
     OR p_event->'details'->>'actorType' IS DISTINCT FROM 'SUPPORT'
     OR p_event->'details'->>'initiatedBy' IS DISTINCT FROM 'first-production-user-provisioning'
     OR p_event->'details'->>'subjectType' IS DISTINCT FROM 'auth.user'
     OR p_event->'details'->>'subjectId' IS DISTINCT FROM p_subject_id::text
     OR p_event->'details'->'metadata'->>'operationId' IS DISTINCT FROM p_operation_id::text
     OR p_event ? 'actorId'
     OR lower(p_event::text) ~ '(password|secret|token|cookie)'
  THEN
    RAISE EXCEPTION 'first-user provisioning audit event is invalid' USING ERRCODE = '22023';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION platform.first_user_provisioning_insert_event(
  p_event jsonb,
  p_expected_code text,
  p_tenant_id uuid,
  p_membership_id uuid,
  p_subject_id uuid,
  p_operation_id uuid
)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, platform, app, auth
AS $$
BEGIN
  PERFORM platform.first_user_provisioning_validate_event(
    p_event, p_expected_code, p_tenant_id, p_membership_id, p_subject_id, p_operation_id
  );
  INSERT INTO platform.security_events (
    id, tenant_id, membership_id, actor_id, event_code, request_id,
    occurred_at, details, key_id, algorithm, signature
  ) VALUES (
    (p_event->>'eventId')::uuid, p_tenant_id, p_membership_id, NULL,
    p_expected_code, (p_event->>'requestId')::uuid,
    (p_event->>'occurredAt')::timestamp, p_event->'details',
    p_event->>'keyId', p_event->>'algorithm', p_event->>'signature'
  );
END
$$;

CREATE OR REPLACE FUNCTION platform.first_user_provisioning_provision(
  p_user_id uuid,
  p_membership_id uuid,
  p_operation_id uuid,
  p_tenant_id uuid,
  p_legal_entity_id uuid,
  p_station_id uuid,
  p_email text,
  p_display_name text,
  p_password_hash text,
  p_expires_at timestamptz,
  p_initiated_event jsonb,
  p_completed_event jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, platform, app, auth
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_permission_count integer;
  v_membership_count integer;
BEGIN
  PERFORM platform.first_user_provisioning_assert_runtime_role();

  IF p_email IS NULL OR p_email <> lower(btrim(p_email)) OR length(p_email) > 320
     OR p_display_name IS NULL OR length(btrim(p_display_name)) NOT BETWEEN 1 AND 160
     OR p_password_hash IS NULL OR length(btrim(p_password_hash)) = 0
     OR p_expires_at <= v_now OR p_expires_at > v_now + interval '2 hours'
  THEN
    RAISE EXCEPTION 'first-user provisioning input is invalid' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_email, 0));

  PERFORM 1 FROM app.tenants t
   WHERE t.id = p_tenant_id AND t.status = 'ACTIVE' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'selected tenant is missing or inactive' USING ERRCODE = '23503'; END IF;

  PERFORM 1 FROM app.legal_entities e
   WHERE e.id = p_legal_entity_id AND e.tenant_id = p_tenant_id AND e.status = 'ACTIVE' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'selected legal entity is outside the tenant or inactive' USING ERRCODE = '23503'; END IF;

  PERFORM 1 FROM app.stations s
   WHERE s.id = p_station_id AND s.tenant_id = p_tenant_id
     AND s.legal_entity_id = p_legal_entity_id AND s.status = 'ACTIVE' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'selected station is outside the legal entity or inactive' USING ERRCODE = '23503'; END IF;

  IF EXISTS (SELECT 1 FROM platform.first_user_provisioning_operations WHERE tenant_id = p_tenant_id) THEN
    RAISE EXCEPTION 'first-user bootstrap has already been consumed for this tenant' USING ERRCODE = '23505';
  END IF;

  SELECT count(*) INTO v_membership_count FROM app.memberships WHERE tenant_id = p_tenant_id;
  IF v_membership_count <> 0 THEN
    RAISE EXCEPTION 'selected tenant already has a membership; bootstrap is permanently closed' USING ERRCODE = '23505';
  END IF;

  SELECT count(*) INTO v_permission_count
    FROM platform.permission_definitions p
   WHERE p.code = ANY(ARRAY[
     'tenant.context.select', 'tenant.view', 'legal_entity.view',
     'station.view', 'business_day.view', 'shift.view',
     'supplier.view', 'supplier.creditor.review', 'inventory.view',
     'provider.settlement.view', 'cash.collection.view', 'cash.deposit.view'
   ]::text[]);
  IF v_permission_count <> 12 THEN
    RAISE EXCEPTION 'first-user provisioning read-only permission definitions are incomplete' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (SELECT 1 FROM auth."user" WHERE email = p_email)
     OR EXISTS (SELECT 1 FROM auth."user" WHERE id = p_user_id)
  THEN
    RAISE EXCEPTION 'first-user provisioning duplicate identity is refused' USING ERRCODE = '23505';
  END IF;

  PERFORM platform.first_user_provisioning_validate_event(
    p_initiated_event, 'ACCESS.PROVISIONING_INITIATED',
    p_tenant_id, p_membership_id, p_user_id, p_operation_id
  );
  PERFORM platform.first_user_provisioning_validate_event(
    p_completed_event, 'ACCESS.PROVISIONING_COMPLETED',
    p_tenant_id, p_membership_id, p_user_id, p_operation_id
  );

  INSERT INTO auth."user" (id, name, email, email_verified)
  VALUES (p_user_id, btrim(p_display_name), p_email, false);
  INSERT INTO auth.account (account_id, provider_id, user_id, password)
  VALUES (p_user_id::text, 'credential', p_user_id, p_password_hash);
  INSERT INTO app.memberships (id, tenant_id, identity_id, status)
  VALUES (p_membership_id, p_tenant_id, p_user_id, 'ACTIVE');

  -- This unique tenant sentinel is the durable, single-use bootstrap state.
  -- It remains after revoke and cannot be recreated by disabling membership or
  -- deleting/revoking temporary grants.
  INSERT INTO platform.first_user_provisioning_operations (
    operation_id, tenant_id, legal_entity_id, station_id,
    user_id, membership_id, email, status
  ) VALUES (
    p_operation_id, p_tenant_id, p_legal_entity_id, p_station_id,
    p_user_id, p_membership_id, p_email, 'PROVISIONED'
  );

  PERFORM platform.first_user_provisioning_insert_event(
    p_initiated_event, 'ACCESS.PROVISIONING_INITIATED',
    p_tenant_id, p_membership_id, p_user_id, p_operation_id
  );

  WITH inserted AS (
    INSERT INTO app.temporary_permission_grants (
      tenant_id, membership_id, permission_code, scope_type,
      legal_entity_id, station_id, expires_at, reason
    )
    SELECT p_tenant_id, p_membership_id, grant_row.permission_code,
      grant_row.scope_type, grant_row.legal_entity_id, grant_row.station_id,
      p_expires_at, 'first-production-user-provisioning:' || p_operation_id::text
      FROM (VALUES
        ('tenant.context.select', 'TENANT', NULL::uuid, NULL::uuid),
        ('tenant.view', 'TENANT', NULL::uuid, NULL::uuid),
        ('legal_entity.view', 'LEGAL_ENTITY', p_legal_entity_id, NULL::uuid),
        ('station.view', 'STATION', p_legal_entity_id, p_station_id),
        ('business_day.view', 'STATION', p_legal_entity_id, p_station_id),
        ('shift.view', 'STATION', p_legal_entity_id, p_station_id),
        ('supplier.view', 'LEGAL_ENTITY', p_legal_entity_id, NULL::uuid),
        ('supplier.creditor.review', 'LEGAL_ENTITY', p_legal_entity_id, NULL::uuid),
        ('inventory.view', 'STATION', p_legal_entity_id, p_station_id),
        ('provider.settlement.view', 'STATION', p_legal_entity_id, p_station_id),
        ('cash.collection.view', 'STATION', p_legal_entity_id, p_station_id),
        ('cash.deposit.view', 'STATION', p_legal_entity_id, p_station_id)
      ) AS grant_row(permission_code, scope_type, legal_entity_id, station_id)
    RETURNING id, tenant_id, permission_code, scope_type, legal_entity_id, station_id
  )
  INSERT INTO platform.first_user_provisioning_operation_grants (
    operation_id, tenant_id, grant_id, permission_code, scope_type,
    legal_entity_id, station_id
  )
  SELECT p_operation_id, tenant_id, id, permission_code, scope_type,
    legal_entity_id, station_id
  FROM inserted;

  PERFORM platform.first_user_provisioning_insert_event(
    p_completed_event, 'ACCESS.PROVISIONING_COMPLETED',
    p_tenant_id, p_membership_id, p_user_id, p_operation_id
  );

  RETURN jsonb_build_object(
    'operationId', p_operation_id::text, 'userId', p_user_id::text,
    'membershipId', p_membership_id::text, 'expiresAt', p_expires_at,
    'permissionCodes', ARRAY[
      'tenant.context.select', 'tenant.view', 'legal_entity.view',
      'station.view', 'business_day.view', 'shift.view',
      'supplier.view', 'supplier.creditor.review', 'inventory.view',
      'provider.settlement.view', 'cash.collection.view', 'cash.deposit.view'
    ]
  );
END
$$;

CREATE OR REPLACE FUNCTION platform.first_user_provisioning_revoke(
  p_user_id uuid,
  p_membership_id uuid,
  p_operation_id uuid,
  p_tenant_id uuid,
  p_legal_entity_id uuid,
  p_station_id uuid,
  p_event jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, platform, app, auth
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_operation platform.first_user_provisioning_operations%ROWTYPE;
  v_expected_count integer;
  v_matching_count integer;
  v_unrevoked_count integer;
  v_revoked_grant_count integer;
  v_revoked_session_count integer;
BEGIN
  PERFORM platform.first_user_provisioning_assert_runtime_role();

  PERFORM 1 FROM app.tenants t
   WHERE t.id = p_tenant_id AND t.status = 'ACTIVE' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'selected tenant is missing or inactive' USING ERRCODE = '23503'; END IF;
  PERFORM 1 FROM app.legal_entities e
   WHERE e.id = p_legal_entity_id AND e.tenant_id = p_tenant_id AND e.status = 'ACTIVE' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'selected legal entity is outside the tenant or inactive' USING ERRCODE = '23503'; END IF;
  PERFORM 1 FROM app.stations s
   WHERE s.id = p_station_id AND s.tenant_id = p_tenant_id
     AND s.legal_entity_id = p_legal_entity_id AND s.status = 'ACTIVE' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'selected station is outside the legal entity or inactive' USING ERRCODE = '23503'; END IF;

  SELECT * INTO v_operation
    FROM platform.first_user_provisioning_operations o
   WHERE o.operation_id = p_operation_id
     AND o.tenant_id = p_tenant_id
     AND o.legal_entity_id = p_legal_entity_id
     AND o.station_id = p_station_id
     AND o.user_id = p_user_id
     AND o.membership_id = p_membership_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'first-user provisioning operation does not match the requested target' USING ERRCODE = '22023';
  END IF;
  IF v_operation.status <> 'PROVISIONED' THEN
    RAISE EXCEPTION 'first-user provisioning operation has already been revoked' USING ERRCODE = '23505';
  END IF;

  PERFORM 1 FROM app.memberships m
   WHERE m.id = p_membership_id AND m.tenant_id = p_tenant_id
     AND m.identity_id = p_user_id AND m.status = 'ACTIVE' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'target membership is missing or not active' USING ERRCODE = '23514'; END IF;
  IF (SELECT count(*) FROM app.memberships WHERE identity_id = p_user_id) <> 1 THEN
    RAISE EXCEPTION 'cleanup refuses an identity with another membership' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM app.membership_role_assignments WHERE tenant_id = p_tenant_id AND membership_id = p_membership_id) THEN
    RAISE EXCEPTION 'cleanup refuses a membership with role assignments' USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO v_expected_count
    FROM platform.first_user_provisioning_operation_grants
   WHERE operation_id = p_operation_id;
  IF v_expected_count <> 12 THEN
    RAISE EXCEPTION 'cleanup refuses a tampered or incomplete operation grant record' USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO v_matching_count
    FROM platform.first_user_provisioning_operation_grants og
    JOIN app.temporary_permission_grants g
      ON g.tenant_id = og.tenant_id AND g.id = og.grant_id
   WHERE og.operation_id = p_operation_id
     AND og.tenant_id = p_tenant_id
     AND og.permission_code = g.permission_code
     AND og.scope_type = g.scope_type
     AND og.legal_entity_id IS NOT DISTINCT FROM g.legal_entity_id
     AND og.station_id IS NOT DISTINCT FROM g.station_id
     AND g.tenant_id = p_tenant_id
     AND g.membership_id = p_membership_id
     AND g.reason = 'first-production-user-provisioning:' || p_operation_id::text
     AND g.revoked_at IS NULL
     AND (
       (g.permission_code IN ('tenant.context.select', 'tenant.view')
        AND g.scope_type = 'TENANT' AND g.legal_entity_id IS NULL AND g.station_id IS NULL)
       OR (g.permission_code IN ('legal_entity.view', 'supplier.view', 'supplier.creditor.review')
        AND g.scope_type = 'LEGAL_ENTITY' AND g.legal_entity_id = p_legal_entity_id AND g.station_id IS NULL)
       OR (g.permission_code IN ('station.view', 'business_day.view', 'shift.view', 'inventory.view', 'provider.settlement.view', 'cash.collection.view', 'cash.deposit.view')
        AND g.scope_type = 'STATION' AND g.legal_entity_id = p_legal_entity_id AND g.station_id = p_station_id)
     );
  IF v_matching_count <> 12 THEN
    RAISE EXCEPTION 'cleanup refuses a tampered operation grant set' USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO v_unrevoked_count
    FROM app.temporary_permission_grants
   WHERE tenant_id = p_tenant_id AND membership_id = p_membership_id AND revoked_at IS NULL;
  IF v_unrevoked_count <> 12 THEN
    RAISE EXCEPTION 'cleanup refuses unrelated or missing unrevoked grants' USING ERRCODE = '23514';
  END IF;

  PERFORM platform.first_user_provisioning_validate_event(
    p_event, 'ACCESS.PROVISIONING_REVOKED',
    p_tenant_id, p_membership_id, p_user_id, p_operation_id
  );

  UPDATE app.temporary_permission_grants g
     SET revoked_at = v_now
    FROM platform.first_user_provisioning_operation_grants og
   WHERE og.operation_id = p_operation_id
     AND g.tenant_id = og.tenant_id AND g.id = og.grant_id
     AND g.revoked_at IS NULL;
  GET DIAGNOSTICS v_revoked_grant_count = ROW_COUNT;

  UPDATE auth.session
     SET revoked_at = coalesce(revoked_at, v_now), updated_at = v_now
   WHERE user_id = p_user_id AND revoked_at IS NULL;
  GET DIAGNOSTICS v_revoked_session_count = ROW_COUNT;

  PERFORM platform.first_user_provisioning_insert_event(
    p_event, 'ACCESS.PROVISIONING_REVOKED',
    p_tenant_id, p_membership_id, p_user_id, p_operation_id
  );

  UPDATE app.memberships
     SET status = 'DISABLED', disabled_at = coalesce(disabled_at, v_now), updated_at = v_now
   WHERE tenant_id = p_tenant_id AND id = p_membership_id
     AND identity_id = p_user_id AND status = 'ACTIVE';
  IF NOT FOUND THEN RAISE EXCEPTION 'target membership disappeared during cleanup' USING ERRCODE = '40001'; END IF;

  UPDATE platform.first_user_provisioning_operations
     SET status = 'REVOKED', revoked_at = v_now
   WHERE operation_id = p_operation_id AND status = 'PROVISIONED';
  IF NOT FOUND THEN RAISE EXCEPTION 'first-user provisioning operation disappeared during cleanup' USING ERRCODE = '40001'; END IF;

  RETURN jsonb_build_object(
    'operationId', p_operation_id::text, 'userId', p_user_id::text,
    'membershipId', p_membership_id::text,
    'revokedGrantCount', v_revoked_grant_count,
    'revokedSessionCount', v_revoked_session_count,
    'membershipDisabled', true
  );
END
$$;

CREATE OR REPLACE FUNCTION platform.first_user_provisioning_append_failure(
  p_tenant_id uuid,
  p_event jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, platform, app, auth
AS $$
BEGIN
  PERFORM platform.first_user_provisioning_assert_runtime_role();
  IF NOT EXISTS (SELECT 1 FROM app.tenants WHERE id = p_tenant_id AND status = 'ACTIVE') THEN
    RAISE EXCEPTION 'failure audit tenant is missing or inactive' USING ERRCODE = '23503';
  END IF;
  IF p_event IS NULL
     OR p_event->>'eventId' IS NULL
     OR p_event->>'eventCode' IS DISTINCT FROM 'ACCESS.PROVISIONING_FAILED'
     OR p_event->>'tenantId' IS DISTINCT FROM p_tenant_id::text
     OR p_event->>'membershipId' IS NOT NULL
     OR p_event->>'requestId' IS NULL
     OR p_event->>'occurredAt' IS NULL
     OR p_event->>'keyId' IS NULL
     OR p_event->>'algorithm' IS DISTINCT FROM 'hmac-sha256'
     OR p_event->>'signature' IS NULL
     OR p_event ? 'actorId'
     OR p_event->'details'->>'actorType' IS DISTINCT FROM 'SUPPORT'
     OR p_event->'details'->>'initiatedBy' IS DISTINCT FROM 'first-production-user-provisioning'
     OR p_event->'details'->>'subjectType' IS DISTINCT FROM 'access.provisioning.request'
     OR p_event->'details'->>'subjectId' NOT IN ('provision', 'revoke')
     OR lower(p_event::text) ~ '(password|secret|token|cookie)'
  THEN
    RAISE EXCEPTION 'first-user provisioning failure audit event is invalid' USING ERRCODE = '22023';
  END IF;
  INSERT INTO platform.security_events (
    id, tenant_id, membership_id, actor_id, event_code, request_id,
    occurred_at, details, key_id, algorithm, signature
  ) VALUES (
    (p_event->>'eventId')::uuid, p_tenant_id, NULL, NULL,
    'ACCESS.PROVISIONING_FAILED', (p_event->>'requestId')::uuid,
    (p_event->>'occurredAt')::timestamp, p_event->'details',
    p_event->>'keyId', p_event->>'algorithm', p_event->>'signature'
  );
END
$$;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'tenants', 'legal_entities', 'stations', 'memberships',
    'membership_role_assignments', 'temporary_permission_grants'
  ] LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY', table_name);
  END LOOP;
  ALTER TABLE platform.security_events ENABLE ROW LEVEL SECURITY;
  ALTER TABLE platform.security_events FORCE ROW LEVEL SECURITY;
END
$$;

DO $$
BEGIN
  ALTER FUNCTION platform.first_user_provisioning_assert_runtime_role() OWNER TO migration_owner;
  ALTER FUNCTION platform.first_user_provisioning_scope_options(uuid, uuid, uuid) OWNER TO migration_owner;
  ALTER FUNCTION platform.first_user_provisioning_identity(text, uuid) OWNER TO migration_owner;
  ALTER FUNCTION platform.first_user_provisioning_permission_definitions() OWNER TO migration_owner;
  ALTER FUNCTION platform.first_user_provisioning_grants(uuid, uuid, uuid) OWNER TO migration_owner;
  ALTER FUNCTION platform.first_user_provisioning_validate_event(jsonb, text, uuid, uuid, uuid, uuid) OWNER TO migration_owner;
  ALTER FUNCTION platform.first_user_provisioning_insert_event(jsonb, text, uuid, uuid, uuid, uuid) OWNER TO migration_owner;
  ALTER FUNCTION platform.first_user_provisioning_provision(uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, timestamptz, jsonb, jsonb) OWNER TO migration_owner;
  ALTER FUNCTION platform.first_user_provisioning_revoke(uuid, uuid, uuid, uuid, uuid, uuid, jsonb) OWNER TO migration_owner;
  ALTER FUNCTION platform.first_user_provisioning_append_failure(uuid, jsonb) OWNER TO migration_owner;
END
$$;

REVOKE ALL ON FUNCTION platform.first_user_provisioning_assert_runtime_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.first_user_provisioning_scope_options(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.first_user_provisioning_identity(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.first_user_provisioning_permission_definitions() FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.first_user_provisioning_grants(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.first_user_provisioning_validate_event(jsonb, text, uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.first_user_provisioning_insert_event(jsonb, text, uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.first_user_provisioning_provision(uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, timestamptz, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.first_user_provisioning_revoke(uuid, uuid, uuid, uuid, uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.first_user_provisioning_append_failure(uuid, jsonb) FROM PUBLIC;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO first_user_provisioner', current_database());
  GRANT USAGE ON SCHEMA platform TO first_user_provisioner;
  GRANT EXECUTE ON FUNCTION platform.first_user_provisioning_assert_runtime_role() TO first_user_provisioner;
  GRANT EXECUTE ON FUNCTION platform.first_user_provisioning_scope_options(uuid, uuid, uuid) TO first_user_provisioner;
  GRANT EXECUTE ON FUNCTION platform.first_user_provisioning_identity(text, uuid) TO first_user_provisioner;
  GRANT EXECUTE ON FUNCTION platform.first_user_provisioning_permission_definitions() TO first_user_provisioner;
  GRANT EXECUTE ON FUNCTION platform.first_user_provisioning_grants(uuid, uuid, uuid) TO first_user_provisioner;
  GRANT EXECUTE ON FUNCTION platform.first_user_provisioning_provision(uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, timestamptz, jsonb, jsonb) TO first_user_provisioner;
  GRANT EXECUTE ON FUNCTION platform.first_user_provisioning_revoke(uuid, uuid, uuid, uuid, uuid, uuid, jsonb) TO first_user_provisioner;
  GRANT EXECUTE ON FUNCTION platform.first_user_provisioning_append_failure(uuid, jsonb) TO first_user_provisioner;
END
$$;

-- Fail closed at migration time as well as at every API invocation.  Existing
-- role grants are inspected, never silently revoked.
SELECT platform.first_user_provisioning_assert_runtime_role();
