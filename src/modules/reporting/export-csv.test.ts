import { describe, expect, it } from 'vitest';
import type { ManagementReport } from './contracts';
import { buildReportCsv, csvCell, reportCsvFilename } from './export-csv';

const STATION = '11111111-1111-4111-8111-111111111111';

function report(overrides: Record<string, unknown> = {}): ManagementReport {
  return {
    filters: { tenantId: 't', stationIds: [], fromDate: '2026-10-01', toDate: '2026-10-31' },
    stations: [{ stationId: STATION, code: 'BIN', name: 'Bindura' }],
    sales: { rows: [] },
    cash: {
      cashEvidence: '100.1000',
      collected: '90.0000',
      awaitingCollection: '10.1000',
      banked: '50.0000',
      collectedButNotBanked: '40.0000',
      cashVariance: '-0.0001',
    },
    providers: { rows: [] },
    suppliers: { rows: [] },
    customers: { rows: [], activity: [] },
    inventory: { rows: [] },
    ...overrides,
  } as unknown as ManagementReport;
}

describe('csvCell', () => {
  it('quotes commas, quotes and newlines', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('neutralises spreadsheet formulas in text but never alters numbers', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell('-5', 'number')).toBe('-5');
    expect(csvCell('-0.0001', 'number')).toBe('-0.0001');
  });
});

