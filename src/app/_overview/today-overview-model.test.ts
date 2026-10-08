import { describe, expect, it } from 'vitest';

import {
  approvalLabel,
  countActiveCustomers,
  countOpenShifts,
  countSuspendedCustomers,
  operationsAttention,
  shiftSummary,
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
