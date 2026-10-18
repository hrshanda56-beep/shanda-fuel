-- Clerk-only identity cutover. Run atomically with the application release.
-- ALTER TABLE preserves relation OIDs, every internal UUID, and all inbound FKs.
-- Disposable development credentials are removed; business UUIDs stay intact.
ALTER TABLE auth."user" SET SCHEMA app;
ALTER TABLE app."user" RENAME TO users;
--> statement-breakpoint

-- Identity deletion is not an ordinary runtime command. In particular, it
-- must not cascade into archived credential evidence.
REVOKE DELETE, TRUNCATE, TRIGGER, REFERENCES ON app.users FROM app_runtime;
--> statement-breakpoint

-- Parameter names change, but the capability signatures/allowlist stay exact.
-- RESTRICT refuses unexpected catalog-tracked dependents; never use CASCADE.
DROP FUNCTION platform.first_user_provisioning_provision(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,timestamptz,jsonb,jsonb) RESTRICT;
DROP FUNCTION platform.first_owner_provisioning_provision(uuid,uuid,uuid,uuid,uuid,uuid[],text,text,text,jsonb,jsonb) RESTRICT;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION platform.first_user_provisioning_identity(
  p_email text,
  p_tenant_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, platform, app
AS $$
DECLARE
  v_user app.users%ROWTYPE;
  v_provider_identities jsonb;
  v_memberships jsonb;
BEGIN
  PERFORM platform.first_user_provisioning_assert_runtime_role();
  IF p_email IS NULL OR p_email <> lower(btrim(p_email)) OR length(p_email) > 320 THEN
    RAISE EXCEPTION 'first-user provisioning email is invalid' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_user FROM app.users u WHERE u.email = p_email LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'provider', a.provider, 'providerUserId', a.provider_user_id
  ) ORDER BY a.id), '[]'::jsonb)
    INTO v_provider_identities
    FROM app.auth_identities a WHERE a.internal_user_id = v_user.id AND a.provider = 'CLERK';

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
    'providerIdentities', v_provider_identities, 'memberships', v_memberships
  );
END
$$;
--> statement-breakpoint

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
SET search_path = pg_catalog, platform, app
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
     OR p_event->'details'->>'subjectType' IS DISTINCT FROM 'app.users'
     OR p_event->'details'->>'subjectId' IS DISTINCT FROM p_subject_id::text
     OR p_event->'details'->'metadata'->>'operationId' IS DISTINCT FROM p_operation_id::text
     OR p_event ? 'actorId'
     OR lower(p_event::text) ~ '(password|secret|token|cookie)'
  THEN
    RAISE EXCEPTION 'first-user provisioning audit event is invalid' USING ERRCODE = '22023';
  END IF;
END
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION platform.first_user_provisioning_provision(
  p_user_id uuid,
  p_membership_id uuid,
  p_operation_id uuid,
  p_tenant_id uuid,
  p_legal_entity_id uuid,
  p_station_id uuid,
  p_email text,
  p_display_name text,
  p_clerk_user_id text,
  p_expires_at timestamptz,
  p_initiated_event jsonb,
  p_completed_event jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, platform, app
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_permission_count integer;
  v_membership_count integer;
BEGIN
  PERFORM platform.first_user_provisioning_assert_runtime_role();

  IF p_email IS NULL OR p_email <> lower(btrim(p_email)) OR length(p_email) > 320
     OR p_display_name IS NULL OR length(btrim(p_display_name)) NOT BETWEEN 1 AND 160
     OR p_clerk_user_id IS NULL OR p_clerk_user_id !~ '^user_[a-zA-Z0-9]+$'
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

  IF EXISTS (SELECT 1 FROM app.users WHERE email = p_email)
     OR EXISTS (SELECT 1 FROM app.users WHERE id = p_user_id)
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

  INSERT INTO app.users (id, name, email, email_verified)
  VALUES (p_user_id, btrim(p_display_name), p_email, false);
  INSERT INTO app.auth_identities (internal_user_id, provider, provider_user_id)
  VALUES (p_user_id, 'CLERK', p_clerk_user_id);
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
--> statement-breakpoint

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
SET search_path = pg_catalog, platform, app
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_operation platform.first_user_provisioning_operations%ROWTYPE;
  v_expected_count integer;
  v_matching_count integer;
  v_unrevoked_count integer;
  v_revoked_grant_count integer;
  v_revoked_assurance_count integer;
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

  -- Local assurance is revoked; disabling membership below immediately denies
  -- tenant access. Provider sessions are owned by Clerk, not this SQL capability.
  UPDATE app.auth_session_assurance
     SET revoked_at = coalesce(revoked_at, v_now), updated_at = v_now
   WHERE internal_user_id = p_user_id AND tenant_id = p_tenant_id
     AND revoked_at IS NULL;
  GET DIAGNOSTICS v_revoked_assurance_count = ROW_COUNT;

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
    'revokedAssuranceCount', v_revoked_assurance_count,
    'membershipDisabled', true
  );
