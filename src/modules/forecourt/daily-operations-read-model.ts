export type RecordData = {
  state: string;
  version: number;
  business_date: string;
  /** Customer accounts that may be charged at this station, with what they may still spend. */
  customerAccounts: Array<{
    id: string;
    name: string;
    accountType: 'CREDIT' | 'PREPAID_VALUE';
    available: string;
  }>;
  attendants: Array<{ attendantId: string }>;
  readings: Array<{
    id: string;
    nozzleId: string;
    productId: string;
    shiftId: string;
    openingReading: string;
    closingReading: string;
    sellingPriceId: string;
    unitPrice: string;
    litresSold: string;
    salesValue: string;
  }>;
  payments: Array<{
    id: string;
    method: string;
    amount: string;
    reference: string | null;
    note: string | null;
    customerAccountId: string | null;
    beneficiaryName: string | null;
  }>;
  expenses: Array<{
    id: string;
    category: string;
    description: string;
    amount: string;
    paymentMethod: string;
    personPaid: string | null;
    reference: string | null;
  }>;
  deliveries: Array<{
    deliveryId: string;
    deliveryNoteNumber: string;
    actualQuantityLitres: string;
  }>;
  dips: Array<{ dipId: string; tankId: string; physicalLitres: string }>;
  /** Every active tank at the station, so each one is listed even before it has a dip or a tolerance. */
  tanks: Array<{
    tankId: string;
    code: string;
    productId: string;
    productName: string;
    capacityLitres: string;
    toleranceLitres: string | null;
    /** Dipstick readings in millimetres can be turned into litres. */
    hasMillimetreChart: boolean;
  }>;
  cash: {
    countedCash: string;
    expectedPhysicalCash: string;
    cashPaidExpenses: string;
    netExpectedCash: string;
    cashVariance: string;
  } | null;
  explanations: Array<{ category: string; explanation: string }>;
  totals: {
    expectedSales: string;
    accountedSales: string;
    salesVariance: string;
    cashVariance: string | null;
    stockVariance: Record<string, string>;
  };
};
