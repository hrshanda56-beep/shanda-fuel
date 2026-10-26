import { describe, expect, it } from 'vitest';
import { findReport } from '../catalog';
import { buildCustomerAgeingRows, CUSTOMER_AGEING_REPORT } from './customer-ageing';
import { buildTableReportCsv } from './csv';
import { findTableReport } from './definitions';

describe('customer ageing report', () => {
  it('counts late days from the charge date plus the account credit days, 30 when none is set', () => {
    const lines = [
      { id: 'a', businessDate: '2026-10-01', direction: 'INCREASE' as const, amount: '10.0000' },
    ];
    const rows = buildCustomerAgeingRows(
      [
        { customer: 'No days set', accountReference: 'C-1', lines },
        { customer: 'Seven days', accountReference: 'C-2', creditDays: 7, lines },
      ],
      '2026-10-23',
    );
    expect(rows.find((row) => row.customer === 'No days set')).toMatchObject({
      current: '10.0000',
    });
    expect(rows.find((row) => row.customer === 'Seven days')).toMatchObject({
      days1to30: '10.0000',
    });
  });

  it('is registered as an exportable credit report', () => {
    expect(findTableReport('customer-ageing')).toBe(CUSTOMER_AGEING_REPORT);
    expect(findReport('customer-ageing')).toMatchObject({ category: 'credit', exportable: true });
  });

  it('lists only customers who owe, biggest debt first, in exact figures', () => {
    const rows = buildCustomerAgeingRows(
      [
        {
          customer: 'Zimbabwe Haulage',
          accountReference: 'C-2',
          creditDays: 0,
          lines: [
            { id: 'a', businessDate: '2026-06-01', direction: 'INCREASE', amount: '500.2500' },
          ],
        },
        {
          customer: 'Paid Up Ltd',
          accountReference: 'C-3',
          creditDays: 0,
          lines: [
            { id: 'b', businessDate: '2026-09-01', direction: 'INCREASE', amount: '80.0000' },
            { id: 'c', businessDate: '2026-09-02', direction: 'DECREASE', amount: '80.0000' },
          ],
        },
        {
          customer: 'Acme Transport',
          accountReference: 'C-1',
          creditDays: 0,
          lines: [
            { id: 'd', businessDate: '2026-10-20', direction: 'INCREASE', amount: '120.5000' },
            { id: 'e', businessDate: '2026-09-15', direction: 'INCREASE', amount: '10.0000' },
          ],
        },
      ],
      '2026-10-23',
    );
    expect(rows.map((row) => row.customer)).toEqual(['Zimbabwe Haulage', 'Acme Transport']);
    expect(rows[0]).toMatchObject({ over90: '500.2500', totalOwed: '500.2500', current: '0.0000' });
    expect(rows[1]).toMatchObject({
      days1to30: '120.5000',
      days31to60: '10.0000',
      totalOwed: '130.5000',
      oldestUnpaid: '2026-09-15',
    });
  });

  it('exports through the same CSV writer as the other reports', () => {
    const csv = buildTableReportCsv(
      CUSTOMER_AGEING_REPORT,
      buildCustomerAgeingRows(
        [
          {
            customer: '=SUM(A1)',
            accountReference: 'C-1',
            lines: [
              { id: 'a', businessDate: '2026-10-23', direction: 'INCREASE', amount: '1.0000' },
            ],
          },
        ],
        '2026-10-23',
      ),
    );
    expect(csv).toContain('Total owed (USD)');
    expect(csv.split('\r\n')[1]).toContain("'=SUM(A1)");
    expect(csv.split('\r\n')[1]).toContain(',1.0000,');
  });

  it('says plainly when nobody owes anything', () => {
    expect(buildCustomerAgeingRows([], '2026-10-23')).toEqual([]);
    expect(CUSTOMER_AGEING_REPORT.emptyMessage).toMatch(/no credit customer owes/i);
  });
});
