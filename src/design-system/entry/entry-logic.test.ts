import { describe, expect, it } from 'vitest';

import {
  ENTRY_MESSAGES,
  PASSWORD_RESET_AVAILABLE,
  classifyLoginFailure,
  loginFailureMessage,
  planWorkplaceEntry,
  safePostSignInPath,
  validateNewPassword,
} from './entry-logic';

const station = (id: string, name: string) => ({ id, name });
const tree = (
  organisations: { id: string; name: string; entities: [string, string, [string, string][]][] }[],
) => ({
  organisations: organisations.map((o) => ({
    id: o.id,
    name: o.name,
    legalEntities: o.entities.map(([id, name, stations]) => ({
      id,
      name,
      stations: stations.map(([sid, sname]) => station(sid, sname)),
    })),
  })),
});

describe('login failures', () => {
  it('never distinguishes which credential failed', () => {
    expect(loginFailureMessage(classifyLoginFailure({ status: 401 }))).toBe(
      ENTRY_MESSAGES.invalidCredentials,
    );
    expect(loginFailureMessage(classifyLoginFailure({ status: 400, code: 'INVALID_EMAIL' }))).toBe(
      ENTRY_MESSAGES.invalidCredentials,
    );
    expect(loginFailureMessage(classifyLoginFailure(null))).toBe(ENTRY_MESSAGES.invalidCredentials);
  });

  it('reports rate limiting calmly', () => {
    expect(classifyLoginFailure({ status: 429 })).toBe('rate-limited');
    expect(loginFailureMessage('rate-limited')).toBe('Too many attempts. Try again shortly.');
  });

  it('does not blame the user for server faults', () => {
    expect(classifyLoginFailure({ status: 503 })).toBe('unavailable');
  });
});

describe('password reset', () => {
  it('stays hidden until a real workflow exists', () => {
    expect(PASSWORD_RESET_AVAILABLE).toBe(false);
  });
});

describe('safePostSignInPath', () => {
  it('allows only the default route and invitation paths', () => {
    expect(safePostSignInPath('/invite/abc_DEF-123')).toBe('/invite/abc_DEF-123');
    expect(safePostSignInPath(undefined)).toBe('/workplace');
    expect(safePostSignInPath('https://evil.example')).toBe('/workplace');
    expect(safePostSignInPath('//evil.example')).toBe('/workplace');
    expect(safePostSignInPath('/invite/../settings')).toBe('/workplace');
    expect(safePostSignInPath('/settings')).toBe('/workplace');
    expect(safePostSignInPath('/stations/bindura?tenantId=tenant-1&stationId=station-2')).toBe(
      '/stations/bindura?tenantId=tenant-1&stationId=station-2',
    );
    expect(safePostSignInPath('/%5Cevil.example?tenantId=t&stationId=s')).toBe('/workplace');
  });
});

describe('validateNewPassword', () => {
  it('requires length and a matching confirmation', () => {
    expect(validateNewPassword('short', 'short').password).toBeDefined();
    expect(validateNewPassword('long enough pw', 'different pw!!').confirm).toBeDefined();
    expect(validateNewPassword('long enough pw', 'long enough pw')).toEqual({});
  });
});

describe('planWorkplaceEntry', () => {
  it('shows an access state when there is no organisation', () => {
    expect(planWorkplaceEntry({ organisations: [] }, false)).toEqual({ kind: 'none' });
  });

  it('continues for one station without asking', () => {
    const available = tree([
      { id: 'o', name: 'Org', entities: [['l', 'LE', [['s1', 'Bindura']]]] },
    ]);
    expect(planWorkplaceEntry(available, false)).toEqual({ kind: 'continue' });
  });

  it('continues when an organisation has no stations yet (onboarding)', () => {
    const available = tree([{ id: 'o', name: 'Org', entities: [['l', 'LE', []]] }]);
    expect(planWorkplaceEntry(available, false)).toEqual({ kind: 'continue' });
  });

  it('asks which station for several, and skips when a valid choice is remembered', () => {
    const available = tree([
      {
        id: 'o',
        name: 'Org',
        entities: [
          [
            'l',
            'LE',
            [
              ['s1', 'Bindura'],
              ['s2', 'Maruta'],
            ],
          ],
        ],
      },
    ]);
    const plan = planWorkplaceEntry(available, false);
    expect(plan.kind).toBe('choose');
    if (plan.kind === 'choose') {
      expect(plan.options.map((o) => o.stationName)).toEqual(['Bindura', 'Maruta']);
      expect(plan.options.every((o) => o.detail === undefined)).toBe(true);
    }
    expect(planWorkplaceEntry(available, true)).toEqual({ kind: 'continue' });
  });

  it('adds detail only where names would be ambiguous or organisations differ', () => {
    const same = tree([
      {
        id: 'o',
        name: 'Org',
        entities: [
          ['l1', 'Entity A', [['s1', 'Main']]],
          ['l2', 'Entity B', [['s2', 'Main']]],
        ],
      },
    ]);
    const plan = planWorkplaceEntry(same, false);
    expect(plan.kind === 'choose' && plan.options.map((o) => o.detail)).toEqual([
      'Entity A',
      'Entity B',
    ]);

    const many = tree([
      { id: 'o1', name: 'Org One', entities: [['l1', 'LE', [['s1', 'A']]]] },
      { id: 'o2', name: 'Org Two', entities: [['l2', 'LE', [['s2', 'B']]]] },
    ]);
    const manyPlan = planWorkplaceEntry(many, false);
    expect(manyPlan.kind === 'choose' && manyPlan.options.map((o) => o.detail)).toEqual([
      'Org One',
      'Org Two',
    ]);
  });
});
