-- Review/apply explicitly before enabling CONSOLIDATED_CONTEXT_READS=1.
-- Invoker privileges and FORCE RLS remain in force. This is not a definer bypass.
CREATE FUNCTION app.read_navigation_context(p_actor_id uuid)
RETURNS TABLE (tenant_id uuid, membership_id uuid, identity_id uuid,
  roles jsonb, grants jsonb, context_rows jsonb)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, app
AS $$
DECLARE
  m record;
  saved_actor text := current_setting('app.actor_id', true);
  saved_tenant text := current_setting('app.tenant_id', true);
  saved_membership text := current_setting('app.membership_id', true);
  saved_legal text := current_setting('app.legal_entity_id', true);
  saved_station text := current_setting('app.station_id', true);
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'Authenticated actor required' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('app.actor_id', p_actor_id::text, true),
    set_config('app.tenant_id', '', true), set_config('app.membership_id', '', true),
    set_config('app.legal_entity_id', '', true), set_config('app.station_id', '', true);
  FOR m IN SELECT x.tenant_id, x.id, x.identity_id FROM app.memberships x
    WHERE x.identity_id = p_actor_id AND x.status = 'ACTIVE' ORDER BY x.tenant_id
  LOOP
    PERFORM set_config('app.tenant_id', m.tenant_id::text, true),
      set_config('app.membership_id', m.id::text, true);
    RETURN QUERY SELECT m.tenant_id, m.id, m.identity_id,
      coalesce((SELECT jsonb_agg(to_jsonb(a) || jsonb_build_object('expires_at', a.expires_at AT TIME ZONE 'UTC')) FROM app.membership_role_assignments a
        WHERE a.tenant_id = m.tenant_id AND a.membership_id = m.id
          AND (a.expires_at IS NULL OR a.expires_at > now())), '[]'::jsonb),
      coalesce((SELECT jsonb_agg(to_jsonb(g) || jsonb_build_object('expires_at', g.expires_at AT TIME ZONE 'UTC')) FROM app.temporary_permission_grants g
        WHERE g.tenant_id = m.tenant_id AND g.membership_id = m.id
          AND g.revoked_at IS NULL AND g.expires_at > now()), '[]'::jsonb),
      coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.legal_entity_name, c.legal_entity_id, c.station_code, c.station_id)
        FROM (SELECT t.id AS organisation_id, t.name AS organisation_name,
          le.id AS legal_entity_id, le.legal_name AS legal_entity_name,
          s.id AS station_id, s.code AS station_code, s.name AS station_name,
          s.timezone AS station_timezone
          FROM app.tenants t LEFT JOIN app.legal_entities le
            ON le.tenant_id = t.id AND le.status = 'ACTIVE'
          LEFT JOIN app.stations s ON s.tenant_id = le.tenant_id
            AND s.legal_entity_id = le.id AND s.status = 'ACTIVE'
          WHERE t.id = m.tenant_id AND t.status = 'ACTIVE') c), '[]'::jsonb);
  END LOOP;
  -- Restore the caller's settings even when this runs inside an outer transaction.
  PERFORM set_config('app.actor_id', coalesce(saved_actor, ''), true),
    set_config('app.tenant_id', coalesce(saved_tenant, ''), true),
    set_config('app.membership_id', coalesce(saved_membership, ''), true),
    set_config('app.legal_entity_id', coalesce(saved_legal, ''), true),
    set_config('app.station_id', coalesce(saved_station, ''), true);
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.read_navigation_context(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.read_navigation_context(uuid) TO app_runtime;
