-- Dedicated first-owner bootstrap capability.
--
-- This is intentionally separate from the temporary read-only first-user
-- bootstrap.  It is a one-time, provisioner-only capability that creates the
-- canonical OWNER role at TENANT scope and records the exact four approved
-- stations. It is not a general role-assignment API.

ALTER TABLE platform.first_user_provisioning_operations
  ADD COLUMN bootstrap_mode text NOT NULL DEFAULT 'READ_ONLY',
  ADD COLUMN station_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[];

UPDATE platform.first_user_provisioning_operations
   SET station_ids = ARRAY[station_id]::uuid[]
 WHERE cardinality(station_ids) = 0;

ALTER TABLE platform.first_user_provisioning_operations
  ADD CONSTRAINT first_user_provisioning_operations_mode_ck
    CHECK (bootstrap_mode IN ('READ_ONLY', 'OWNER')),
  ADD CONSTRAINT first_user_provisioning_operations_station_ids_ck
    CHECK (cardinality(station_ids) >= 1);

CREATE OR REPLACE FUNCTION platform.first_user_provisioning_fill_station_ids()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, platform, app, auth
AS $$
BEGIN
  IF cardinality(NEW.station_ids) = 0 THEN
    NEW.station_ids := ARRAY[NEW.station_id]::uuid[];
  END IF;
  RETURN NEW;
END
$$;

ALTER FUNCTION platform.first_user_provisioning_fill_station_ids() OWNER TO migration_owner;
REVOKE ALL ON FUNCTION platform.first_user_provisioning_fill_station_ids() FROM PUBLIC;
CREATE TRIGGER first_user_provisioning_fill_station_ids
  BEFORE INSERT ON platform.first_user_provisioning_operations
  FOR EACH ROW EXECUTE FUNCTION platform.first_user_provisioning_fill_station_ids();

