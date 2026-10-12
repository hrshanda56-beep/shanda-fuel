import { z } from 'zod';
import { normalizeStationIds } from './domain';
import type { CanonicalRevenueReport, RestatedCogsReport } from '../profitability/contracts';

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'A date must use YYYY-MM-DD');

export const managementReportQuerySchema = z
  .object({
    tenantId: z.string().uuid(),
    /** Single station; kept so existing links keep working. */
    stationId: z.string().uuid().optional(),
    /** One or more stations, as an array or a comma-separated list. Empty means all. */
    stationIds: z.preprocess(
      (value) =>
        typeof value === 'string'
          ? value
              .split(',')
              .map((part) => part.trim())
              .filter(Boolean)
          : value,
      z.array(z.string().uuid()).max(100).optional(),
    ),
    fromDate: dateOnly.optional(),
    toDate: dateOnly.optional(),
  })
  .superRefine((value, context) => {
    if (value.fromDate && value.toDate && value.fromDate > value.toDate) {
      context.addIssue({
        code: 'custom',
        path: ['fromDate'],
        message: 'fromDate must not be after toDate',
      });
    }
  })
  .transform(({ stationId: _single, stationIds, ...rest }) => {
    return { ...rest, stationIds: normalizeStationIds(_single, stationIds) };
  });

export type ManagementReportQuery = z.output<typeof managementReportQuerySchema> & {
  fromDate: string;
  toDate: string;
};

export type ReportDateBasis = {
  sales: 'A5 business date';
  recognizedRevenue: 'REV1 sale_recognition_movements.business_date';
  cashEvidence: 'A5 business date';
  cashCollections: 'A6 cash_collections.business_date';
  bankedCash: 'A6 bank_deposits.deposited_at UTC calendar date';
  providerEvidence: 'A5 business date';
  providerSettlements: 'A9 settlement date';
  suppliers: 'A7 effective_date <= toDate; balance as of toDate';
  customers: 'A8 balance as of toDate using ledger business_date and authorization requested_at';
  inventory: 'A4 movement business date and latest dip measured_at as of toDate';
  expenses: 'A5 business date';
};

export type ReportMoney = string;
export type ReportLitres = string;

export type ReportStation = Readonly<{
  stationId: string;
  code: string;
  name: string;
}>;

export type SalesPaymentRow = Readonly<{
  method: string;
  amount: ReportMoney;
  evidenceIds: readonly string[];
}>;

export type SalesBreakdownRow = Readonly<{
  businessDate: string;
  stationId: string;
  stationCode: string;
  productId: string;
  productCode: string;
  productName: string;
  litres: ReportLitres;
  salesValue: ReportMoney;
  averageRealizedPrice: ReportMoney | null;
  variance: ReportMoney;
  reconciliationIds: readonly string[];
}>;

export type CashPosition = Readonly<{
  cashEvidence: ReportMoney;
  collected: ReportMoney;
  awaitingCollection: ReportMoney;
  banked: ReportMoney;
  collectedButNotBanked: ReportMoney;
  cashVariance: ReportMoney;
  collectionIds: readonly string[];
  depositIds: readonly string[];
}>;

export type ProviderPosition = Readonly<{
  paymentEvidence: ReportMoney;
  settlementGross: ReportMoney;
  allocatedAmount: ReportMoney;
  unallocatedProviderAmount: ReportMoney;
  unmatchedEvidenceAmount: ReportMoney;
  settlementVariance: ReportMoney;
  feesAndDeductions: ReportMoney;
  rows: readonly {
    settlementId: string;
    providerId: string;
    providerName: string;
    stationId: string;
    transactionDate: string;
    settlementDate: string;
    settlementReference: string;
    grossAmount: ReportMoney;
    allocatedAmount: ReportMoney;
    unallocatedAmount: ReportMoney;
    feesAndDeductions: ReportMoney;
    variance: ReportMoney;
  }[];
}>;

export type SupplierExposure = Readonly<{
  invoiceValue: ReportMoney;
  creditNoteValue: ReportMoney;
  payments: ReportMoney;
  outstandingBalance: ReportMoney;
  rows: readonly {
    supplierId: string;
    supplierCode: string;
    supplierName: string;
    invoiceValue: ReportMoney;
    creditNoteValue: ReportMoney;
    payments: ReportMoney;
    outstandingBalance: ReportMoney;
  }[];
}>;

