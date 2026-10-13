-- Restore the reviewed SECURITY DEFINER capability boundary for Staff Numbers.
--
-- 0027 intentionally withheld direct table privileges from app_runtime and
-- forced RLS on the registry and auth_identities. Because FORCE RLS also
-- applies to the table owner, the migration_owner-owned capability functions
-- need explicit owner-only policies to read and mutate those tables.
-- app_runtime still has no direct table privileges and can reach this data
-- only through EXECUTE on the reviewed functions.

CREATE POLICY auth_identities_security_definer
  ON app.auth_identities
  FOR ALL
  TO migration_owner
  USING (current_user = 'migration_owner')
  WITH CHECK (current_user = 'migration_owner');

CREATE POLICY staff_number_registry_security_definer
  ON app.staff_number_registry
  FOR ALL
  TO migration_owner
  USING (current_user = 'migration_owner')
  WITH CHECK (current_user = 'migration_owner');
