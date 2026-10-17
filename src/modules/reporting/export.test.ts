import { describe, expect, it } from 'vitest';
import { serializeManagementReportCsv } from './export';
import type { ManagementReport } from './contracts';

describe('management report CSV export', () => {
  it('preserves exact decimal strings and emits deterministic field/value rows', () => {
    const report = {
      report: 'MANAGEMENT_OVERVIEW',
      state: 'POSTED',
      currency: 'USD',
      filters: {
        tenantId: 'tenant-1',
        fromDate: '2026-10-17',
        toDate: '2026-10-17',
      },
      dateBasis: {
        sales: 'A5 business date',
        recognizedRevenue: 'REV1 sale_recognition_movements.business_date',
        cashEvidence: 'A5 business date',
        cashCollections: 'A6 cash_collections.business_date',
        bankedCash: 'A6 bank_deposits.deposited_at UTC calendar date',
        providerEvidence: 'A5 business date',
        providerSettlements: 'A9 settlement date',
        suppliers: 'A7 effective_date <= toDate; balance as of toDate',
        customers:
          'A8 balance as of toDate using ledger business_date and authorization requested_at',
        inventory: 'A4 movement business date and latest dip measured_at as of toDate',
        expenses: 'A5 business date',
      },
      stations: [],
      sales: {
        litresSold: '0.000',
        salesValue: '0.0000',
        salesVariance: '0.0000',
        approvedReconciliationCount: 0,
        rows: [],
        payments: [],
        reconciliationIds: [],
      },
      cash: {
        cashEvidence: '0.0000',
        collected: '0.0000',
        awaitingCollection: '0.0000',
        banked: '0.0000',
        collectedButNotBanked: '0.0000',
        cashVariance: '0.0000',
        collectionIds: [],
        depositIds: [],
      },
      providers: {
        paymentEvidence: '0.0000',
        settlementGross: '0.0000',
        allocatedAmount: '0.0000',
        unallocatedProviderAmount: '0.0000',
        unmatchedEvidenceAmount: '0.0000',
        settlementVariance: '0.0000',
        feesAndDeductions: '0.0000',
        rows: [],
      },
      suppliers: {
        invoiceValue: '0.0000',
        creditNoteValue: '0.0000',
        payments: '0.0000',
        outstandingBalance: '0.0000',
        rows: [],
      },
      customers: {
        availability: 'UNAVAILABLE_STATION_DIMENSION',
        receivableBalance: null,
        prepaidValueBalance: null,
        reservedAmount: null,
        reservedLitres: null,
        rows: [],
      },
      inventory: {
        expectedLitres: '0.000',
        physicalLitres: '0.000',
        varianceLitres: '0.000',
        deliveryLitres: '0.000',
        deliveryValue: '0.0000',
        rows: [],
      },
      expenses: { total: '0.0000', rows: [] },
      revenue: {
        currency: 'USD',
        revenueStatus: 'NO_SALES',
        recognizedRevenue: '0.0000',
        saleCount: 0,
        sales: [],
      },
      costing: {
        currency: 'USD',
        costingStatus: 'UNVALUED',
        originalCogs: null,
        revaluationDelta: null,
        restatedCogs: null,
        saleCount: 0,
        valuedSaleCount: 0,
        unvaluedSaleCount: 0,
        sales: [],
      },
      grossMargin: null,
    } satisfies ManagementReport;
    const csv = serializeManagementReportCsv(report, {
      generatedAt: '2026-10-17T12:34:56.000Z',
    });

    expect(csv).toContain('metadata.exportFormat,management-report-csv.v1');
    expect(csv).toContain('metadata.generatedAt,2026-10-17T12:34:56.000Z');
    expect(csv).toContain('metadata.scopeType,TENANT');
    expect(csv).toContain('metadata.tenantId,tenant-1');
    expect(csv).toContain('metadata.emptyReport,true');
    expect(csv).toContain('metadata.sourceLineage.sales.dateBasis,A5 business date');
    expect(csv).toContain('metadata.sourceLineage.cash.collectionIds,');
    expect(csv).toContain('sales.salesValue,0.0000');
    expect(csv).toContain('dateBasis.suppliers,A7 effective_date <= toDate; balance as of toDate');
    expect(csv.endsWith('\n')).toBe(true);
  });

  it('canonicalizes timestamps and rejects invalid export metadata', () => {
    const report = {
      report: 'MANAGEMENT_OVERVIEW',
      state: 'POSTED',
      currency: 'USD',
      filters: { tenantId: 'tenant-1', fromDate: '2026-10-17', toDate: '2026-10-17' },
      dateBasis: {
        sales: 'A5 business date',
        recognizedRevenue: 'REV1 sale_recognition_movements.business_date',
        cashEvidence: 'A5 business date',
        cashCollections: 'A6 cash_collections.business_date',
        bankedCash: 'A6 bank_deposits.deposited_at UTC calendar date',
        providerEvidence: 'A5 business date',
        providerSettlements: 'A9 settlement date',
        suppliers: 'A7 effective_date <= toDate; balance as of toDate',
        customers:
          'A8 balance as of toDate using ledger business_date and authorization requested_at',
        inventory: 'A4 movement business date and latest dip measured_at as of toDate',
        expenses: 'A5 business date',
      },
      stations: [],
      sales: {
        litresSold: '0',
        salesValue: '0',
        salesVariance: '0',
        approvedReconciliationCount: 0,
        rows: [],
        payments: [],
        reconciliationIds: [],
      },
      cash: {
        cashEvidence: '0',
        collected: '0',
        awaitingCollection: '0',
        banked: '0',
        collectedButNotBanked: '0',
        cashVariance: '0',
        collectionIds: [],
        depositIds: [],
      },
      providers: {
        paymentEvidence: '0',
        settlementGross: '0',
        allocatedAmount: '0',
        unallocatedProviderAmount: '0',
        unmatchedEvidenceAmount: '0',
        settlementVariance: '0',
        feesAndDeductions: '0',
        rows: [],
      },
      suppliers: {
        invoiceValue: '0',
        creditNoteValue: '0',
        payments: '0',
        outstandingBalance: '0',
        rows: [],
      },
      customers: {
        availability: 'AVAILABLE',
        receivableBalance: '0',
        prepaidValueBalance: '0',
        reservedAmount: '0',
        reservedLitres: '0',
        rows: [],
      },
      inventory: {
        expectedLitres: '0',
        physicalLitres: '0',
        varianceLitres: '0',
        deliveryLitres: '0',
        deliveryValue: '0',
        rows: [],
      },
      expenses: { total: '0', rows: [] },
      revenue: {
        currency: 'USD',
        revenueStatus: 'NO_SALES',
        recognizedRevenue: '0',
        saleCount: 0,
        sales: [],
      },
      costing: {
        currency: 'USD',
        costingStatus: 'UNVALUED',
        originalCogs: null,
        revaluationDelta: null,
        restatedCogs: null,
        saleCount: 0,
        valuedSaleCount: 0,
        unvaluedSaleCount: 0,
        sales: [],
      },
      grossMargin: null,
    } satisfies ManagementReport;

    expect(
      serializeManagementReportCsv(report, { generatedAt: '2026-10-17T12:34:56+02:00' }),
    ).toContain('metadata.generatedAt,2026-10-17T10:34:56.000Z');
    expect(() => serializeManagementReportCsv(report, { generatedAt: 'not-a-timestamp' })).toThrow(
      'generatedAt must be a valid ISO timestamp',
    );
  });
});