export type CustomerCreditActivityRow = Readonly<{
  stationId: string;
  accountType: string;
  drawnAmount: ReportMoney;
  drawnLitres: ReportLitres;
  authorizationCount: number;
}>;

export type CustomerExposure = Readonly<{
  /** Applies to the balance and reservation figures only; `activity` is always available. */
  availability: 'AVAILABLE' | 'UNAVAILABLE_STATION_DIMENSION';
  /** Fuel drawn on customer accounts in the period, by the station where it was drawn. */
  activity: readonly CustomerCreditActivityRow[];
  receivableBalance: ReportMoney | null;
  prepaidValueBalance: ReportMoney | null;
  reservedAmount: ReportMoney | null;
  reservedLitres: ReportLitres | null;
  rows: readonly {
    customerId: string;
    accountReference: string;
    displayName: string;
    receivableBalance: ReportMoney;
    prepaidValueBalance: ReportMoney;
    reservedAmount: ReportMoney;
    reservedLitres: ReportLitres;
  }[];
}>;

export type InventoryPosition = Readonly<{
  expectedLitres: ReportLitres;
  physicalLitres: ReportLitres | null;
  varianceLitres: ReportLitres | null;
  deliveryLitres: ReportLitres;
  deliveryValue: ReportMoney;
  rows: readonly {
    stationId: string;
    tankId: string;
    tankCode: string;
    productId: string;
    productCode: string;
    productName: string;
    expectedLitres: ReportLitres;
    physicalLitres: ReportLitres | null;
    varianceLitres: ReportLitres | null;
    deliveryLitres: ReportLitres;
    deliveryValue: ReportMoney;
    movementIds: readonly string[];
    deliveryIds: readonly string[];
  }[];
}>;

export type ManagementReport = Readonly<{
  report: 'MANAGEMENT_OVERVIEW';
  state: 'POSTED';
  currency: 'USD';
  filters: Readonly<{
    tenantId: string;
    /** Stations covered; empty means every station. */
    stationIds: readonly string[];
    fromDate: string;
    toDate: string;
  }>;
  dateBasis: ReportDateBasis;
  stations: readonly ReportStation[];
  sales: Readonly<{
    litresSold: ReportLitres;
    salesValue: ReportMoney;
    approvedReconciliationCount: number;
    salesVariance: ReportMoney;
    payments: readonly SalesPaymentRow[];
    rows: readonly SalesBreakdownRow[];
    reconciliationIds: readonly string[];
  }>;
  cash: CashPosition;
  providers: ProviderPosition;
  suppliers: SupplierExposure;
  customers: CustomerExposure;
  inventory: InventoryPosition;
  expenses: Readonly<{
    total: ReportMoney;
    rows: readonly {
      businessDate: string;
      stationId: string;
      category: string;
      amount: ReportMoney;
      expenseIds: readonly string[];
    }[];
  }>;
  revenue: CanonicalRevenueReport;
  costing: RestatedCogsReport;
  grossMargin: ReportMoney | null;
}>;

export type DailyOperationsRow = Readonly<{
  reportDate: string;
  stationId: string;
  stationCode: string;
  litresSold: ReportLitres;
  salesValue: ReportMoney;
  paymentBreakdown: readonly SalesPaymentRow[];
  cashDeclared: ReportMoney;
  cashVariance: ReportMoney;
  collectedCash: ReportMoney;
  bankedCash: ReportMoney;
  providerEvidence: ReportMoney;
  providerSettledAmount: ReportMoney;
  providerOutstandingAmount: ReportMoney;
  recordedExpenses: ReportMoney;
  inventoryVariance: ReportLitres | null;
  deliveryLitres: ReportLitres;
  customerCreditEvidence: ReportMoney;
  prepaidEvidence: ReportMoney;
  reconciliationIds: readonly string[];
  collectionIds: readonly string[];
  depositIds: readonly string[];
  settlementIds: readonly string[];
  deliveryIds: readonly string[];
}>;
