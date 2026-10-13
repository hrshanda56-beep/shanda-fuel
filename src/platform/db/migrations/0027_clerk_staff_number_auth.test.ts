import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('./0027_clerk_staff_number_auth.sql', import.meta.url),
  'utf8',
);

describe('0026 to 0027 Clerk and Staff Number upgrade contract', () => {
  it('is additive and keeps the provider boundary explicit', () => {
    expect(migration).toContain('ALTER COLUMN email DROP NOT NULL');
    expect(migration).toContain('CREATE TABLE app.auth_identities');
    expect(migration).toContain('CREATE TABLE app.staff_number_registry');
    expect(migration).toContain('CREATE TABLE app.auth_session_assurance');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION app.resolve_auth_identity');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION app.reserve_staff_number');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION app.resolve_manual_staff_invitation');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION app.accept_manual_staff_invitation');
    expect(migration).toContain('REVOKE ALL PRIVILEGES ON TABLE app.auth_identities FROM PUBLIC');
    expect(migration).toContain(
      'REVOKE ALL PRIVILEGES ON TABLE app.staff_number_registry FROM PUBLIC',
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION app.reserve_staff_number(uuid, text) TO app_runtime',
    );
    expect(migration).not.toMatch(/DROP TABLE|DELETE FROM|TRUNCATE/i);
    expect(migration).not.toMatch(/GRANT .* TO job_runtime/i);
  });
});
