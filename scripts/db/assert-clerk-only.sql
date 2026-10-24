-- Run after the Clerk-only forward migration using a diagnostic/admin
-- connection. This is read-only and never prints identities or credentials.
DO $$
BEGIN
  IF to_regclass('app.users') IS NULL THEN
    RAISE EXCEPTION 'Application user directory is missing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM app.auth_identities WHERE provider <> 'CLERK'
  ) THEN
    RAISE EXCEPTION 'Active identity mappings contain an alternate provider';
  END IF;
  IF EXISTS (
    SELECT 1 FROM app.memberships m
    LEFT JOIN app.users u ON u.id = m.identity_id
    WHERE u.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Membership identity references were not preserved';
  END IF;
  IF EXISTS (
    SELECT 1 FROM app.auth_identities i
    LEFT JOIN app.users u ON u.id = i.internal_user_id
    WHERE u.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Clerk identity mapping references an absent application user';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_tables t
    WHERE t.schemaname IN ('auth', 'legacy_auth')
      AND (
        has_table_privilege('app_runtime', format('%I.%I', t.schemaname, t.tablename), 'SELECT')
        OR has_table_privilege('app_runtime', format('%I.%I', t.schemaname, t.tablename), 'INSERT')
        OR has_table_privilege('app_runtime', format('%I.%I', t.schemaname, t.tablename), 'UPDATE')
        OR has_table_privilege('app_runtime', format('%I.%I', t.schemaname, t.tablename), 'DELETE')
      )
  ) THEN
    RAISE EXCEPTION 'Application runtime can access legacy authentication tables';
  END IF;
END $$;

SELECT 'Clerk-only database invariants passed' AS result;
