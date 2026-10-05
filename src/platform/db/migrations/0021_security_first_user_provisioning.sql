-- First-user provisioning capability.
--
-- This is deliberately a database-enforced capability, not an administrative
-- bypass.  The only intended caller is the explicitly-created
-- first_user_provisioner role.  That role receives no table privileges and can
-- only execute the fixed scope-read, first-membership, revoke, and failure
-- audit functions below.  The functions are owned by migration_owner and
-- FORCE ROW LEVEL SECURITY remains enabled on every app/platform table.

CREATE OR REPLACE FUNCTION platform.first_user_provisioning_require_caller()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, platform, app, auth
AS $$
BEGIN
  IF session_user <> 'first_user_provisioner' THEN
    RAISE EXCEPTION 'first-user provisioning capability is restricted to first_user_provisioner'
      USING ERRCODE = '42501';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION platform.first_user_provisioning_set_context(
  p_capability text,
  p_tenant_id uuid DEFAULT NULL,
  p_legal_entity_id uuid DEFAULT NULL,
  p_station_id uuid DEFAULT NULL,
  p_identity_id uuid DEFAULT NULL,
  p_membership_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, platform, app, auth
AS $$
BEGIN
  PERFORM platform.first_user_provisioning_require_caller();
  IF p_capability NOT IN ('scope_read', 'inspect_read', 'provision', 'revoke', 'failure_audit') THEN
    RAISE EXCEPTION 'first-user provisioning capability is invalid'
      USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('app.first_user_provisioning_capability', p_capability, true);
  PERFORM set_config('app.first_user_provisioning_tenant_id', coalesce(p_tenant_id::text, ''), true);
  PERFORM set_config('app.first_user_provisioning_legal_entity_id', coalesce(p_legal_entity_id::text, ''), true);
  PERFORM set_config('app.first_user_provisioning_station_id', coalesce(p_station_id::text, ''), true);
  PERFORM set_config('app.first_user_provisioning_identity_id', coalesce(p_identity_id::text, ''), true);
  PERFORM set_config('app.first_user_provisioning_membership_id', coalesce(p_membership_id::text, ''), true);
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
  PERFORM platform.first_user_provisioning_set_context(
    'scope_read', p_tenant_id, p_legal_entity_id, p_station_id
  );

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
  IF p_email IS NULL OR p_email <> lower(btrim(p_email)) OR length(p_email) > 320 THEN
    RAISE EXCEPTION 'first-user provisioning email is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_user FROM auth."user" u WHERE u.email = p_email LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  PERFORM platform.first_user_provisioning_set_context(
    'inspect_read', p_tenant_id, NULL, NULL, v_user.id, NULL
  );

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', a.id::text, 'accountId', a.account_id,
    'providerId', a.provider_id, 'userId', a.user_id::text,
    'hasPassword', a.password IS NOT NULL
  ) ORDER BY a.id), '[]'::jsonb)
    INTO v_accounts
    FROM auth.account a
   WHERE a.user_id = v_user.id;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id::text, 'tenantId', m.tenant_id::text,
    'identityId', m.identity_id::text, 'status', m.status,
    'roleAssignmentCount', (
      SELECT count(*)::integer
        FROM app.membership_role_assignments a
       WHERE a.tenant_id = m.tenant_id
         AND a.membership_id = m.id
    )
  ) ORDER BY m.tenant_id, m.id), '[]'::jsonb)
    INTO v_memberships
    FROM app.memberships m
   WHERE m.identity_id = v_user.id
     AND (p_tenant_id IS NULL OR m.tenant_id = p_tenant_id);

  RETURN jsonb_build_object(
    'id', v_user.id::text,
    'name', v_user.name,
    'email', v_user.email,
    'accounts', v_accounts,
    'memberships', v_memberships
  );
END
$$;

CREATE OR REPLACE FUNCTION platform.first_user_provisioning_permission_definitions(
  p_codes text[]
)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, platform, app, auth
AS $$
DECLARE
  v_allowed_codes constant text[] := ARRAY[
    'tenant.context.select', 'tenant.view', 'legal_entity.view',
    'station.view', 'business_day.view', 'shift.view',
    'supplier.view', 'supplier.creditor.review', 'inventory.view',
    'provider.settlement.view', 'cash.collection.view', 'cash.deposit.view'
  ]::text[];
  v_codes text[];
