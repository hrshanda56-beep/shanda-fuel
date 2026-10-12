import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('./0028_clerk_target_identity_revocation.sql', import.meta.url),
  'utf8',
);

describe('0028 Clerk target identity revocation capability', () => {
  it('is additive, target-bound and FORCE RLS compatible', () => {
    expect(migration).toContain('CREATE POLICY auth_identities_target_provider_lookup');
    expect(migration).toContain("session_user = 'app_runtime'");
    expect(migration).toContain("current_user = 'migration_owner'");
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION app.resolve_provider_identity_for_membership',
    );
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain('SET search_path = pg_catalog, app, auth, platform');
    expect(migration).toContain("membership.status IN ('ACTIVE', 'DISABLED')");
    expect(migration).toContain("assignment.role_code IN ('OWNER', 'ADMINISTRATOR')");
    expect(migration).toContain("assignment.scope_type = 'TENANT'");
    expect(migration).toContain('REVOKE ALL PRIVILEGES ON FUNCTION');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION');
    expect(migration).not.toMatch(/GRANT\s+SELECT\s+ON\s+TABLE\s+app\.auth_identities/i);
    expect(migration).not.toMatch(/BYPASSRLS/i);
    expect(migration).not.toMatch(/GRANT .* TO job_runtime/i);
    expect(migration).not.toMatch(/DROP TABLE|DELETE FROM|TRUNCATE/i);
  });
});