END
$$;
--> statement-breakpoint

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
SET search_path = pg_catalog, platform, app
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
       WHERE supplied IS NULL
     )
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

  IF EXISTS (SELECT 1 FROM app.users WHERE email = p_email) THEN
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
      'appUser', 1,
      'clerkIdentity', 1,
      'membership', 1,
      'ownerRoleAssignment', 1,
      'bootstrapOperation', 1,
      'auditEvents', 2
    )
  );
END
$$;
--> statement-breakpoint

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
SET search_path = pg_catalog, platform, app
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
     OR p_event->'details'->>'subjectType' IS DISTINCT FROM 'app.users'
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
--> statement-breakpoint

CREATE OR REPLACE FUNCTION platform.first_owner_provisioning_provision(
  p_user_id uuid,
  p_membership_id uuid,
  p_operation_id uuid,
  p_tenant_id uuid,
  p_legal_entity_id uuid,
  p_station_ids uuid[],
  p_email text,
  p_display_name text,
  p_clerk_user_id text,
  p_initiated_event jsonb,
  p_completed_event jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, platform, app
AS $$
DECLARE
  v_scope jsonb;
  v_now timestamptz := clock_timestamp();
BEGIN
  PERFORM platform.first_user_provisioning_assert_runtime_role();
  IF p_user_id IS NULL OR p_membership_id IS NULL OR p_operation_id IS NULL
     OR p_clerk_user_id IS NULL OR p_clerk_user_id !~ '^user_[a-zA-Z0-9]+$'
  THEN
    RAISE EXCEPTION 'first-owner provisioning input is invalid' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(lower(btrim(p_email)), 0));
  v_scope := platform.first_owner_provisioning_validate_scope(
    p_tenant_id, p_legal_entity_id, p_station_ids, p_email, p_display_name, true
  );

  IF EXISTS (SELECT 1 FROM app.users WHERE id = p_user_id) THEN
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

  INSERT INTO app.users (id, name, email, email_verified)
  VALUES (p_user_id, btrim(p_display_name), lower(btrim(p_email)), false);
  INSERT INTO app.auth_identities (internal_user_id, provider, provider_user_id)
  VALUES (p_user_id, 'CLERK', p_clerk_user_id);
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
    'stationCount', cardinality(p_station_ids),
    'createdAt', v_now
  );
END
$$;
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
SET search_path = pg_catalog, app
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
           FROM app.users identity
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
SET search_path = pg_catalog, app, platform
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
  FROM app.users
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

