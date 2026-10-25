import { describe, expect, it } from 'vitest';
import type { ManagementReport } from './contracts';
import { buildFinancialPosition } from './statements';

const base = (overrides: Record<string, unknown> = {}) =>
  ({
    cash: { collectedButNotBanked: '1200.5000', banked: '800.0000' },
    providers: { unmatchedEvidenceAmount: '300.2500' },
    suppliers: { outstandingBalance: '900.0000' },
    customers: {
      availability: 'AVAILABLE',
      receivableBalance: '450.0000',
      prepaidValueBalance: '100.0000',
    },
    ownerPosition: {
      stockValue: '5000.1234',
      unvaluedStockStreams: 0,
      unpaidExpenses: '75.5000',
      expensesAwaitingApproval: { count: 2, amount: '40.0000' },
    },
    ...overrides,
  }) as unknown as ManagementReport;

const find = (p: ReturnType<typeof buildFinancialPosition>, label: string) =>
  p.statement.groups.flatMap((g) => g.lines).find((l) => l.label === label);

describe('buildFinancialPosition', () => {
  it('adds stock, banked cash and unpaid expenses exactly and flags a positive position', () => {
    const p = buildFinancialPosition(base());
    expect(p.totalHeld).toBe('7750.8734');
    expect(p.totalOwed).toBe('1075.5');
    expect(p.net).toBe('6675.3734');
    expect(p.flag).toBe('POSITIVE');
    expect(p.missing).toEqual([]);
  });

  it('flags a negative position', () => {
    const p = buildFinancialPosition(base({ suppliers: { outstandingBalance: '20000.0000' } }));
    expect(p.net).toBe('-12424.6266');
    expect(p.flag).toBe('NEGATIVE');
  });

  it('flags an even position', () => {
    const p = buildFinancialPosition(
      base({
        cash: { collectedButNotBanked: '10.0000', banked: '0.0000' },
        providers: { unmatchedEvidenceAmount: '0.0000' },
        suppliers: { outstandingBalance: '10.0000' },
        customers: {
          availability: 'AVAILABLE',
          receivableBalance: '0.0000',
          prepaidValueBalance: '0.0000',
        },
        ownerPosition: {
          stockValue: '0.0000',
          unvaluedStockStreams: 0,
          unpaidExpenses: '0.0000',
          expensesAwaitingApproval: { count: 0, amount: '0.0000' },
        },
      }),
    );
    expect(p.flag).toBe('EVEN');
  });

  it('shows no net when stock has no cost yet, and says why', () => {
    const p = buildFinancialPosition(
      base({
        ownerPosition: {
          stockValue: null,
          unvaluedStockStreams: 2,
          unpaidExpenses: '0.0000',
          expensesAwaitingApproval: { count: 0, amount: '0.0000' },
        },
      }),
    );
    expect(p.net).toBeNull();
    expect(p.flag).toBe('UNAVAILABLE');
    expect(p.missing).toEqual(['Fuel stock at cost']);
    expect(find(p, 'Fuel stock at cost')?.note).toContain('2 tank(s)');
  });

  it('shows no net for a single station because customer balances are organisation-wide', () => {
    const p = buildFinancialPosition(
      base({
        customers: {
          availability: 'UNAVAILABLE_STATION_DIMENSION',
          receivableBalance: null,
          prepaidValueBalance: null,
        },
      }),
    );
    expect(p.flag).toBe('UNAVAILABLE');
    expect(p.statement.notes.join(' ')).toContain('whole organisation');
  });

  it('is unavailable when the owner figures were not read', () => {
    const p = buildFinancialPosition(base({ ownerPosition: undefined }));
    expect(p.flag).toBe('UNAVAILABLE');
    expect(p.missing).toContain('Expenses not yet paid');
  });

  it('lists unrecorded creditors without counting them', () => {
    const p = buildFinancialPosition(base());
    const other = find(p, 'Transporters and other creditors');
    expect(other?.value).toBeNull();
    expect(other?.note).toContain('counted under suppliers');
    expect(other?.note).toContain('not recorded');
    expect(p.missing).not.toContain('Transporters and other creditors');
  });

  const owner = (bankBalance: unknown) => ({
    stockValue: '5000.1234',
    unvaluedStockStreams: 0,
    unpaidExpenses: '75.5000',
    expensesAwaitingApproval: { count: 2, amount: '40.0000' },
    bankBalance,
  });

  it('uses the typed-in bank balance instead of recorded deposits, never both', () => {
    const p = buildFinancialPosition(
      base({
        ownerPosition: owner({
          amount: '2000.0000',
          asOfDate: '2026-10-24',
          accountsWithBalance: 1,
          accountsTotal: 1,
        }),
      }),
    );
    expect(find(p, 'Money in the bank (from the bank statement)')?.value).toBe('2000.0000');
    expect(find(p, 'Cash banked')).toBeUndefined();
    // 1200.5 + 2000 + 300.25 + 450 + 5000.1234 = 8950.8734, not counting the 800 of deposits.
    expect(p.totalHeld).toBe('8950.8734');
  });

  it('falls back to deposits, and says so, until every account has a balance', () => {
    const p = buildFinancialPosition(
      base({
        ownerPosition: owner({
          amount: null,
          asOfDate: null,
          accountsWithBalance: 1,
          accountsTotal: 2,
        }),
      }),
    );
    const line = find(p, 'Cash banked');
    expect(line?.value).toBe('800.0000');
    expect(line?.note).toContain('1 of 2 accounts');
    expect(p.totalHeld).toBe('7750.8734');
  });
});