CREATE OR REPLACE FUNCTION platform.first_owner_provisioning_validate_scope(
  p_tenant_id uuid,
  p_legal_entity_id uuid,
  p_station_ids uuid[],
  p_email text,
  p_display_name text,
  p_lock boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, platform, app, auth
AS $$
DECLARE
  v_station_id uuid;
  v_station_count integer;
  v_duplicate_count integer;
  v_membership_count integer;
  v_tenant_name text;
  v_entity_name text;
  v_stations jsonb;
  v_expected_station_ids constant uuid[] := ARRAY[
    'd8913b4d-7bb8-48cb-bb46-a741cea1f6c5'::uuid,
    'c4954604-2bcb-4e59-96e9-12e35449545c'::uuid,
    'ae3bf2a5-7ff0-42a3-832c-ae8f49a14b9f'::uuid,
    '68ef219f-6baa-442a-8465-6d52e505d1f3'::uuid
  ];
  v_expected_tenant_id constant uuid := 'a8852b9f-c490-4a72-a3f3-8662aeb14a8a';
  v_expected_entity_id constant uuid := 'cb5789ea-0979-450e-83d1-9834135cbedf';
BEGIN
  PERFORM platform.first_user_provisioning_assert_runtime_role();

  IF p_tenant_id IS DISTINCT FROM v_expected_tenant_id
     OR p_legal_entity_id IS DISTINCT FROM v_expected_entity_id
     OR p_station_ids IS NULL
     OR cardinality(p_station_ids) <> cardinality(v_expected_station_ids)
     OR EXISTS (
       SELECT 1 FROM unnest(p_station_ids) supplied
       WHERE supplied <> ALL(v_expected_station_ids)
     )
     OR EXISTS (
       SELECT 1 FROM unnest(v_expected_station_ids) expected
       WHERE expected <> ALL(p_station_ids)
     )
     OR p_email IS DISTINCT FROM 'hrshanda56@gmail.com'
     OR p_display_name IS DISTINCT FROM 'Shanda Admin'
  THEN
    RAISE EXCEPTION 'first-owner provisioning target is not the approved fixed scope'
      USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_duplicate_count
    FROM unnest(p_station_ids) station_id
   GROUP BY station_id
  HAVING count(*) > 1;
  IF v_duplicate_count > 0 THEN
    RAISE EXCEPTION 'first-owner provisioning requires four distinct stations' USING ERRCODE = '22023';
  END IF;

  IF p_lock THEN
    PERFORM 1 FROM app.tenants
     WHERE id = v_expected_tenant_id AND status = 'ACTIVE'
     FOR UPDATE;
  END IF;
  SELECT t.name INTO v_tenant_name
    FROM app.tenants t
   WHERE t.id = v_expected_tenant_id
     AND t.name = 'T.E.I Oils'
     AND t.status = 'ACTIVE';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'approved OWNER bootstrap tenant is missing or unexpected'
      USING ERRCODE = '23503';
  END IF;

  IF p_lock THEN
    PERFORM 1 FROM app.legal_entities
     WHERE id = v_expected_entity_id
       AND tenant_id = v_expected_tenant_id
       AND status = 'ACTIVE'
     FOR UPDATE;
  END IF;
  SELECT e.legal_name INTO v_entity_name
    FROM app.legal_entities e
   WHERE e.id = v_expected_entity_id
     AND e.tenant_id = v_expected_tenant_id
     AND e.legal_name = 'Triumph Energy'
     AND e.status = 'ACTIVE';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'approved OWNER bootstrap legal entity is missing or unexpected'
      USING ERRCODE = '23503';
  END IF;

  IF p_lock THEN
    FOR v_station_id IN
      SELECT s.id
        FROM app.stations s
       WHERE s.tenant_id = v_expected_tenant_id
         AND s.legal_entity_id = v_expected_entity_id
         AND s.id = ANY(v_expected_station_ids)
         AND s.status IN ('ONBOARDING', 'ACTIVE')
       FOR UPDATE
    LOOP
      NULL;
    END LOOP;
  END IF;

  SELECT count(*) INTO v_station_count
    FROM (VALUES
      ('d8913b4d-7bb8-48cb-bb46-a741cea1f6c5'::uuid, 'Bindura'),
      ('c4954604-2bcb-4e59-96e9-12e35449545c'::uuid, 'Maruta'),
      ('ae3bf2a5-7ff0-42a3-832c-ae8f49a14b9f'::uuid, 'Arcturus'),
      ('68ef219f-6baa-442a-8465-6d52e505d1f3'::uuid, 'Gazebo')
    ) expected(id, name)
    JOIN app.stations s
      ON s.id = expected.id
     AND s.tenant_id = v_expected_tenant_id
     AND s.legal_entity_id = v_expected_entity_id
     AND s.name = expected.name
     AND s.timezone = 'Africa/Harare'
     AND s.status IN ('ONBOARDING', 'ACTIVE');
  IF v_station_count <> 4 THEN
    RAISE EXCEPTION 'approved OWNER bootstrap requires exactly the four expected stations'
      USING ERRCODE = '23503';
  END IF;

  IF EXISTS (
    SELECT 1 FROM platform.first_user_provisioning_operations
     WHERE tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'first-user bootstrap has already been consumed for this tenant' USING ERRCODE = '23505';
  END IF;

  SELECT count(*) INTO v_membership_count
    FROM app.memberships m
   WHERE m.tenant_id = p_tenant_id;
  IF v_membership_count <> 0 THEN
    RAISE EXCEPTION 'selected tenant already has a membership; first-owner bootstrap is permanently closed' USING ERRCODE = '23505';
  END IF;

  IF EXISTS (SELECT 1 FROM auth."user" WHERE email = p_email) THEN
    RAISE EXCEPTION 'an identity already exists for the approved owner email' USING ERRCODE = '23505';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM platform.role_definitions WHERE code = 'OWNER') THEN
    RAISE EXCEPTION 'canonical OWNER role definition is missing' USING ERRCODE = '23514';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', s.id::text,
    'tenantId', s.tenant_id::text,
    'legalEntityId', s.legal_entity_id::text,
    'code', s.code,
    'name', s.name,
    'status', s.status
  ) ORDER BY array_position(v_expected_station_ids, s.id)), '[]'::jsonb)
    INTO v_stations
    FROM app.stations s
   WHERE s.tenant_id = v_expected_tenant_id
     AND s.legal_entity_id = v_expected_entity_id
     AND s.id = ANY(v_expected_station_ids);

  RETURN jsonb_build_object(
    'tenantId', v_expected_tenant_id::text,
    'tenantName', v_tenant_name,
    'legalEntityId', v_expected_entity_id::text,
    'legalEntityName', v_entity_name,
    'stationIds', to_jsonb(v_expected_station_ids),
    'stations', v_stations,
    'email', p_email,
    'displayName', btrim(p_display_name),
    'roleCode', 'OWNER',
    'scopeType', 'TENANT',
    'writes', jsonb_build_object(
      'authUser', 1,
      'credentialAccount', 1,
      'membership', 1,
      'ownerRoleAssignment', 1,
      'bootstrapOperation', 1,
      'auditEvents', 2
    )
  );
