export type CustomerProductBalance = {
  productId: string;
  productCode: string;
  productName: string;
  balanceLitres: string;
  availableLitres: string;
};

export type CustomerAccount = {
  accountId: string;
  accountType: 'CREDIT' | 'PREPAID_VALUE' | 'PREPAID_LITRES';
  status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
  version: number;
  legalEntityId: string | null;
  stationScope: 'ALL' | 'SELECTED';
  stationScopeConfigured: boolean;
  allowedStationIds: readonly string[];
  ready: boolean;
  currency: string;
  creditLimit: string | null;
  creditDays?: number | null;
  balance: string | null;
  availableBalance: string | null;
  availableCredit: string | null;
  reservedAmount: string;
  productBalances: readonly CustomerProductBalance[];
};

export type CustomerTransaction = {
  id: string;
  accountId: string;
  accountType: CustomerAccount['accountType'];
  entryType:
    | 'CREDIT_FUEL_CHARGE'
    | 'CUSTOMER_PAYMENT'
    | 'PREPAID_TOPUP'
    | 'PREPAID_FUEL_USAGE'
    | 'ADJUSTMENT'
    | 'REVERSAL';
  direction: 'INCREASE' | 'DECREASE';
  occurredAt: string;
  businessDate: string;
  amount: string | null;
  currency: string;
  litres: string | null;
  productId: string | null;
  productCode: string | null;
  productName: string | null;
  note: string | null;
};

export type CustomerCapabilities = {
  recordPayment: boolean;
  topUp: boolean;
  manageCustomer: boolean;
  openAccount: boolean;
};

export type CustomerSummary = {
  customerId: string;
  accountReference: string;
  displayName: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
  version: number;
  legalEntityId: string | null;
  legalEntityName: string | null;
  canManageConfiguration: boolean;
  capabilities: CustomerCapabilities;
  contactMetadata: Record<string, string>;
  accounts: readonly CustomerAccount[];
  recentTransactions: readonly CustomerTransaction[];
};

export type CustomerAccountsResponse = {
  customers: CustomerSummary[];
  capabilities?: CustomerCapabilities;
  /** Active fuels for prepaid-litres top-ups; only sent for a single-customer read. */
  fuelProducts?: Array<{ id: string; code: string; name: string }>;
};