BEGIN
  PERFORM platform.first_user_provisioning_require_caller();
  IF EXISTS (
    SELECT 1
     FROM unnest(coalesce(p_codes, ARRAY[]::text[])) AS requested(code)
     WHERE requested.code IS NULL OR requested.code <> ALL(v_allowed_codes)
  ) THEN
    RAISE EXCEPTION 'first-user provisioning permission request is outside the fixed read-only allowlist'
      USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(array_agg(p.code ORDER BY p.code), ARRAY[]::text[])
    INTO v_codes
    FROM platform.permission_definitions p
   WHERE p.code = ANY(p_codes)
     AND p.code = ANY(v_allowed_codes);
  RETURN v_codes;
END
$$;

CREATE OR REPLACE FUNCTION platform.first_user_provisioning_grants(
  p_tenant_id uuid,
  p_membership_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, platform, app, auth
AS $$
BEGIN
  PERFORM platform.first_user_provisioning_set_context(
    'inspect_read', p_tenant_id, NULL, NULL, NULL, p_membership_id
  );
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', g.id::text, 'tenantId', g.tenant_id::text,
      'membershipId', g.membership_id::text, 'permissionCode', g.permission_code,
      'scopeType', g.scope_type, 'legalEntityId', g.legal_entity_id::text,
      'stationId', g.station_id::text, 'reason', g.reason
    ) ORDER BY g.id)
      FROM app.temporary_permission_grants g
     WHERE g.tenant_id = p_tenant_id
       AND g.membership_id = p_membership_id
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
    RAISE EXCEPTION 'first-user provisioning audit event is invalid'
      USING ERRCODE = '22023';
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
    (p_event->>'eventId')::uuid,
    p_tenant_id,
    p_membership_id,
    NULL,
    p_expected_code,
    (p_event->>'requestId')::uuid,
    (p_event->>'occurredAt')::timestamp,
    p_event->'details',
    p_event->>'keyId',
    p_event->>'algorithm',
    p_event->>'signature'
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
  v_active_membership boolean;
