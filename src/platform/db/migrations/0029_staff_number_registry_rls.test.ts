import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('./0029_staff_number_registry_rls.sql', import.meta.url),
  'utf8',
);

describe('0029 Staff Number registry RLS repair', () => {
  it('adds only owner policies required by SECURITY DEFINER capability functions', () => {
    expect(migration).toContain('CREATE POLICY auth_identities_security_definer');
    expect(migration).toContain('ON app.auth_identities');
    expect(migration).toContain('CREATE POLICY staff_number_registry_security_definer');
    expect(migration).toContain('ON app.staff_number_registry');
    expect(migration).toContain('FOR ALL');
    expect(migration).toContain('TO migration_owner');
    expect(migration).toContain("current_user = 'migration_owner'");
    expect(migration).not.toMatch(
      /GRANT\s+SELECT\s+ON\s+TABLE\s+app\.staff_number_registry\s+TO\s+app_runtime/i,
    );
    expect(migration).not.toMatch(
      /GRANT\s+SELECT\s+ON\s+TABLE\s+app\.auth_identities\s+TO\s+app_runtime/i,
    );
    expect(migration).not.toMatch(/DROP TABLE|DELETE FROM|TRUNCATE/i);
  });
});
