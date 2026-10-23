import { describe, expect, it } from 'vitest';

import type { AuthorizationActor } from '../platform/security';
import {
  allowsE2ENavigationFixture,
  buildNavigationProjection,
  isAttendantWorkspaceActor,
} from './navigation-projection';

const scope = { tenantId: 'tenant-a', scopeType: 'TENANT' as const };

function actor(roleCode: 'OWNER' | 'SUPERVISOR' | 'FINANCE' | 'ATTENDANT'): AuthorizationActor {
  return {
    userId: 'user-a',
    membershipId: 'membership-a',
    tenantId: 'tenant-a',
    membershipActive: true,
    roleAssignments: [
      {
        tenantId: 'tenant-a',
        roleCode,
        scopeType: 'TENANT',
      },
    ],
  };
}

describe('server navigation projection', () => {
  describe('synthetic E2E navigation fixture', () => {
    const allowed = [
      'test',
      'synthetic',
      'development',
      'http://127.0.0.1:3100',
      undefined,
    ] as const;
    const check = (...override: Array<[number, string | null | undefined]>) => {
      const args: Array<string | null | undefined> = [...allowed];
      for (const [index, value] of override) args[index] = value;
      return allowsE2ENavigationFixture(
        args[0] as string | undefined,
        args[1] as string | null,
        args[2] as string | undefined,
        args[3] as string | undefined,
        args[4] as string | undefined,
      );
    };

    it('is allowed only for local/CI browser tests under next dev', () => {
      expect(check()).toBe(true);
      // The local default (APP_URL unset) and the other loopback spellings.
      expect(check([3, undefined])).toBe(true);
      expect(check([3, 'http://localhost:3100'])).toBe(true);
      expect(check([3, 'http://[::1]:3100'])).toBe(true);
    });

    it('requires the exact synthetic header', () => {
      for (const header of [null, '', 'none', 'true', 'Synthetic', 'synthetic ']) {
        expect(check([1, header])).toBe(false);
      }
    });

    it('requires APP_ENV=test exactly', () => {
      for (const appEnv of [undefined, '', 'local', 'e2e', 'staging', 'production', 'Test']) {
        expect(check([0, appEnv])).toBe(false);
      }
    });

    it('is refused for every NODE_ENV except development (production, test, unset, odd values)', () => {
      for (const nodeEnv of ['production', 'test', 'staging', 'Development', '', undefined]) {
        expect(check([2, nodeEnv])).toBe(false);
      }
    });

    it('is refused in production-like deployments even if APP_ENV and the header are set', () => {
      // Vercel (preview, staging, production) sets VERCEL; NODE_ENV is production there too.
      expect(check([4, '1'])).toBe(false);
      expect(check([2, 'production'], [4, '1'])).toBe(false);
      // Deployed environments are HTTPS and non-loopback.
      for (const appUrl of [
        'https://app.shandahr.example',
        'https://127.0.0.1:3100',
        'http://app.shandahr.example',
        'http://127.0.0.1.evil.example',
        'http://localhost.evil.example',
        'not a url',
        '',
      ]) {
        expect(check([3, appUrl])).toBe(false);
      }
    });
  });

  it('gives an attendant only My Shift and no management destination', () => {
    const projection = buildNavigationProjection({ actor: actor('ATTENDANT'), scope });
    const visible = projection.filter((entry) => entry.visible).map((entry) => entry.key);

    expect(visible).toEqual(['my-shift']);
    expect(projection.every((entry) => entry.visible === entry.enabled)).toBe(true);
  });

  it('decides the attendant landing from permissions, not the role name', () => {
    const attendant = actor('ATTENDANT');
    expect(isAttendantWorkspaceActor({ actor: attendant, scope })).toBe(true);
    // A supervisor holds the same shift/meter permissions plus management ones.
    expect(isAttendantWorkspaceActor({ actor: actor('SUPERVISOR'), scope })).toBe(false);
    expect(isAttendantWorkspaceActor({ actor: actor('OWNER'), scope })).toBe(false);
    // Without shift/meter permissions there is no attendant workspace either.
    const stranger: AuthorizationActor = { ...attendant, roleAssignments: [] };
    expect(isAttendantWorkspaceActor({ actor: stranger, scope })).toBe(false);
  });

  it('keeps supervisor navigation unchanged and never adds My Shift to it', () => {
    const visible = buildNavigationProjection({ actor: actor('SUPERVISOR'), scope })
      .filter((entry) => entry.visible)
      .map((entry) => entry.key);
    expect(visible).not.toContain('my-shift');
    expect(visible).toEqual(
      expect.arrayContaining(['today', 'daily-operations', 'reconciliations']),
    );
  });

  it('routes finance users to the authorized reports workspace without settings access', () => {
    const projection = buildNavigationProjection({ actor: actor('FINANCE'), scope });
    const visible = projection.filter((entry) => entry.visible).map((entry) => entry.key);

    expect(visible).toContain('reports');
    expect(visible).toContain('customers');
    expect(visible).not.toContain('my-shift');
  });

  it('does not show My Shift for a station the attendant is not assigned to', () => {
    const stationActor: AuthorizationActor = {
      ...actor('ATTENDANT'),
      roleAssignments: [
        {
          tenantId: 'tenant-a',
          roleCode: 'ATTENDANT',
          scopeType: 'STATION',
          legalEntityId: 'le-a',
          stationId: 'station-a',
        },
      ],
    };
    const own = {
      tenantId: 'tenant-a',
      scopeType: 'STATION' as const,
      legalEntityId: 'le-a',
      stationId: 'station-a',
    };
    expect(isAttendantWorkspaceActor({ actor: stationActor, scope: own })).toBe(true);
    expect(
      isAttendantWorkspaceActor({ actor: stationActor, scope: { ...own, stationId: 'station-b' } }),
    ).toBe(false);
    expect(
      isAttendantWorkspaceActor({
        actor: stationActor,
        scope: { ...own, tenantId: 'tenant-b' },
      }),
    ).toBe(false);
  });

  it('keeps tenant-scoped owner navigation available', () => {
    const projection = buildNavigationProjection({ actor: actor('OWNER'), scope });
    expect(projection.filter((entry) => entry.visible).map((entry) => entry.key)).toEqual([
      'finance-home',
      'today',
      'daily-operations',
      'reconciliations',
      'inventory',
      'cash',
      'settlements',
      'customers',
      'suppliers',
      'purchasing',
      'expenses',
      'profitability',
      'daily-profit',
      'financial-position',
      'fuel-deliveries',
      'customer-controls',
      'staff-benefit',
      'payments-due',
      'reports',
      'settings',
    ]);
  });

  it("makes the Finance overview the finance role's home, in place of Today", () => {
    const projection = buildNavigationProjection({ actor: actor('FINANCE'), scope });
    const entry = (key: string) => projection.find((item) => item.key === key);
    expect(entry('finance-home')).toMatchObject({ visible: true, home: true });
    expect(entry('today')?.visible).toBe(false);
    expect(entry('cash')?.visible).toBe(true);
  });

  it('keeps Today as the home for people who run the day, even with sign-off permissions', () => {
    for (const role of ['OWNER', 'SUPERVISOR'] as const) {
      const projection = buildNavigationProjection({ actor: actor(role), scope });
      expect(projection.find((item) => item.key === 'finance-home')?.home).toBeUndefined();
      if (role === 'OWNER')
        expect(projection.find((item) => item.key === 'today')?.visible).toBe(true);
    }
  });

  it('does not let a tenant-scoped grant project into another tenant', () => {
    const projection = buildNavigationProjection({
      actor: actor('OWNER'),
      scope: { tenantId: 'tenant-b', scopeType: 'TENANT' },
    });
    expect(projection.every((entry) => !entry.visible)).toBe(true);
  });
});