END
$$;

CREATE OR REPLACE FUNCTION platform.first_owner_provisioning_plan(
  p_tenant_id uuid,
  p_legal_entity_id uuid,
  p_station_ids uuid[],
  p_email text,
  p_display_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, platform, app, auth
AS $$
BEGIN
  RETURN platform.first_owner_provisioning_validate_scope(
    p_tenant_id, p_legal_entity_id, p_station_ids, p_email, p_display_name, false
  );
END
$$;

CREATE OR REPLACE FUNCTION platform.first_owner_provisioning_validate_event(
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
     OR p_event->'details'->>'initiatedBy' IS DISTINCT FROM 'first-production-owner-provisioning'
     OR p_event->'details'->>'subjectType' IS DISTINCT FROM 'auth.user'
     OR p_event->'details'->>'subjectId' IS DISTINCT FROM p_subject_id::text
     OR p_event->'details'->'metadata'->>'operationId' IS DISTINCT FROM p_operation_id::text
     OR p_event->'details'->'metadata'->>'legalEntityId' IS DISTINCT FROM
        'cb5789ea-0979-450e-83d1-9834135cbedf'
     OR p_event->'details'->'metadata'->>'roleCode' IS DISTINCT FROM 'OWNER'
     OR p_event->'details'->'metadata'->>'scopeType' IS DISTINCT FROM 'TENANT'
     OR p_event->'details'->'metadata'->'stationIds' IS DISTINCT FROM to_jsonb(ARRAY[
        'd8913b4d-7bb8-48cb-bb46-a741cea1f6c5'::uuid,
        'c4954604-2bcb-4e59-96e9-12e35449545c'::uuid,
        'ae3bf2a5-7ff0-42a3-832c-ae8f49a14b9f'::uuid,
        '68ef219f-6baa-442a-8465-6d52e505d1f3'::uuid
      ])
     OR p_event ? 'actorId'
     OR lower(p_event::text) ~ '(password|secret|token|cookie)'
  THEN
    RAISE EXCEPTION 'first-owner provisioning audit event is invalid' USING ERRCODE = '22023';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION platform.first_owner_provisioning_insert_event(
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
  PERFORM platform.first_owner_provisioning_validate_event(
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

CREATE OR REPLACE FUNCTION platform.first_owner_provisioning_provision(
  p_user_id uuid,
  p_membership_id uuid,
  p_operation_id uuid,
  p_tenant_id uuid,
  p_legal_entity_id uuid,
  p_station_ids uuid[],
  p_email text,
  p_display_name text,
  p_password_hash text,
  p_initiated_event jsonb,
  p_completed_event jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, platform, app, auth
AS $$
DECLARE
  v_scope jsonb;
  v_now timestamptz := clock_timestamp();
BEGIN
  PERFORM platform.first_user_provisioning_assert_runtime_role();
  IF p_user_id IS NULL OR p_membership_id IS NULL OR p_operation_id IS NULL
     OR p_password_hash IS NULL OR length(btrim(p_password_hash)) = 0
  THEN
    RAISE EXCEPTION 'first-owner provisioning input is invalid' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(lower(btrim(p_email)), 0));
  v_scope := platform.first_owner_provisioning_validate_scope(
    p_tenant_id, p_legal_entity_id, p_station_ids, p_email, p_display_name, true
  );

  IF EXISTS (SELECT 1 FROM auth."user" WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'first-owner provisioning duplicate identity is refused' USING ERRCODE = '23505';
  END IF;
  PERFORM platform.first_owner_provisioning_validate_event(
    p_initiated_event, 'ACCESS.PROVISIONING_INITIATED',
    p_tenant_id, p_membership_id, p_user_id, p_operation_id
  );
  PERFORM platform.first_owner_provisioning_validate_event(
    p_completed_event, 'ACCESS.PROVISIONING_COMPLETED',
    p_tenant_id, p_membership_id, p_user_id, p_operation_id
  );

  INSERT INTO auth."user" (id, name, email, email_verified)
  VALUES (p_user_id, btrim(p_display_name), lower(btrim(p_email)), false);
  INSERT INTO auth.account (account_id, provider_id, user_id, password)
  VALUES (p_user_id::text, 'credential', p_user_id, p_password_hash);
  INSERT INTO app.memberships (id, tenant_id, identity_id, status)
  VALUES (p_membership_id, p_tenant_id, p_user_id, 'ACTIVE');
  INSERT INTO app.membership_role_assignments (
    id, tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id, expires_at
  ) VALUES (
    gen_random_uuid(), p_tenant_id, p_membership_id, 'OWNER', 'TENANT', NULL, NULL, NULL
  );
  INSERT INTO platform.first_user_provisioning_operations (
    operation_id, tenant_id, legal_entity_id, station_id, station_ids,
    user_id, membership_id, email, bootstrap_mode, status
  ) VALUES (
    p_operation_id, p_tenant_id, p_legal_entity_id, p_station_ids[1], p_station_ids,
    p_user_id, p_membership_id, lower(btrim(p_email)), 'OWNER', 'PROVISIONED'
  );

  PERFORM platform.first_owner_provisioning_insert_event(
    p_initiated_event, 'ACCESS.PROVISIONING_INITIATED',
    p_tenant_id, p_membership_id, p_user_id, p_operation_id
  );
  PERFORM platform.first_owner_provisioning_insert_event(
    p_completed_event, 'ACCESS.PROVISIONING_COMPLETED',
    p_tenant_id, p_membership_id, p_user_id, p_operation_id
  );

  RETURN v_scope || jsonb_build_object(
    'status', 'provisioned',
    'operationId', p_operation_id::text,
    'userId', p_user_id::text,
    'membershipId', p_membership_id::text,
    'roleCode', 'OWNER',
    'scopeType', 'TENANT',
    'createdAt', v_now
  );
END
$$;

CREATE OR REPLACE FUNCTION platform.first_owner_provisioning_append_failure(
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
  IF p_tenant_id IS DISTINCT FROM 'a8852b9f-c490-4a72-a3f3-8662aeb14a8a'::uuid
     OR NOT EXISTS (
       SELECT 1 FROM app.tenants
       WHERE id = 'a8852b9f-c490-4a72-a3f3-8662aeb14a8a'::uuid
         AND name = 'T.E.I Oils'
         AND status = 'ACTIVE'
     )
  THEN
    RAISE EXCEPTION 'failure audit tenant is outside the approved OWNER bootstrap scope'
      USING ERRCODE = '23503';
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
     OR p_event->'details'->>'initiatedBy' IS DISTINCT FROM 'first-production-owner-provisioning'
     OR p_event->'details'->>'subjectType' IS DISTINCT FROM 'access.first_owner_provisioning.request'
     OR p_event->'details'->>'subjectId' IS DISTINCT FROM 'provision'
     OR p_event->'details'->'metadata'->>'legalEntityId' IS DISTINCT FROM
        'cb5789ea-0979-450e-83d1-9834135cbedf'
     OR p_event->'details'->'metadata'->>'roleCode' IS DISTINCT FROM 'OWNER'
     OR p_event->'details'->'metadata'->>'scopeType' IS DISTINCT FROM 'TENANT'
     OR p_event->'details'->'metadata'->'stationIds' IS DISTINCT FROM to_jsonb(ARRAY[
        'd8913b4d-7bb8-48cb-bb46-a741cea1f6c5'::uuid,
        'c4954604-2bcb-4e59-96e9-12e35449545c'::uuid,
        'ae3bf2a5-7ff0-42a3-832c-ae8f49a14b9f'::uuid,
        '68ef219f-6baa-442a-8465-6d52e505d1f3'::uuid
      ])
     OR lower(p_event::text) ~ '(password|secret|token|cookie)'
  THEN
    RAISE EXCEPTION 'first-owner provisioning failure audit event is invalid' USING ERRCODE = '22023';
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

-- Replace the existing exact privilege allowlist with the same allowlist plus
-- the three dedicated first-owner API functions. No other function becomes
-- callable by first_user_provisioner.
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
  IF v_role IS NULL THEN RAISE EXCEPTION 'first_user_provisioner role is missing' USING ERRCODE = '42501'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE oid = v_role
      AND (NOT rolcanlogin OR rolsuper OR rolbypassrls OR rolcreaterole
        OR rolcreatedb OR rolinherit OR rolreplication OR rolconfig IS NOT NULL)
  ) THEN RAISE EXCEPTION 'first_user_provisioner role attributes are unsafe' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM pg_database WHERE datname = current_database() AND datdba = v_role)
     OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspowner = v_role)
     OR EXISTS (SELECT 1 FROM pg_class WHERE relowner = v_role)
     OR EXISTS (SELECT 1 FROM pg_auth_members WHERE member = v_role)
  THEN RAISE EXCEPTION 'first_user_provisioner has an unsafe owner or role membership' USING ERRCODE = '42501'; END IF;
  IF has_database_privilege('first_user_provisioner', current_database(), 'CREATE')
     OR has_schema_privilege('first_user_provisioner', 'app', 'CREATE')
     OR has_schema_privilege('first_user_provisioner', 'auth', 'CREATE')
     OR has_schema_privilege('first_user_provisioner', 'platform', 'CREATE')
     OR has_schema_privilege('first_user_provisioner', 'app', 'USAGE')
     OR has_schema_privilege('first_user_provisioner', 'auth', 'USAGE')
     OR NOT has_schema_privilege('first_user_provisioner', 'platform', 'USAGE')
  THEN RAISE EXCEPTION 'first_user_provisioner has an unsafe database or schema privilege' USING ERRCODE = '42501'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
    WHERE n.nspname IN ('app', 'auth', 'platform') AND acl.grantee = v_role
  ) THEN RAISE EXCEPTION 'first_user_provisioner has an unexpected direct table privilege' USING ERRCODE = '42501'; END IF;

  v_expected_functions := ARRAY[
    'platform.first_user_provisioning_assert_runtime_role()'::regprocedure::oid,
    'platform.first_user_provisioning_scope_options(uuid,uuid,uuid)'::regprocedure::oid,
    'platform.first_user_provisioning_identity(text,uuid)'::regprocedure::oid,
    'platform.first_user_provisioning_permission_definitions()'::regprocedure::oid,
    'platform.first_user_provisioning_grants(uuid,uuid,uuid)'::regprocedure::oid,
    'platform.first_user_provisioning_provision(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,timestamptz,jsonb,jsonb)'::regprocedure::oid,
    'platform.first_user_provisioning_revoke(uuid,uuid,uuid,uuid,uuid,uuid,jsonb)'::regprocedure::oid,
    'platform.first_user_provisioning_append_failure(uuid,jsonb)'::regprocedure::oid,
    'platform.first_owner_provisioning_plan(uuid,uuid,uuid[],text,text)'::regprocedure::oid,
    'platform.first_owner_provisioning_provision(uuid,uuid,uuid,uuid,uuid,uuid[],text,text,text,jsonb,jsonb)'::regprocedure::oid,
    'platform.first_owner_provisioning_append_failure(uuid,jsonb)'::regprocedure::oid
  ];
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    WHERE n.nspname IN ('app', 'auth', 'platform')
      AND acl.grantee = v_role AND p.oid <> ALL(v_expected_functions)
  ) OR EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'platform' AND p.oid <> ALL(v_expected_functions)
      AND has_function_privilege('first_user_provisioner', p.oid, 'EXECUTE')
  ) THEN RAISE EXCEPTION 'first_user_provisioner has an unexpected function EXECUTE privilege' USING ERRCODE = '42501'; END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(v_expected_functions) expected(function_oid)
    WHERE NOT has_function_privilege('first_user_provisioner', expected.function_oid, 'EXECUTE')
  ) THEN RAISE EXCEPTION 'first_user_provisioner is missing a required function EXECUTE privilege' USING ERRCODE = '42501'; END IF;
