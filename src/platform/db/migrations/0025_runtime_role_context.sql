-- Preserve the runtime-only capability boundary when an administrative
-- connection uses SET ROLE app_runtime (the local/CI bootstrap path).
CREATE OR REPLACE FUNCTION app.seal_meter_segment(
  p_tenant_id uuid,
  p_station_id uuid,
  p_segment_id uuid,
  p_expected_version integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, app
AS $$
DECLARE sealed_id uuid;
BEGIN
  IF session_user NOT IN ('app_runtime', 'postgres')
     AND current_setting('role', true) IS DISTINCT FROM 'app_runtime' THEN
    RAISE EXCEPTION 'meter segment sealing is restricted to the application runtime role';
  END IF;
  IF p_expected_version < 0
     OR app.current_tenant_id() IS DISTINCT FROM p_tenant_id
     OR current_setting('app.station_id', true) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR current_setting('app.station_id', true)::uuid IS DISTINCT FROM p_station_id
     OR NOT app.has_active_membership() THEN
    RAISE EXCEPTION 'trusted station context is required for meter segment sealing';
  END IF;

  UPDATE app.meter_segments
  SET state = 'SEALED', version = version + 1
  WHERE tenant_id = p_tenant_id
    AND station_id = p_station_id
    AND id = p_segment_id
    AND state = 'OPEN'
    AND version = p_expected_version
  RETURNING id INTO sealed_id;

  IF sealed_id IS NULL THEN RETURN NULL; END IF;
  RETURN sealed_id;
END;
$$;
