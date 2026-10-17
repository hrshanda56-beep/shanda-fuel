import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../../../platform/errors';
import type { ManagementReport } from '../../../../../modules/reporting/contracts';

const mocks = vi.hoisted(() => ({
  getManagementReport: vi.fn(),
}));

vi.mock('../../../../../modules/reporting/queries', () => ({
  getManagementReportFromRequest: mocks.getManagementReport,
}));

import { GET } from './route';

const tenantId = '11111111-1111-4111-8111-111111111111';
const stationId = '22222222-2222-4222-8222-222222222222';

function emptyReport(overrides: Partial<ManagementReport['filters']> = {}): ManagementReport {
  return {
    report: 'MANAGEMENT_OVERVIEW',
    state: 'POSTED',
    currency: 'USD',
    filters: {
      tenantId,
      fromDate: '2026-10-17',
      toDate: '2026-10-17',
      ...overrides,
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
      litresSold: '0',
      salesValue: '0',
      salesVariance: '0',
      approvedReconciliationCount: 0,
      payments: [],
      rows: [],
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
  };
}

describe('GET /api/reports/management/export', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getManagementReport.mockResolvedValue(emptyReport({ stationId }));
  });

  it('returns an auditable empty CSV with scope and generated metadata', async () => {
    const response = await GET(
      new Request(
        `https://fuel.example.test/api/reports/management/export?tenantId=${tenantId}&stationId=${stationId}&fromDate=2026-10-17&toDate=2026-10-17`,
      ),
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Content-Type')).toContain('text/csv');
    expect(response.headers.get('Content-Disposition')).toBe(
      'attachment; filename="management-report-20261017.csv"',
    );
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('X-Report-Empty')).toBe('true');
    expect(response.headers.get('X-Report-Scope')).toBe('STATION');
    expect(response.headers.get('X-Report-Generated-At')).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body).toContain('metadata.scopeType,STATION');
    expect(body).toContain(`metadata.tenantId,${tenantId}`);
    expect(body).toContain(`metadata.stationId,${stationId}`);
    expect(body).toContain('metadata.emptyReport,true');
    expect(mocks.getManagementReport).toHaveBeenCalledWith(
      expect.any(Request),
      { tenantId, stationId, fromDate: '2026-10-17', toDate: '2026-10-17' },
      { permissionCode: 'report.export' },
    );
  });

  it('returns the standard API error response when report generation fails', async () => {
    mocks.getManagementReport.mockRejectedValue(
      new AppError('FORBIDDEN', 'Report export is not authorized'),
    );

    const response = await GET(
      new Request(
        `https://fuel.example.test/api/reports/management/export?tenantId=${tenantId}&fromDate=2026-10-17&toDate=2026-10-17`,
      ),
    );

    expect(response.status).toBe(403);
    expect(response.headers.get('Content-Type')).toContain('application/json');
    expect(await response.json()).toMatchObject({
      error: 'FORBIDDEN',
      message: 'Report export is not authorized',
    });
  });
});
