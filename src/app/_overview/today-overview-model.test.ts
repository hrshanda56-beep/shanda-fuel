import { describe, expect, it } from 'vitest';

import {
  approvalLabel,
  countActiveCustomers,
  countOpenShifts,
  countSuspendedCustomers,
  dashboardScopeFromCurrentContext,
  operationsAttention,
  shiftSummary,
  withScope,
  type TodayOperations,
} from './today-overview-model';

const base: TodayOperations = {
  station: { name: 'Bindura' },
  currentBusinessDate: '2026-10-08',
  status: { close: 'IN_PROGRESS', approval: 'NO_REVISION' },
  shifts: [],
};
const withStatus = (
  close: TodayOperations['status']['close'],
  approval: TodayOperations['status']['approval'] = 'NO_REVISION',
): TodayOperations => ({ ...base, status: { close, approval } });

describe('today overview model', () => {
  it.each(['NOT_STARTED', 'OPEN', 'IN_PROGRESS', 'CLOSED'] as const)(
    'raises nothing for %s',
    (close) => {
      expect(operationsAttention(withStatus(close), '/operations/daily')).toBeNull();
    },
  );

  it.each([
    ['BLOCKED', 'Bindura is blocked'],
    ['EXCEPTION', 'Bindura closed with an exception'],
    ['READY_FOR_REVIEW', 'Bindura is ready for review'],
    ['READY_TO_CLOSE', 'Bindura is ready to close'],
  ] as const)('raises %s as an attention row linking to daily operations', (close, title) => {
    expect(operationsAttention(withStatus(close), '/operations/daily')).toMatchObject({
      title,
      href: '/operations/daily',
    });
  });

  it('describes the approval state only when a revision exists', () => {
    expect(approvalLabel('NO_REVISION')).toBe('');
    expect(approvalLabel('PENDING_APPROVAL')).toBe('Awaiting approval');
    expect(operationsAttention(withStatus('BLOCKED', 'RETURNED'), '/x')?.detail).toBe(
      'Returned for changes',
    );
  });

  it('counts only suspended customers', () => {
    expect(
      countSuspendedCustomers([
        { status: 'ACTIVE' },
        { status: 'SUSPENDED' },
        { status: 'CLOSED' },
      ]),
    ).toBe(1);
  });

  it('summarises shifts', () => {
    expect(shiftSummary([])).toBe('No shifts yet');
    expect(shiftSummary([{ state: 'OPEN' }, { state: 'COMPLETED' }])).toBe('2 shifts · 1 open');
    expect(shiftSummary([{ state: 'COMPLETED' }])).toBe('1 shift');
  });
});

describe('figure counts', () => {
  it('counts only ACTIVE customers and OPEN shifts', () => {
    expect(
      countActiveCustomers([{ status: 'ACTIVE' }, { status: 'SUSPENDED' }, { status: 'CLOSED' }]),
    ).toBe(1);
    expect(countOpenShifts([{ state: 'OPEN' }, { state: 'CLOSED' }])).toBe(1);
    expect(countOpenShifts([])).toBe(0);
  });
});

describe('server-provided dashboard scope', () => {
  it('preserves only the already verified tenant and station scope', () => {
    expect(
      dashboardScopeFromCurrentContext({
        organisationId: 'tenant-1',
        legalEntityId: 'legal-entity-1',
        stationId: 'station-bindura',
        allStations: false,
      }),
    ).toEqual({
      tenantId: 'tenant-1',
      legalEntityId: 'legal-entity-1',
      stationId: 'station-bindura',
    });
  });

  it('does not invent a scope when the server has no current context', () => {
    expect(dashboardScopeFromCurrentContext(null)).toBeUndefined();
  });
});

describe('withScope', () => {
  const scope = { tenantId: 't1', legalEntityId: 'e1', stationId: 's1' };

  it('adds the scope with & when the link already has a query', () => {
    const url = new URL(withScope('/profitability?view=position', scope), 'http://x');
    expect(withScope('/profitability?view=position', scope).match(/\?/g)).toHaveLength(1);
    expect(url.pathname).toBe('/profitability');
    expect(url.searchParams.get('view')).toBe('position');
    expect(url.searchParams.get('tenantId')).toBe('t1');
    expect(url.searchParams.get('legalEntityId')).toBe('e1');
    expect(url.searchParams.get('stationId')).toBe('s1');
    expect(url.searchParams.has('allStations')).toBe(false);
  });

  it('adds the scope with ? when the link has no query', () => {
    expect(withScope('/expenses', scope)).toBe(
      '/expenses?tenantId=t1&legalEntityId=e1&stationId=s1',
    );
  });

  it('asks for all stations when no station is chosen', () => {
    const url = new URL(withScope('/profitability?view=daily', { tenantId: 't1' }), 'http://x');
    expect(url.searchParams.get('view')).toBe('daily');
    expect(url.searchParams.get('allStations')).toBe('true');
    expect(url.searchParams.has('stationId')).toBe(false);
  });
});
