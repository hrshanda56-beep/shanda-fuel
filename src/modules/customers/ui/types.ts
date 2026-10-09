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
  allowedStationIds: string[];
  ready: boolean;
  currency: string;
  creditLimit: string | null;
  balance: string | null;
  availableBalance: string | null;
  availableCredit: string | null;
  reservedAmount: string;
  productBalances: CustomerProductBalance[];
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

export type CustomerSummary = {
  customerId: string;
  accountReference: string;
  displayName: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
  version: number;
  legalEntityId: string | null;
  legalEntityName: string | null;
  canManageConfiguration: boolean;
  contactMetadata: Record<string, string>;
  accounts: CustomerAccount[];
  recentTransactions: CustomerTransaction[];
};

export type CustomerAccountsResponse = {
  customers: CustomerSummary[];
};