BEGIN
  PERFORM platform.first_user_provisioning_set_context(
    'provision', p_tenant_id, p_legal_entity_id, p_station_id, p_user_id, p_membership_id
  );
  PERFORM set_config('app.first_user_provisioning_operation_id', p_operation_id::text, true);

  IF p_email IS NULL OR p_email <> lower(btrim(p_email)) OR length(p_email) > 320
     OR p_display_name IS NULL OR length(btrim(p_display_name)) NOT BETWEEN 1 AND 160
     OR p_password_hash IS NULL OR length(btrim(p_password_hash)) = 0
     OR p_expires_at <= v_now OR p_expires_at > v_now + interval '2 hours'
  THEN
    RAISE EXCEPTION 'first-user provisioning input is invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_email, 0));

  PERFORM 1 FROM app.tenants t
   WHERE t.id = p_tenant_id AND t.status = 'ACTIVE'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'selected tenant is missing or inactive' USING ERRCODE = '23503';
  END IF;

  PERFORM 1 FROM app.legal_entities e
   WHERE e.id = p_legal_entity_id
     AND e.tenant_id = p_tenant_id
     AND e.status = 'ACTIVE'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'selected legal entity is outside the tenant or inactive' USING ERRCODE = '23503';
  END IF;

  PERFORM 1 FROM app.stations s
   WHERE s.id = p_station_id
     AND s.tenant_id = p_tenant_id
     AND s.legal_entity_id = p_legal_entity_id
     AND s.status = 'ACTIVE'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'selected station is outside the legal entity or inactive' USING ERRCODE = '23503';
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
    RAISE EXCEPTION 'first-user provisioning read-only permission definitions are incomplete'
      USING ERRCODE = '23514';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM app.memberships m
     WHERE m.tenant_id = p_tenant_id
       AND m.status IN ('INVITED', 'ACTIVE', 'SUSPENDED', 'LOCKED')
  ) INTO v_active_membership;
  IF v_active_membership THEN
    RAISE EXCEPTION 'selected tenant already has a non-disabled membership'
      USING ERRCODE = '23505';
  END IF;

  IF EXISTS (SELECT 1 FROM auth."user" u WHERE u.email = p_email)
     OR EXISTS (SELECT 1 FROM auth."user" u WHERE u.id = p_user_id)
  THEN
    RAISE EXCEPTION 'first-user provisioning duplicate identity is refused'
      USING ERRCODE = '23505';
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

  PERFORM platform.first_user_provisioning_insert_event(
    p_initiated_event, 'ACCESS.PROVISIONING_INITIATED',
    p_tenant_id, p_membership_id, p_user_id, p_operation_id
  );

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
    ) AS grant_row(permission_code, scope_type, legal_entity_id, station_id);

  PERFORM platform.first_user_provisioning_insert_event(
    p_completed_event, 'ACCESS.PROVISIONING_COMPLETED',
    p_tenant_id, p_membership_id, p_user_id, p_operation_id
  );

  RETURN jsonb_build_object(
    'operationId', p_operation_id::text,
    'userId', p_user_id::text,
    'membershipId', p_membership_id::text,
    'expiresAt', p_expires_at,
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
  p_grant_ids uuid[],
  p_event jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, platform, app, auth
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_membership_count integer;
  v_role_assignment_count integer;
  v_grant_count integer;
  v_revoked_grant_count integer;
  v_revoked_session_count integer;
BEGIN
  PERFORM platform.first_user_provisioning_set_context(
    'revoke', p_tenant_id, p_legal_entity_id, p_station_id, p_user_id, p_membership_id
  );
  PERFORM set_config('app.first_user_provisioning_operation_id', p_operation_id::text, true);

  PERFORM 1 FROM app.tenants t
   WHERE t.id = p_tenant_id AND t.status = 'ACTIVE'
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'selected tenant is missing or inactive' USING ERRCODE = '23503'; END IF;
  PERFORM 1 FROM app.legal_entities e
   WHERE e.id = p_legal_entity_id AND e.tenant_id = p_tenant_id AND e.status = 'ACTIVE'
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'selected legal entity is outside the tenant or inactive' USING ERRCODE = '23503'; END IF;
  PERFORM 1 FROM app.stations s
   WHERE s.id = p_station_id AND s.tenant_id = p_tenant_id
     AND s.legal_entity_id = p_legal_entity_id AND s.status = 'ACTIVE'
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'selected station is outside the legal entity or inactive' USING ERRCODE = '23503'; END IF;

  SELECT count(*) INTO v_membership_count
    FROM app.memberships m
   WHERE m.identity_id = p_user_id;
  IF v_membership_count <> 1 THEN
    RAISE EXCEPTION 'cleanup refuses an identity with another membership' USING ERRCODE = '23514';
  END IF;

  PERFORM 1 FROM app.memberships m
   WHERE m.id = p_membership_id AND m.tenant_id = p_tenant_id
     AND m.identity_id = p_user_id AND m.status = 'ACTIVE'
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'target membership is missing or not active' USING ERRCODE = '23514'; END IF;

  SELECT count(*) INTO v_role_assignment_count
    FROM app.membership_role_assignments a
   WHERE a.tenant_id = p_tenant_id AND a.membership_id = p_membership_id;
  IF v_role_assignment_count <> 0 THEN
    RAISE EXCEPTION 'cleanup refuses a membership with role assignments' USING ERRCODE = '23514';
  END IF;

  IF coalesce(array_length(p_grant_ids, 1), 0) <> 12
     OR (SELECT count(*) FROM unnest(p_grant_ids)) <> 12
  THEN
    RAISE EXCEPTION 'cleanup requires exactly the twelve operation grants' USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO v_grant_count
    FROM app.temporary_permission_grants g
   WHERE g.tenant_id = p_tenant_id AND g.membership_id = p_membership_id
     AND g.revoked_at IS NULL;
  IF v_grant_count <> 12 THEN
    RAISE EXCEPTION 'cleanup refuses unrelated or missing unrevoked grants' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM app.temporary_permission_grants g
     WHERE g.tenant_id = p_tenant_id AND g.membership_id = p_membership_id
       AND g.revoked_at IS NULL
       AND (g.id <> ALL(p_grant_ids)
         OR g.reason <> 'first-production-user-provisioning:' || p_operation_id::text)
  ) THEN
    RAISE EXCEPTION 'cleanup refuses unrelated operation grants' USING ERRCODE = '23514';
  END IF;

  SELECT count(*) INTO v_grant_count
    FROM app.temporary_permission_grants g
   WHERE g.tenant_id = p_tenant_id AND g.membership_id = p_membership_id
     AND g.id = ANY(p_grant_ids) AND g.revoked_at IS NULL;
  IF v_grant_count <> 12 THEN
    RAISE EXCEPTION 'cleanup could not match the exact operation grants' USING ERRCODE = '23514';
  END IF;

  PERFORM platform.first_user_provisioning_validate_event(
    p_event, 'ACCESS.PROVISIONING_REVOKED',
    p_tenant_id, p_membership_id, p_user_id, p_operation_id
  );

  UPDATE app.temporary_permission_grants
     SET revoked_at = coalesce(revoked_at, v_now)
   WHERE tenant_id = p_tenant_id AND membership_id = p_membership_id
     AND id = ANY(p_grant_ids) AND revoked_at IS NULL;
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

  RETURN jsonb_build_object(
    'operationId', p_operation_id::text,
    'userId', p_user_id::text,
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
  PERFORM platform.first_user_provisioning_set_context('failure_audit', p_tenant_id);
  IF NOT EXISTS (
    SELECT 1 FROM app.tenants t WHERE t.id = p_tenant_id AND t.status = 'ACTIVE'
  ) THEN
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

-- The policies below are intentionally additive to the ordinary active-
-- membership policies.  They apply only while one of the fixed definer
-- functions is executing; first_user_provisioner has no table privileges, so
-- setting these transaction-local labels alone cannot turn into table access.
CREATE POLICY first_user_provisioning_scope_read ON app.tenants
  FOR SELECT USING (
    session_user = 'first_user_provisioner'
    AND current_setting('app.first_user_provisioning_capability', true) IN ('scope_read', 'provision', 'revoke', 'failure_audit')
    AND (
      nullif(current_setting('app.first_user_provisioning_tenant_id', true), '') IS NULL
      OR id = nullif(current_setting('app.first_user_provisioning_tenant_id', true), '')::uuid
    )
  );

CREATE POLICY first_user_provisioning_scope_read ON app.legal_entities
  FOR SELECT USING (
    session_user = 'first_user_provisioner'
    AND current_setting('app.first_user_provisioning_capability', true) IN ('scope_read', 'provision', 'revoke')
    AND tenant_id = nullif(current_setting('app.first_user_provisioning_tenant_id', true), '')::uuid
    AND (nullif(current_setting('app.first_user_provisioning_legal_entity_id', true), '') IS NULL
      OR id = nullif(current_setting('app.first_user_provisioning_legal_entity_id', true), '')::uuid)
  );

CREATE POLICY first_user_provisioning_scope_read ON app.stations
  FOR SELECT USING (
    session_user = 'first_user_provisioner'
    AND current_setting('app.first_user_provisioning_capability', true) IN ('scope_read', 'provision', 'revoke')
    AND tenant_id = nullif(current_setting('app.first_user_provisioning_tenant_id', true), '')::uuid
    AND (nullif(current_setting('app.first_user_provisioning_legal_entity_id', true), '') IS NULL
      OR legal_entity_id = nullif(current_setting('app.first_user_provisioning_legal_entity_id', true), '')::uuid)
    AND (nullif(current_setting('app.first_user_provisioning_station_id', true), '') IS NULL
      OR id = nullif(current_setting('app.first_user_provisioning_station_id', true), '')::uuid)
  );

CREATE POLICY first_user_provisioning_membership_read ON app.memberships
  FOR SELECT USING (
    session_user = 'first_user_provisioner'
    AND current_setting('app.first_user_provisioning_capability', true) IN ('inspect_read', 'provision', 'revoke')
    AND (
      identity_id = nullif(current_setting('app.first_user_provisioning_identity_id', true), '')::uuid
      OR tenant_id = nullif(current_setting('app.first_user_provisioning_tenant_id', true), '')::uuid
    )
  );

CREATE POLICY first_user_provisioning_membership_insert ON app.memberships
  FOR INSERT WITH CHECK (
    session_user = 'first_user_provisioner'
    AND current_setting('app.first_user_provisioning_capability', true) = 'provision'
    AND tenant_id = nullif(current_setting('app.first_user_provisioning_tenant_id', true), '')::uuid
    AND id = nullif(current_setting('app.first_user_provisioning_membership_id', true), '')::uuid
    AND identity_id = nullif(current_setting('app.first_user_provisioning_identity_id', true), '')::uuid
    AND status = 'ACTIVE'
  );

CREATE POLICY first_user_provisioning_membership_revoke ON app.memberships
  FOR UPDATE USING (
    session_user = 'first_user_provisioner'
    AND current_setting('app.first_user_provisioning_capability', true) = 'revoke'
    AND tenant_id = nullif(current_setting('app.first_user_provisioning_tenant_id', true), '')::uuid
    AND id = nullif(current_setting('app.first_user_provisioning_membership_id', true), '')::uuid
    AND identity_id = nullif(current_setting('app.first_user_provisioning_identity_id', true), '')::uuid
  ) WITH CHECK (
    tenant_id = nullif(current_setting('app.first_user_provisioning_tenant_id', true), '')::uuid
    AND id = nullif(current_setting('app.first_user_provisioning_membership_id', true), '')::uuid
    AND identity_id = nullif(current_setting('app.first_user_provisioning_identity_id', true), '')::uuid
    AND status = 'DISABLED'
  );

CREATE POLICY first_user_provisioning_role_assignment_read ON app.membership_role_assignments
  FOR SELECT USING (
    session_user = 'first_user_provisioner'
    AND current_setting('app.first_user_provisioning_capability', true) IN ('inspect_read', 'revoke')
    AND tenant_id = nullif(current_setting('app.first_user_provisioning_tenant_id', true), '')::uuid
    AND (nullif(current_setting('app.first_user_provisioning_membership_id', true), '') IS NULL
      OR membership_id = nullif(current_setting('app.first_user_provisioning_membership_id', true), '')::uuid)
  );

CREATE POLICY first_user_provisioning_grant_read ON app.temporary_permission_grants
  FOR SELECT USING (
    session_user = 'first_user_provisioner'
    AND current_setting('app.first_user_provisioning_capability', true) IN ('inspect_read', 'revoke')
    AND tenant_id = nullif(current_setting('app.first_user_provisioning_tenant_id', true), '')::uuid
    AND membership_id = nullif(current_setting('app.first_user_provisioning_membership_id', true), '')::uuid
  );

CREATE POLICY first_user_provisioning_grant_insert ON app.temporary_permission_grants
  FOR INSERT WITH CHECK (
    session_user = 'first_user_provisioner'
    AND current_setting('app.first_user_provisioning_capability', true) = 'provision'
    AND tenant_id = nullif(current_setting('app.first_user_provisioning_tenant_id', true), '')::uuid
    AND membership_id = nullif(current_setting('app.first_user_provisioning_membership_id', true), '')::uuid
    AND reason = 'first-production-user-provisioning:' || nullif(current_setting('app.first_user_provisioning_operation_id', true), '')
    AND expires_at > clock_timestamp()
    AND expires_at <= clock_timestamp() + interval '2 hours'
    AND (
      (permission_code IN ('tenant.context.select', 'tenant.view')
       AND scope_type = 'TENANT' AND legal_entity_id IS NULL AND station_id IS NULL)
      OR (permission_code IN ('legal_entity.view', 'supplier.view', 'supplier.creditor.review')
       AND scope_type = 'LEGAL_ENTITY'
       AND legal_entity_id = nullif(current_setting('app.first_user_provisioning_legal_entity_id', true), '')::uuid
       AND station_id IS NULL)
      OR (permission_code IN ('station.view', 'business_day.view', 'shift.view', 'inventory.view', 'provider.settlement.view', 'cash.collection.view', 'cash.deposit.view')
       AND scope_type = 'STATION'
       AND legal_entity_id = nullif(current_setting('app.first_user_provisioning_legal_entity_id', true), '')::uuid
       AND station_id = nullif(current_setting('app.first_user_provisioning_station_id', true), '')::uuid)
    )
  );

CREATE POLICY first_user_provisioning_grant_revoke ON app.temporary_permission_grants
  FOR UPDATE USING (
    session_user = 'first_user_provisioner'
    AND current_setting('app.first_user_provisioning_capability', true) = 'revoke'
    AND tenant_id = nullif(current_setting('app.first_user_provisioning_tenant_id', true), '')::uuid
    AND membership_id = nullif(current_setting('app.first_user_provisioning_membership_id', true), '')::uuid
  ) WITH CHECK (
    tenant_id = nullif(current_setting('app.first_user_provisioning_tenant_id', true), '')::uuid
    AND membership_id = nullif(current_setting('app.first_user_provisioning_membership_id', true), '')::uuid
    AND revoked_at IS NOT NULL
  );

CREATE POLICY first_user_provisioning_audit_append ON platform.security_events
  FOR INSERT WITH CHECK (
    session_user = 'first_user_provisioner'
    AND current_setting('app.first_user_provisioning_capability', true) IN ('provision', 'revoke', 'failure_audit')
    AND tenant_id = nullif(current_setting('app.first_user_provisioning_tenant_id', true), '')::uuid
    AND actor_id IS NULL
    AND event_code IN (
      'ACCESS.PROVISIONING_INITIATED', 'ACCESS.PROVISIONING_COMPLETED',
      'ACCESS.PROVISIONING_REVOKED', 'ACCESS.PROVISIONING_FAILED'
    )
  );

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_owner') THEN
    RAISE EXCEPTION 'migration_owner role is required for first-user provisioning capability';
  END IF;

  ALTER FUNCTION platform.first_user_provisioning_require_caller() OWNER TO migration_owner;
  ALTER FUNCTION platform.first_user_provisioning_set_context(text, uuid, uuid, uuid, uuid, uuid) OWNER TO migration_owner;
  ALTER FUNCTION platform.first_user_provisioning_scope_options(uuid, uuid, uuid) OWNER TO migration_owner;
  ALTER FUNCTION platform.first_user_provisioning_identity(text, uuid) OWNER TO migration_owner;
  ALTER FUNCTION platform.first_user_provisioning_permission_definitions(text[]) OWNER TO migration_owner;
  ALTER FUNCTION platform.first_user_provisioning_grants(uuid, uuid) OWNER TO migration_owner;
  ALTER FUNCTION platform.first_user_provisioning_validate_event(jsonb, text, uuid, uuid, uuid, uuid) OWNER TO migration_owner;
  ALTER FUNCTION platform.first_user_provisioning_insert_event(jsonb, text, uuid, uuid, uuid, uuid) OWNER TO migration_owner;
  ALTER FUNCTION platform.first_user_provisioning_provision(uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, timestamptz, jsonb, jsonb) OWNER TO migration_owner;
  ALTER FUNCTION platform.first_user_provisioning_revoke(uuid, uuid, uuid, uuid, uuid, uuid, uuid[], jsonb) OWNER TO migration_owner;
  ALTER FUNCTION platform.first_user_provisioning_append_failure(uuid, jsonb) OWNER TO migration_owner;
END
$$;

REVOKE ALL ON FUNCTION platform.first_user_provisioning_require_caller() FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.first_user_provisioning_set_context(text, uuid, uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.first_user_provisioning_scope_options(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.first_user_provisioning_identity(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.first_user_provisioning_permission_definitions(text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.first_user_provisioning_grants(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.first_user_provisioning_validate_event(jsonb, text, uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.first_user_provisioning_insert_event(jsonb, text, uuid, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.first_user_provisioning_provision(uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, timestamptz, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.first_user_provisioning_revoke(uuid, uuid, uuid, uuid, uuid, uuid, uuid[], jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.first_user_provisioning_append_failure(uuid, jsonb) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'first_user_provisioner') THEN
    IF EXISTS (
      SELECT 1 FROM pg_roles
       WHERE rolname = 'first_user_provisioner'
         AND (rolsuper OR rolbypassrls)
    ) THEN
      RAISE EXCEPTION 'first_user_provisioner must remain NOSUPERUSER and NOBYPASSRLS';
    END IF;
    IF EXISTS (
      SELECT 1
        FROM pg_namespace n
       WHERE n.nspowner = (SELECT oid FROM pg_roles WHERE rolname = 'first_user_provisioner')
    ) OR EXISTS (
      SELECT 1
        FROM pg_class c
       WHERE c.relowner = (SELECT oid FROM pg_roles WHERE rolname = 'first_user_provisioner')
    ) THEN
      RAISE EXCEPTION 'first_user_provisioner must not own schemas or tables';
    END IF;
    ALTER ROLE first_user_provisioner LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION;
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO first_user_provisioner', current_database());
    GRANT USAGE ON SCHEMA platform TO first_user_provisioner;
    GRANT EXECUTE ON FUNCTION platform.first_user_provisioning_scope_options(uuid, uuid, uuid) TO first_user_provisioner;
    GRANT EXECUTE ON FUNCTION platform.first_user_provisioning_identity(text, uuid) TO first_user_provisioner;
    GRANT EXECUTE ON FUNCTION platform.first_user_provisioning_permission_definitions(text[]) TO first_user_provisioner;
    GRANT EXECUTE ON FUNCTION platform.first_user_provisioning_grants(uuid, uuid) TO first_user_provisioner;
    GRANT EXECUTE ON FUNCTION platform.first_user_provisioning_provision(uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, timestamptz, jsonb, jsonb) TO first_user_provisioner;
    GRANT EXECUTE ON FUNCTION platform.first_user_provisioning_revoke(uuid, uuid, uuid, uuid, uuid, uuid, uuid[], jsonb) TO first_user_provisioner;
    GRANT EXECUTE ON FUNCTION platform.first_user_provisioning_append_failure(uuid, jsonb) TO first_user_provisioner;
  END IF;
END
$$;