CREATE OR REPLACE FUNCTION app.resolve_auth_identity(
  p_provider text,
  p_provider_user_id text
)
RETURNS TABLE (internal_user_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, platform
AS $$
BEGIN
  IF p_provider IS DISTINCT FROM 'CLERK'
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
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.resolve_provider_identity(
  p_provider text,
  p_internal_user_id uuid
)
RETURNS TABLE (provider_user_id text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, app, platform
AS $$
BEGIN
  IF p_provider IS DISTINCT FROM 'CLERK' OR p_internal_user_id IS NULL THEN
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
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.resolve_provider_identity_for_membership(
  p_provider text,
  p_tenant_id uuid,
  p_membership_id uuid
)
RETURNS TABLE (provider_user_id text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, app, platform
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
--> statement-breakpoint

ALTER FUNCTION platform.first_user_provisioning_provision(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,timestamptz,jsonb,jsonb) OWNER TO migration_owner;
REVOKE ALL ON FUNCTION platform.first_user_provisioning_provision(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,timestamptz,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.first_user_provisioning_provision(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,timestamptz,jsonb,jsonb) TO first_user_provisioner;
ALTER FUNCTION platform.first_owner_provisioning_provision(uuid,uuid,uuid,uuid,uuid,uuid[],text,text,text,jsonb,jsonb) OWNER TO migration_owner;
REVOKE ALL ON FUNCTION platform.first_owner_provisioning_provision(uuid,uuid,uuid,uuid,uuid,uuid[],text,text,text,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.first_owner_provisioning_provision(uuid,uuid,uuid,uuid,uuid,uuid[],text,text,text,jsonb,jsonb) TO first_user_provisioner;
--> statement-breakpoint

-- Inspect both parsed dependencies and PL/pgSQL source strings before retiring
-- the old namespace. Unexpected live consumers must be reviewed, not cascaded.
DO $$
DECLARE
  dependency text;
BEGIN
  SELECT p.oid::regprocedure::text INTO dependency
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname IN ('app', 'platform')
    AND p.prosrc ~ 'auth[.]"?(user|account|session|verification|two_factor)"?'
  LIMIT 1;
  IF dependency IS NOT NULL THEN
    RAISE EXCEPTION 'legacy authentication function dependency requires review: %', dependency;
  END IF;
  SELECT pg_describe_object(d.classid, d.objid, d.objsubid) INTO dependency
  FROM pg_depend d
  JOIN pg_class c ON c.oid = d.refobjid AND d.refclassid = 'pg_class'::regclass
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'auth'
    AND c.relname IN ('account', 'session', 'verification', 'two_factor')
    AND d.deptype = 'n'
    -- Table-local defaults/constraints/indexes move with their table.
    AND d.classid NOT IN ('pg_attrdef'::regclass, 'pg_constraint'::regclass, 'pg_class'::regclass)
  LIMIT 1;
  IF dependency IS NOT NULL THEN
    RAISE EXCEPTION 'legacy authentication catalog dependency requires review: %', dependency;
  END IF;
  SELECT constraint_row.conname INTO dependency
  FROM pg_constraint constraint_row
  JOIN pg_class target ON target.oid = constraint_row.confrelid
  JOIN pg_namespace target_namespace ON target_namespace.oid = target.relnamespace
  JOIN pg_class source ON source.oid = constraint_row.conrelid
  JOIN pg_namespace source_namespace ON source_namespace.oid = source.relnamespace
  WHERE constraint_row.contype = 'f'
    AND target_namespace.nspname = 'auth'
    AND target.relname IN ('account', 'session', 'verification', 'two_factor')
    AND (source_namespace.nspname <> 'auth'
      OR source.relname NOT IN ('account', 'session', 'verification', 'two_factor'))
  LIMIT 1;
  IF dependency IS NOT NULL THEN
    RAISE EXCEPTION 'live foreign key into legacy credentials requires review: %', dependency;
  END IF;
END
$$;
--> statement-breakpoint

-- Development credentials are disposable; remove unused local authentication
-- storage without CASCADE so unexpected dependents fail the migration.
DROP TABLE auth.two_factor;
DROP TABLE auth.account;
DROP TABLE auth.session;
DROP TABLE auth.verification;
--> statement-breakpoint

DELETE FROM app.auth_session_assurance WHERE provider <> 'CLERK';
DELETE FROM app.auth_identities WHERE provider <> 'CLERK';
ALTER TABLE app.auth_identities DROP CONSTRAINT auth_identities_provider_ck;
ALTER TABLE app.auth_identities ADD CONSTRAINT auth_identities_provider_ck CHECK (provider = 'CLERK');
ALTER TABLE app.auth_session_assurance DROP CONSTRAINT auth_session_assurance_provider_ck;
ALTER TABLE app.auth_session_assurance ADD CONSTRAINT auth_session_assurance_provider_ck CHECK (provider = 'CLERK');
ALTER TABLE app.users DROP COLUMN two_factor_enabled;
--> statement-breakpoint

ALTER TABLE app.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.users FORCE ROW LEVEL SECURITY;
CREATE POLICY users_security_definer ON app.users TO migration_owner
  USING (current_user = 'migration_owner') WITH CHECK (current_user = 'migration_owner');
CREATE POLICY users_directory_read ON app.users FOR SELECT TO app_runtime
  USING (id = app.current_actor_id() OR (
    app.has_active_membership() AND EXISTS (
      SELECT 1 FROM app.memberships m
      WHERE m.identity_id = users.id AND m.tenant_id = app.current_tenant_id()
    )
  ));
REVOKE INSERT, UPDATE, DELETE ON app.users FROM app_runtime;
--> statement-breakpoint

CREATE FUNCTION app.register_invited_clerk_identity(p_token_hash text, p_user_id uuid, p_clerk_user_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, app, platform
AS $$
DECLARE invitation app.staff_invitations%ROWTYPE;
BEGIN
  IF p_clerk_user_id IS NULL OR p_clerk_user_id !~ '^user_[a-zA-Z0-9]+$' OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'invalid identity' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('app.invitation_token_hash', p_token_hash, true);
  SELECT * INTO invitation FROM app.staff_invitations
    WHERE token_hash = p_token_hash AND delivery_method = 'EMAIL'
      AND status = 'PENDING' AND expires_at > clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invitation unavailable' USING ERRCODE = 'P0001'; END IF;
  INSERT INTO app.users (id, name, email, email_verified)
    VALUES (p_user_id, invitation.invited_name, invitation.invited_email, false);
  INSERT INTO app.auth_identities (internal_user_id, provider, provider_user_id)
    VALUES (p_user_id, 'CLERK', p_clerk_user_id);
END $$;
ALTER FUNCTION app.register_invited_clerk_identity(text,uuid,text) OWNER TO migration_owner;
REVOKE ALL ON FUNCTION app.register_invited_clerk_identity(text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.register_invited_clerk_identity(text,uuid,text) TO app_runtime;
--> statement-breakpoint

CREATE FUNCTION app.register_manual_staff_identity(p_token_hash text, p_staff_number text, p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, app, platform
AS $$
DECLARE invited_name text;
BEGIN
  SELECT invitation.invited_name INTO invited_name
    FROM app.resolve_manual_staff_invitation(p_token_hash, p_staff_number) invitation;
  IF NOT FOUND OR p_user_id IS NULL THEN RAISE EXCEPTION 'invitation unavailable' USING ERRCODE = 'P0001'; END IF;
  INSERT INTO app.users (id, name, email, email_verified) VALUES (p_user_id, invited_name, NULL, false);
END $$;
ALTER FUNCTION app.register_manual_staff_identity(text,text,uuid) OWNER TO migration_owner;
REVOKE ALL ON FUNCTION app.register_manual_staff_identity(text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.register_manual_staff_identity(text,text,uuid) TO app_runtime;
--> statement-breakpoint

-- Refresh the proof's cached regprocedure constants after replacing capability OIDs.
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
--> statement-breakpoint
SELECT platform.first_user_provisioning_assert_runtime_role();
