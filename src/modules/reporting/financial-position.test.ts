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
      bank: { balance: '800.0000', asOf: '2026-10-24', accountCount: 1, accountsWithoutBalance: 0 },
      receivedNotInvoiced: { value: '250.0000', unpricedLitres: '0.000' },
    },
    ...overrides,
  }) as unknown as ManagementReport;

const find = (p: ReturnType<typeof buildFinancialPosition>, label: string) =>
  p.statement.groups.flatMap((g) => g.lines).find((l) => l.label === label);

describe('buildFinancialPosition', () => {
  it('adds stock, bank balance, unpaid expenses and un-invoiced fuel exactly and flags a positive position', () => {
    const p = buildFinancialPosition(base());
    expect(p.totalHeld).toBe('7750.8734');
    expect(p.totalOwed).toBe('1325.5');
    expect(p.net).toBe('6425.3734');
    expect(p.flag).toBe('POSITIVE');
    expect(p.missing).toEqual([]);
  });

  it('flags a negative position', () => {
    const p = buildFinancialPosition(base({ suppliers: { outstandingBalance: '20000.0000' } }));
    expect(p.net).toBe('-12674.6266');
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
          bank: {
            balance: '0.0000',
            asOf: '2026-10-24',
            accountCount: 1,
            accountsWithoutBalance: 0,
          },
          receivedNotInvoiced: { value: '0.0000', unpricedLitres: '0.000' },
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
          bank: {
            balance: '800.0000',
            asOf: '2026-10-24',
            accountCount: 1,
            accountsWithoutBalance: 0,
          },
          receivedNotInvoiced: { value: '250.0000', unpricedLitres: '0.000' },
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
    expect(other?.note).toContain('Not recorded');
    expect(p.missing).not.toContain('Transporters and other creditors');
  });

  it('uses the recorded bank balance, not the deposits in the chosen dates', () => {
    const a = buildFinancialPosition(base());
    const b = buildFinancialPosition(
      base({ cash: { collectedButNotBanked: '1200.5000', banked: '99999.0000' } }),
    );
    expect(b.net).toBe(a.net);
    expect(find(a, 'Money in the bank')?.value).toBe('800.0000');
    expect(find(a, 'Money in the bank')?.note).toContain('2026-10-24');
  });

  it('shows no net and says so when a bank account has no balance recorded', () => {
    const p = buildFinancialPosition(
      base({
        ownerPosition: {
          ...base().ownerPosition,
          bank: { balance: null, asOf: null, accountCount: 2, accountsWithoutBalance: 1 },
        },
      }),
    );
    expect(p.net).toBeNull();
    expect(p.missing).toContain('Money in the bank');
    expect(find(p, 'Money in the bank')?.note).toContain('1 bank account');
  });

  it('counts fuel received but not yet invoiced as money owed', () => {
    const p = buildFinancialPosition(base());
    expect(find(p, 'Fuel received, not yet invoiced')?.value).toBe('250.0000');
  });

  it('shows no net when received fuel has no cost recorded yet', () => {
    const p = buildFinancialPosition(
      base({
        ownerPosition: {
          ...base().ownerPosition,
          receivedNotInvoiced: { value: null, unpricedLitres: '500.000' },
        },
      }),
    );
    expect(p.net).toBeNull();
    expect(find(p, 'Fuel received, not yet invoiced')?.note).toContain('500.000 litres');
  });
});
