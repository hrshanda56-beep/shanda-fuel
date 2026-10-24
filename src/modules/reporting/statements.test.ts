import { describe, expect, it } from 'vitest';
import type { ManagementReport } from './contracts';
import {
  approvedFuelBenefit,
  buildNetPosition,
  buildProfitAndLoss,
  buildQuickFigures,
} from './statements';

function report(approvedFuel: string | null): ManagementReport {
  return {
    revenue: { recognizedRevenue: '1000.0000' },
    costing: { restatedCogs: '600.0000', unvaluedSaleCount: 0, saleCount: 4 },
    grossMargin: '400.0000',
    expenses: {
      operatingTotal: '100.0000',
      fixedCostTotal: '50.0000',
      total: '150.0000',
      rows: [],
    },
    sales: {
      salesValue: '1000.0000',
      payments:
        approvedFuel === null
          ? [{ method: 'CASH', amount: '1000.0000', evidenceIds: [] }]
          : [
              { method: 'CASH', amount: '1000.0000', evidenceIds: [] },
              { method: 'STAFF_OR_MANAGEMENT_FUEL', amount: approvedFuel, evidenceIds: [] },
            ],
    },
    cash: { banked: '0', collectedButNotBanked: '0' },
    inventory: { expectedLitres: '0' },
    suppliers: { outstandingBalance: '0' },
    customers: { receivableBalance: '0' },
    providers: { unallocatedProviderAmount: '0' },
  } as unknown as ManagementReport;
}

const lines = (r: ManagementReport) => buildProfitAndLoss(r).groups.flatMap((group) => group.lines);
const line = (r: ManagementReport, label: string) => lines(r).find((l) => l.label === label);

describe('approved fuel in the profit statement (DEC-044)', () => {
  it('shows nothing extra and changes no figure when no fuel was approved', () => {
    const r = report(null);
    expect(approvedFuelBenefit(r)).toBe('0');
    expect(line(r, 'Staff and management fuel')).toBeUndefined();
    expect(line(r, 'Net operating result')?.value).toBe('250');
    expect(buildProfitAndLoss(r).notes.join(' ')).not.toContain('approved for staff');
  });

  it('treats approved fuel as a benefit cost, so it is not income received', () => {
    const r = report('30.5000');
    expect(line(r, 'Staff and management fuel')).toMatchObject({
      value: '30.5000',
      note: 'Approved fuel at selling price',
    });
    expect(line(r, 'Total operating expenses')?.value).toBe('130.5');
    // 400 gross - 100 operating - 50 fixed - 30.5 benefit
    expect(line(r, 'Net operating result')?.value).toBe('219.5');
    expect(buildProfitAndLoss(r).notes.join(' ')).toContain('approved for staff and management');
  });

  it('keeps the quick figures consistent with the statement', () => {
    const figures = Object.fromEntries(
      buildQuickFigures(report('30.5000')).map((f) => [f.id, f.value]),
    );
    expect(figures.expenses).toBe('180.5');
    expect(figures.net).toBe('219.5');
  });
});

describe('net current position', () => {
  const position = (overrides: Record<string, unknown> = {}) =>
    ({
      cash: { collectedButNotBanked: '1200.5000' },
      providers: { unmatchedEvidenceAmount: '300.2500' },
      suppliers: { outstandingBalance: '900.0000' },
      customers: {
        availability: 'AVAILABLE',
        receivableBalance: '450.0000',
        prepaidValueBalance: '100.0000',
      },
      ...overrides,
    }) as unknown as ManagementReport;
  const find = (statement: ReturnType<typeof buildNetPosition>, label: string) =>
    statement.groups.flatMap((g) => g.lines).find((l) => l.label === label);

  it('subtracts what we owe from what we hold or are owed, exactly', () => {
    const statement = buildNetPosition(position());
    expect(find(statement, 'Total held or owed to us')?.value).toBe('1950.75');
    expect(find(statement, 'Total owed by us')?.value).toBe('1000');
    expect(find(statement, 'Net current position')?.value).toBe('950.75');
    expect(statement.notes.join(' ')).toContain('Stock at cost');
  });

  it('can be negative', () => {
    const statement = buildNetPosition(
      position({ suppliers: { outstandingBalance: '5000.0000' } }),
    );
    expect(find(statement, 'Net current position')?.value).toBe('-3149.25');
  });

  it('shows no net figure, never zero, when customer balances are unavailable for one station', () => {
    const statement = buildNetPosition(
      position({
        customers: {
          availability: 'UNAVAILABLE_STATION_DIMENSION',
          receivableBalance: null,
          prepaidValueBalance: null,
        },
      }),
    );
    expect(find(statement, 'Net current position')?.value).toBeNull();
    expect(find(statement, 'Owed by credit customers')?.value).toBeNull();
    expect(statement.notes.join(' ')).toContain('all stations');
  });
});
