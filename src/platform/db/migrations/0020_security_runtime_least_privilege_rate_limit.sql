-- Security hardening after the historical runtime-role grants.
-- This migration is forward-only. It does not change the existing application
-- table grants except for removing app_runtime DELETE from app tables where
-- the application has no authoritative delete command. Draft reconciliation
-- replacement is the measured exception and retains DELETE only on the
-- seven tables used by production-reconciliation.ts.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    REVOKE DELETE ON ALL TABLES IN SCHEMA app FROM app_runtime;
    GRANT DELETE ON
      app.reconciliation_attendants,
      app.reconciliation_meter_readings,
      app.reconciliation_payments,
      app.reconciliation_expenses,
      app.reconciliation_delivery_refs,
      app.reconciliation_dip_refs,
      app.reconciliation_variance_explanations
    TO app_runtime;
    REVOKE TRUNCATE, TRIGGER, REFERENCES ON ALL TABLES IN SCHEMA app, auth FROM app_runtime;
  END IF;
END
$$;

CREATE TABLE platform.rate_limit_windows (
  scope text NOT NULL,
  key_hash text NOT NULL,
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  CONSTRAINT rate_limit_windows_pk PRIMARY KEY (scope, key_hash, window_started_at),
  CONSTRAINT rate_limit_windows_scope_ck CHECK (btrim(scope) <> '' AND length(scope) <= 64),
  CONSTRAINT rate_limit_windows_key_hash_ck CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT rate_limit_windows_count_ck CHECK (request_count >= 0),
  CONSTRAINT rate_limit_windows_expiry_ck CHECK (expires_at > window_started_at)
);

CREATE INDEX rate_limit_windows_expiry_idx
  ON platform.rate_limit_windows (expires_at);

REVOKE ALL PRIVILEGES ON TABLE platform.rate_limit_windows FROM PUBLIC;

CREATE OR REPLACE FUNCTION platform.consume_rate_limit(
  p_scope text,
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
)
RETURNS TABLE (
  allowed boolean,
  remaining integer,
  retry_after_seconds integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, platform
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_window_started_at timestamptz;
  v_expires_at timestamptz;
  v_request_count integer;
BEGIN
  IF session_user NOT IN ('app_runtime', 'postgres') THEN
    RAISE EXCEPTION 'rate limit capability is restricted to the application runtime';
  END IF;
  IF p_scope IS NULL OR btrim(p_scope) = '' OR length(p_scope) > 64 THEN
    RAISE EXCEPTION 'rate limit scope is invalid';
  END IF;
  IF p_key_hash IS NULL OR p_key_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'rate limit key hash is invalid';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 10000 THEN
    RAISE EXCEPTION 'rate limit is outside the supported range';
  END IF;
  IF p_window_seconds IS NULL OR p_window_seconds < 1 OR p_window_seconds > 86400 THEN
    RAISE EXCEPTION 'rate limit window is outside the supported range';
  END IF;

  v_window_started_at := to_timestamp(
    floor(extract(epoch FROM v_now) / p_window_seconds) * p_window_seconds
  );
  v_expires_at := v_window_started_at + make_interval(secs => p_window_seconds);

  INSERT INTO platform.rate_limit_windows AS current_window (
    scope,
    key_hash,
    window_started_at,
    request_count,
    expires_at
  )
  VALUES (p_scope, p_key_hash, v_window_started_at, 1, v_expires_at)
  ON CONFLICT (scope, key_hash, window_started_at) DO UPDATE
    SET request_count = current_window.request_count + 1
    WHERE current_window.request_count < p_limit
  RETURNING request_count INTO v_request_count;

  -- The retention bound is intentionally local to the active key. A scheduled
  -- cleanup job can remove all expired rows later without affecting decisions.
  DELETE FROM platform.rate_limit_windows
   WHERE scope = p_scope
     AND key_hash = p_key_hash
     AND window_started_at < v_window_started_at - make_interval(secs => p_window_seconds * 2);

  IF v_request_count IS NULL THEN
    SELECT current_window.request_count
      INTO v_request_count
      FROM platform.rate_limit_windows AS current_window
     WHERE current_window.scope = p_scope
       AND current_window.key_hash = p_key_hash
       AND current_window.window_started_at = v_window_started_at;

    RETURN QUERY SELECT
      false,
      0,
      GREATEST(1, ceil(extract(epoch FROM (v_expires_at - v_now)))::integer);
    RETURN;
  END IF;

  RETURN QUERY SELECT
    true,
    GREATEST(0, p_limit - v_request_count),
    GREATEST(1, ceil(extract(epoch FROM (v_expires_at - v_now)))::integer);
END
$$;

REVOKE ALL PRIVILEGES ON FUNCTION platform.consume_rate_limit(text, text, integer, integer)
  FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'migration_owner') THEN
    ALTER TABLE platform.rate_limit_windows OWNER TO migration_owner;
    ALTER INDEX platform.rate_limit_windows_expiry_idx OWNER TO migration_owner;
    ALTER FUNCTION platform.consume_rate_limit(text, text, integer, integer) OWNER TO migration_owner;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    REVOKE ALL PRIVILEGES ON TABLE platform.rate_limit_windows FROM app_runtime;
    GRANT EXECUTE ON FUNCTION platform.consume_rate_limit(text, text, integer, integer) TO app_runtime;
  END IF;
END
$$;
