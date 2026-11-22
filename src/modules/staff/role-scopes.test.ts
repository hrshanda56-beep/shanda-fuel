import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ROLE_CODES } from '../../platform/security';
import { defaultScopeForRole, scopeChoicesForRole } from './role-scopes';
import { validateInvitationScope } from './domain';

const LE = '11111111-1111-4111-8111-111111111111';
const ST = ['22222222-2222-4222-8222-222222222222'];

function accepts(
  role: (typeof ROLE_CODES)[number],
  scopeType: 'TENANT' | 'LEGAL_ENTITY' | 'STATION',
) {
  try {
    validateInvitationScope(role, {
      scopeType,
      ...(scopeType === 'TENANT' ? {} : { legalEntityId: LE }),
      stationIds: scopeType === 'STATION' ? ST : [],
    });
    return true;
  } catch {
    return false;
  }
}

describe('role scope rules', () => {
  it('gives every role at least one scope and a default that is one of its choices', () => {
    for (const role of ROLE_CODES) {
      expect(scopeChoicesForRole(role).length).toBeGreaterThan(0);
      expect(scopeChoicesForRole(role)).toContain(defaultScopeForRole(role));
    }
  });

  it('matches exactly what the invitation validator accepts, for every role', () => {
    for (const role of ROLE_CODES) {
      for (const scope of ['TENANT', 'LEGAL_ENTITY', 'STATION'] as const) {
        expect(accepts(role, scope), `${role} at ${scope}`).toBe(
          scopeChoicesForRole(role).includes(scope),
        );
      }
    }
  });

  it('puts the three newer roles where the product says they work', () => {
    expect(scopeChoicesForRole('AUDITOR')).toEqual(['TENANT']);
    expect(scopeChoicesForRole('AREA_MANAGER')).toEqual(['STATION']);
    expect(scopeChoicesForRole('CASH_COLLECTOR')).toEqual(['STATION']);
  });

  it('matches the database rule on staff invitations for every role', () => {
    const migration = readFileSync(
      new URL('../../platform/db/migrations/0103_staff_invitation_roles.sql', import.meta.url),
      'utf8',
    );
    const tenant = /scope_type = 'TENANT'[^)]*assigned_role IN \(([^)]*)\)/.exec(migration)?.[1];
    const station = /scope_type = 'STATION'[^)]*assigned_role IN \(([^)]*)\)/.exec(migration)?.[1];
    const entity = /scope_type = 'LEGAL_ENTITY'[^)]*assigned_role IN \(([^)]*)\)/.exec(
      migration,
    )?.[1];
    const roles = (list?: string): string[] => (list ?? '').match(/[A-Z_]+/g) ?? [];
    for (const role of ROLE_CODES) {
      const choices = scopeChoicesForRole(role);
      expect(roles(tenant).includes(role), `${role} TENANT`).toBe(choices.includes('TENANT'));
      expect(roles(entity).includes(role), `${role} LEGAL_ENTITY`).toBe(
        choices.includes('LEGAL_ENTITY'),
      );
      expect(roles(station).includes(role), `${role} STATION`).toBe(choices.includes('STATION'));
    }
  });
});

describe('0103 migration contract', () => {
  const migration = readFileSync(
    new URL('../../platform/db/migrations/0103_staff_invitation_roles.sql', import.meta.url),
    'utf8',
  );
  it('only replaces the one check constraint and is forward-only', () => {
    expect(migration).toContain('DROP CONSTRAINT staff_invitations_scope_ck');
    expect(migration).toContain('ADD CONSTRAINT staff_invitations_scope_ck');
    expect(migration).not.toMatch(/DROP TABLE|DELETE FROM|TRUNCATE|DISABLE ROW LEVEL/i);
  });
});
