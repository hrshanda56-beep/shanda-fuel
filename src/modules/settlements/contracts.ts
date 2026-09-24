import type { ProviderSettlementState } from './domain';

export type ProviderType = 'CARD_ACQUIRER' | 'POS' | 'MOBILE_MONEY' | 'OTHER_ELECTRONIC';

export type ProviderSettlementSummaryRow = {
  settlementId: string;
  providerId: string;
  providerCode: string;
  providerName: string;
  providerAccountId: string;
  accountReference: string;
  stationId: string;
  settlementReference: string;
  batchReference: string | null;
  transactionDate: string;
  settlementDate: string;
  currency: string;
  grossAmount: string;
  allocatedAmount: string;
  unallocatedProviderAmount: string;
  expectedEvidenceAmount: string;
  unmatchedEvidenceAmount: string;
  providerFeeAmount: string | null;
  providerDeductionAmount: string | null;
  reportedNetAmount: string | null;
  varianceAmount: string;
  state: ProviderSettlementState;
  version: number;
};

export type UnmatchedProviderPaymentRow = {
  paymentId: string;
  stationId: string;
  reconciliationId: string;
  reconciliationState: string;
  businessDate: string;
  method: 'POS' | 'ECOCASH';
  amount: string;
  reference: string | null;
  allocatedAmount: string;
  unallocatedAmount: string;
};