END
$$;

DO $$
BEGIN
  ALTER FUNCTION platform.first_owner_provisioning_validate_scope(uuid, uuid, uuid[], text, text, boolean) OWNER TO migration_owner;
  ALTER FUNCTION platform.first_owner_provisioning_plan(uuid, uuid, uuid[], text, text) OWNER TO migration_owner;
  ALTER FUNCTION platform.first_owner_provisioning_validate_event(jsonb, text, uuid, uuid, uuid, uuid) OWNER TO migration_owner;
  ALTER FUNCTION platform.first_owner_provisioning_insert_event(jsonb, text, uuid, uuid, uuid, uuid) OWNER TO migration_owner;
  ALTER FUNCTION platform.first_owner_provisioning_provision(uuid, uuid, uuid, uuid, uuid, uuid[], text, text, text, jsonb, jsonb) OWNER TO migration_owner;
  ALTER FUNCTION platform.first_owner_provisioning_append_failure(uuid, jsonb) OWNER TO migration_owner;
  ALTER FUNCTION platform.first_user_provisioning_assert_runtime_role() OWNER TO migration_owner;
END
$$;

REVOKE ALL ON FUNCTION platform.first_owner_provisioning_validate_scope(uuid, uuid, uuid[], text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.first_owner_provisioning_plan(uuid, uuid, uuid[], text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.first_owner_provisioning_validate_event(jsonb, text, uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.first_owner_provisioning_insert_event(jsonb, text, uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.first_owner_provisioning_provision(uuid, uuid, uuid, uuid, uuid, uuid[], text, text, text, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.first_owner_provisioning_append_failure(uuid, jsonb) FROM PUBLIC;

DO $$
BEGIN
  GRANT EXECUTE ON FUNCTION platform.first_owner_provisioning_plan(uuid, uuid, uuid[], text, text) TO first_user_provisioner;
  GRANT EXECUTE ON FUNCTION platform.first_owner_provisioning_provision(uuid, uuid, uuid, uuid, uuid, uuid[], text, text, text, jsonb, jsonb) TO first_user_provisioner;
  GRANT EXECUTE ON FUNCTION platform.first_owner_provisioning_append_failure(uuid, jsonb) TO first_user_provisioner;
END
$$;

SELECT platform.first_user_provisioning_assert_runtime_role();