describe('buildReportCsv', () => {
  it('exports an empty report as the heading row alone', () => {
    expect(buildReportCsv('sales', report())).toBe(
      'business_date,station_code,product_code,product_name,litres_sold,sales_value,average_realized_price,variance\r\n',
    );
  });

  it('preserves authoritative precision and nulls', () => {
    const csv = buildReportCsv(
      'sales',
      report({
        sales: {
          rows: [
            {
              businessDate: '2026-10-02',
              stationCode: 'BIN',
              productCode: 'ULP',
              productName: 'Unleaded, 95',
              litres: '1234.5670',
              salesValue: '1245.5000',
              averageRealizedPrice: null,
              variance: '-0.0100',
            },
          ],
        },
      }),
    );
    expect(csv.split('\r\n')[1]).toBe(
      '2026-10-02,BIN,ULP,"Unleaded, 95",1234.5670,1245.5000,,-0.0100',
    );
  });

  it('exports the cash position with exact values', () => {
    const lines = buildReportCsv('cash', report()).split('\r\n');
    expect(lines[0]).toBe('measure,amount');
    expect(lines).toContain('cash_evidence,100.1000');
    expect(lines).toContain('cash_variance,-0.0001');
  });

  it('exports the cash movement statement with its existing exact figures', () => {
    const csv = buildReportCsv(
      'cash-movement',
      report({
        providers: {
          paymentEvidence: '12.0000',
          settlementGross: '10.0000',
          feesAndDeductions: '0.5000',
          unallocatedProviderAmount: '1.0000',
          unmatchedEvidenceAmount: '0.5000',
        },
        suppliers: { payments: '3.0000' },
      }),
    );
    expect(csv).toContain('provider_payment_evidence,12.0000');
    expect(csv).toContain('supplier_payments,3.0000');
  });

  it('exports the net position inputs, leaving unavailable customer figures blank', () => {
    const csv = buildReportCsv(
      'net-position',
      report({
        cash: { collectedButNotBanked: '10.0000' },
        providers: { unmatchedEvidenceAmount: '2.5000' },
        suppliers: { outstandingBalance: '4.0000' },
        customers: { receivableBalance: null, prepaidValueBalance: null },
      }),
    );
    expect(csv).toContain('cash_collected_not_banked,10.0000');
    expect(csv).toContain('owed_to_suppliers,4.0000');
    expect(csv).toMatch(/owed_by_credit_customers,\r?\n/);
  });

  it('maps station ids to codes for providers and inventory', () => {
    const providers = buildReportCsv(
      'providers',
      report({
        providers: {
          rows: [
            {
              settlementReference: 'REF-1',
              providerName: 'EcoCash',
              stationId: STATION,
              transactionDate: '2026-10-01',
              settlementDate: '2026-10-02',
              grossAmount: '10.0000',
              allocatedAmount: '9.0000',
              unallocatedAmount: '1.0000',
              feesAndDeductions: '0.1000',
              variance: '0.0000',
            },
          ],
        },
      }),
    );
    expect(providers.split('\r\n')[1]).toContain(',BIN,');
    const inventory = buildReportCsv(
      'inventory',
      report({
        inventory: {
          rows: [
            {
              stationId: STATION,
              tankCode: 'T1',
              productCode: 'ULP',
              productName: 'Unleaded',
              expectedLitres: '100.000',
              physicalLitres: null,
              varianceLitres: null,
              deliveryLitres: '0.000',
              deliveryValue: '0.0000',
            },
          ],
        },
      }),
    );
    expect(inventory.split('\r\n')[1]).toBe(
      'BIN,T1,ULP,Unleaded,100.000,,,0.000,0.0000,2026-10-31',
    );
  });

  it('keeps suppliers, customer balances and credit drawn in one stable table', () => {
    const csv = buildReportCsv(
      'commercial',
      report({
        suppliers: {
          rows: [
            {
              supplierCode: 'S1',
              supplierName: 'Fuel Co',
              invoiceValue: '5.0000',
              creditNoteValue: '0.0000',
              payments: '1.0000',
              outstandingBalance: '4.0000',
            },
          ],
        },
        customers: {
          rows: [],
          activity: [
            {
              stationId: STATION,
              accountType: 'CREDIT',
              drawnAmount: '20.0000',
              drawnLitres: '10.000',
              authorizationCount: 2,
            },
          ],
        },
      }),
    );
    const [header, supplier, drawn] = csv.split('\r\n');
    expect(header?.split(',')).toHaveLength(15);
    expect(supplier).toBe('SUPPLIER,S1,Fuel Co,,5.0000,0.0000,1.0000,4.0000,,,,,,,');
    expect(drawn).toBe('CUSTOMER_CREDIT_DRAWN,CREDIT,,BIN,,,,,,,,,20.0000,10.000,2');
  });

  it('rejects an unknown report', () => {
    expect(() => buildReportCsv('nope', report())).toThrow();
  });

  it('exports profit/loss summary, fuel profit and expense lineage', () => {
    const csv = buildReportCsv(
      'profit-loss',
      report({
        revenue: {
          recognizedRevenue: '10.0000',
          revenueStatus: 'POSTED',
          sales: [{ revenueMovementId: 'rev-1' }],
        },
        costing: {
          restatedCogs: '6.0000',
          costingStatus: 'COMPLETE',
          sales: [{ saleMovementId: 'cogs-1' }],
        },
        grossMargin: '4.0000',
        expenses: {
          total: '1.0000',
          operatingTotal: '1.0000',
          fixedCostTotal: '0.0000',
          directInventoryCostTotal: '0.0000',
          rows: [
            {
              businessDate: '2026-10-01',
              stationId: STATION,
              category: 'RENT',
              classification: 'OPERATING',
              amount: '1.0000',
              expenseIds: ['expense-1'],
              recurringRecognitionIds: [],
              sourceIds: ['expense-1'],
              recognitionMovementIds: ['movement-1'],
            },
          ],
        },
        fuelProfit: [
          {
            productId: 'p',
            productCode: 'PMS',
            productName: 'Petrol',
            litres: '1.000',
            revenue: '10.0000',
            cost: '6.0000',
            profit: '4.0000',
            status: 'COMPLETE',
            saleCount: 1,
            valuedSaleCount: 1,
            unvaluedSaleCount: 0,
            revenueMovementIds: ['rev-1'],
            costMovementIds: ['cogs-1'],
          },
        ],
      }),
    );
    expect(csv).toContain('SUMMARY,Gross profit');
    expect(csv).toContain('SUMMARY,Net operating result');
    expect(csv).toContain('FUEL,Fuel profit');
    expect(csv).toContain('EXPENSE,Recognized expense,2026-10-01,BIN,RENT');
    expect(csv).toContain('rev-1;cogs-1');
  });
});

describe('reportCsvFilename', () => {
  it('names the report and range, marking a station subset', () => {
    expect(reportCsvFilename('sales', '2026-10-01', '2026-10-31', 0)).toBe(
      'sales_2026-10-01_to_2026-10-31.csv',
    );
    expect(reportCsvFilename('cash', '2026-10-01', '2026-10-31', 1)).toBe(
      'cash_2026-10-01_to_2026-10-31_1-station.csv',
    );
    expect(reportCsvFilename('cash', '2026-10-01', '2026-10-31', 3)).toBe(
      'cash_2026-10-01_to_2026-10-31_3-stations.csv',
    );
  });
});
