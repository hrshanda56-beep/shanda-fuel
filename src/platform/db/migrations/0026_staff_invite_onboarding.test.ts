import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('./0026_staff_invite_onboarding.sql', import.meta.url),
  'utf8',
);

describe('0025 to 0026 staff onboarding upgrade contract', () => {
  it('is a forward-only additive upgrade with the required security boundary', () => {
    expect(migration).toContain('CREATE TABLE app.staff_invitations');
    expect(migration).toContain('CREATE TABLE app.staff_invitation_stations');
    expect(migration).toContain('ALTER TABLE app.staff_invitations FORCE ROW LEVEL SECURITY');
    expect(migration).toContain(
      'ALTER TABLE app.staff_invitation_stations FORCE ROW LEVEL SECURITY',
    );
    expect(migration).toContain('CREATE UNIQUE INDEX staff_invitations_pending_email_uidx');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION app.accept_staff_invitation');
    expect(migration).toContain('REVOKE ALL PRIVILEGES ON FUNCTION app.accept_staff_invitation');
    expect(migration).not.toMatch(/DROP TABLE|DELETE FROM|TRUNCATE/i);
  });
});
