import { describe, expect, it } from 'vitest';

import {
  buildStatement,
  statementToCsv,
  type ReconciliationDetail,
  type StatementShift,
} from './reconciliation-statement';

const detail = (over: Partial<ReconciliationDetail['totals']> = {}): ReconciliationDetail => ({
  state: 'SUBMITTED',
  readings: [
    { id: 'r1', litresSold: '100.5', salesValue: '150.75' },
    { id: 'r2', litresSold: '20', salesValue: '30' },
  ],
  payments: [
    { id: 'p1', method: 'CASH', amount: '100.10' },
    { id: 'p2', method: 'CASH', amount: '50.05' },
    { id: 'p3', method: 'ECOCASH', amount: '30.60' },
  ],
  expenses: [{ id: 'e1', category: 'FUEL', amount: '5', paymentMethod: 'CASH' }],
  cash: { countedCash: '145', netExpectedCash: '145.15', cashVariance: '-0.15' },
  totals: {
    expectedSales: '180.75',
    accountedSales: '180.75',
    salesVariance: '0.00',
    cashVariance: '-0.15',
    ...over,
  },
});

const label = (value: string) => value.toLowerCase();

describe('buildStatement', () => {
  it('groups payments by method with exact sums and adds shifts together', () => {
    const shifts: StatementShift[] = [
      { id: 'a', label: '06:00 – 14:00', state: 'APPROVED', detail: detail() },
      {
        id: 'b',
        label: '14:00 – 22:00',
        state: 'SUBMITTED',
        detail: detail({ salesVariance: '-1.10' }),
      },
    ];
    const statement = buildStatement(shifts, label);
    expect(statement.sections[0]?.paymentLines).toEqual([
      { description: 'cash', amount: '150.15' },
      { description: 'ecocash', amount: '30.60' },
    ]);
    expect(statement.sections[0]?.litres).toBe('120.50');
    expect(statement.totals.expectedSales).toBe('361.50');
    expect(statement.totals.salesVariance).toBe('-1.10');
    expect(statement.totals.cashVariance).toBe('-0.30');
  });

  it('lists shifts without figures instead of counting them as zero', () => {
    const statement = buildStatement(
      [{ id: 'a', label: 'Shift', state: 'DRAFT', detail: null }],
      label,
    );
    expect(statement.sections).toHaveLength(0);
    expect(statement.missing).toHaveLength(1);
    expect(statement.totals.countedCash).toBeNull();
  });

  it('reports totals as unavailable, not zero, when no shift has figures', () => {
    const { totals } = buildStatement(
      [{ id: 'a', label: 'Shift', state: 'DRAFT', detail: null }],
      label,
    );
    expect(totals.expectedSales).toBeNull();
    expect(totals.accountedSales).toBeNull();
    expect(totals.salesVariance).toBeNull();
    expect(totals.complete).toBe(false);
  });

  it('marks totals incomplete when a shift is missing and counts shifts without cash', () => {
    const statement = buildStatement(
      [
        { id: 'a', label: 'A', state: 'APPROVED', detail: detail() },
        { id: 'b', label: 'B', state: 'DRAFT', detail: { ...detail(), cash: null } },
        { id: 'c', label: 'C', state: 'DRAFT', detail: null },
      ],
      label,
    );
    expect(statement.totals.complete).toBe(false);
    expect(statement.totals.shiftsWithoutCash).toBe(1);
    expect(statement.totals.countedCash).toBe('145.00');
    expect(
      buildStatement([{ id: 'a', label: 'A', state: 'APPROVED', detail: detail() }], label).totals
        .complete,
    ).toBe(true);
  });
});

describe('statementToCsv', () => {
  it('writes header, per-shift lines and totals at full precision', () => {
    const statement = buildStatement(
      [{ id: 'a', label: '06:00 – 14:00', state: 'APPROVED', detail: detail() }],
      label,
    );
    const csv = statementToCsv({
      organisation: 'Acme, Ltd',
      station: 'Main',
      businessDate: '15 Oct 2026',
      currency: 'USD',
      statement,
    });
    const lines = csv.trimEnd().split('\r\n');
    expect(lines[0]).toBe(
      'Organisation,Station,Business date,Shift,Section,Description,Amount (USD)',
    );
    expect(lines[1]).toContain('"Acme, Ltd",Main,15 Oct 2026,06:00 – 14:00,Sales,');
    expect(csv).toContain('06:00 – 14:00,Accounted by,cash,150.15');
    expect(csv).toContain(',Total,Sales,Expected sales,180.75');
    // One plain table: every row has the same number of columns.
    expect(new Set(lines.map((row) => row.replace(/"[^"]*"/g, 'x').split(',').length))).toEqual(
      new Set([7]),
    );
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('names missing figures instead of leaving them blank or zero', () => {
    const statement = buildStatement(
      [
        {
          id: 'a',
          label: 'A',
          state: 'DRAFT',
          detail: { ...detail(), cash: null, totals: { ...detail().totals, cashVariance: null } },
        },
        { id: 'b', label: 'B', state: 'DRAFT', detail: null },
      ],
      label,
    );
    const csv = statementToCsv({
      organisation: 'Org',
      station: 'Main',
      businessDate: '15 Oct 2026',
      currency: 'USD',
      statement,
    });
    expect(csv).toContain(',A,Cash,Counted cash,Not recorded');
    expect(csv).toContain(',B,Sales,Figures could not be loaded,Not available');
    expect(csv).toContain(',Total,Cash,Counted cash,Not recorded');
    expect(csv).toContain('Totals exclude 1 shift(s) whose figures could not be loaded');
    expect(csv).toContain('Cash totals exclude 1 shift(s) with no counted cash');
  });
});
