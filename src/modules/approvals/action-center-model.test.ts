import { describe, expect, it } from 'vitest';
import {
  buildActionCenter,
  classifyCreditUse,
  type ActionCenterFacts,
} from './action-center-model';

const clear: ActionCenterFacts = {
  stationId: 'st-1',
  reconciliations: { status: 'ok', value: { rows: [], soleApprover: false } },
  revaluations: { status: 'ok', value: { rows: [], soleApprover: false } },
  cash: { status: 'ok', value: { collectedButUnbanked: '0.00', pendingBankConfirmation: '0' } },
  settlements: { status: 'ok', value: { toMatch: 0, exceptions: 0, unmatchedPayments: 0 } },
  suppliers: { status: 'ok', value: { overdueSuppliers: 0, overdueTotal: '0' } },
  customers: { status: 'ok', value: { nearLimit: 0, overLimit: 0 } },
};

describe('buildActionCenter', () => {
  it('is empty with nothing to do', () => {
    expect(buildActionCenter(clear)).toEqual({ items: [], unavailable: [] });
  });

  it('links each waiting reconciliation to its review page', () => {
    const result = buildActionCenter({
      ...clear,
      reconciliations: {
        status: 'ok',
        value: {
          rows: [{ id: 'r1', businessDate: '2026-10-16', submittedByMe: false }],
          soleApprover: false,
        },
      },
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.href).toBe('/stations/st-1/reconciliations/r1/review');
    expect(result.items[0]?.detail).toBe('Review and approve or return it.');
  });

  it('tells the submitter someone else must approve, unless they are the only approver', () => {
    const rows = [{ id: 'r1', businessDate: '2026-10-16', submittedByMe: true }];
    const blocked = buildActionCenter({
      ...clear,
      reconciliations: { status: 'ok', value: { rows, soleApprover: false } },
    });
    expect(blocked.items[0]?.detail).toContain('someone else needs to approve');
    const solo = buildActionCenter({
      ...clear,
      reconciliations: { status: 'ok', value: { rows, soleApprover: true } },
    });
    expect(solo.items[0]?.detail).toBe('Review and approve or return it.');
  });

  it('reports exact cash, settlement and payable items, attention first', () => {
    const result = buildActionCenter({
      ...clear,
      cash: {
        status: 'ok',
        value: { collectedButUnbanked: '1200.50', pendingBankConfirmation: '300' },
      },
      settlements: { status: 'ok', value: { toMatch: 1, exceptions: 2, unmatchedPayments: 3 } },
      suppliers: { status: 'ok', value: { overdueSuppliers: 1, overdueTotal: '4500.00' } },
    });
    expect(result.items.map((item) => item.id)).toEqual([
      'cash-pending-confirmation',
      'settlement-exceptions',
      'suppliers-overdue',
      'cash-unbanked',
      'settlement-to-match',
      'settlement-unmatched-payments',
    ]);
    expect(result.items.find((i) => i.id === 'cash-unbanked')?.title).toBe(
      '$1,200.50 collected but not yet banked',
    );
    expect(result.items.find((i) => i.id === 'settlement-exceptions')?.title).toBe(
      '2 provider settlements have a difference',
    );
  });

  it('lists areas that could not be checked and leaves restricted ones out', () => {
    const result = buildActionCenter({
      ...clear,
      cash: { status: 'unavailable' },
      settlements: { status: 'restricted' },
    });
    expect(result).toEqual({ items: [], unavailable: ['Cash and banking'] });
  });
});

describe('customer credit', () => {
  it('classifies what is owed against the limit exactly', () => {
    expect(classifyCreditUse('799.99', '1000')).toBe('ok');
    expect(classifyCreditUse('800.00', '1000')).toBe('near');
    expect(classifyCreditUse('1000.00', '1000')).toBe('near');
    expect(classifyCreditUse('1000.01', '1000')).toBe('over');
    expect(classifyCreditUse('-50', '1000')).toBe('ok');
  });

  it('does not judge accounts with no limit, a zero limit or no balance', () => {
    expect(classifyCreditUse('500', null)).toBe('ok');
    expect(classifyCreditUse('500', '0')).toBe('ok');
    expect(classifyCreditUse(null, '1000')).toBe('ok');
  });

  it('lists customers over and near their limit under Receivables', () => {
    const result = buildActionCenter({
      ...clear,
      customers: { status: 'ok', value: { nearLimit: 2, overLimit: 1 } },
    });
    expect(result.items.map((item) => [item.id, item.area, item.tone, item.href])).toEqual([
      ['customers-over-limit', 'Receivables', 'attention', '/customers'],
      ['customers-near-limit', 'Receivables', 'info', '/customers'],
    ]);
    expect(result.items[0]?.title).toBe('1 customer is over their credit limit');
    expect(result.items[1]?.title).toBe('2 customers are near their credit limit');
  });

  it('says so when customer credit could not be checked, and stays quiet when restricted', () => {
    expect(
      buildActionCenter({ ...clear, customers: { status: 'unavailable' } }).unavailable,
    ).toEqual(['Customer credit']);
    expect(buildActionCenter({ ...clear, customers: { status: 'restricted' } })).toEqual({
      items: [],
      unavailable: [],
    });
  });
});
