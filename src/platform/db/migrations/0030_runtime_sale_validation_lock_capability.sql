-- Sale-recognition validation reads immutable forecourt source rows. The
-- command layer already locks the mutable reconciliation/inventory envelopes,
-- so this trigger must not request FOR SHARE on meter_segments: PostgreSQL
-- requires UPDATE for that lock mode, which app_runtime deliberately lacks.
DO $$
DECLARE
  function_definition text;
BEGIN
  SELECT pg_get_functiondef(p.oid)
    INTO function_definition
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'app'
     AND p.proname = 'rev1_validate_sale_recognition_movement'
     AND p.proargtypes = ''::oidvector;

  IF function_definition IS NULL THEN
    RAISE EXCEPTION 'expected app.rev1_validate_sale_recognition_movement() to exist';
  END IF;

  function_definition := regexp_replace(
    function_definition,
    E'\\n[[:space:]]+FOR SHARE;',
    ';',
    'g'
  );
  EXECUTE function_definition;
END
$$;
