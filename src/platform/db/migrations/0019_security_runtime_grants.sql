DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'job_runtime') THEN
    REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA auth FROM job_runtime;
    REVOKE USAGE ON SCHEMA auth FROM job_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'diagnostics_readonly') THEN
    REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA auth FROM diagnostics_readonly;
    REVOKE USAGE ON SCHEMA auth FROM diagnostics_readonly;
  END IF;
END
$$;
