import type { CustomerAccountType, CustomerFuelValue, CustomerSourceReference } from './domain';
import type { BusinessDate, CurrencyCode, Money } from '../../platform/domain/primitives';
import { AppError } from '../../platform/errors';

/**
 * A5 remains authoritative for forecourt payment classification. A8 consumes
 * this future immutable evidence contract; it does not recalculate sales or
 * recreate reconciliation payment rows.
 */
export const A5_CUSTOMER_FUEL_CATEGORIES = ['CUSTOMER_CREDIT', 'PREPAID'] as const;
export type A5CustomerFuelCategory = (typeof A5_CUSTOMER_FUEL_CATEGORIES)[number];

export type A5CustomerFuelEvidence = Readonly<{
  eventType: 'a5.customer_fuel_allocation_posted.v1';
  eventVersion: 1;
  tenantId: string;
  stationId: string;
  reconciliationId: string;
  reconciliationRevisionId: string;
  paymentEvidenceId: string;
  category: A5CustomerFuelCategory;
  customerAccountReference: string;
  allocation: CustomerFuelValue;
  currency: CurrencyCode;
  businessDate: BusinessDate;
  occurredAt: string;
  source: CustomerSourceReference;
}>;

export function assertA5EvidenceCompatibleWithAccount(
  evidence: A5CustomerFuelEvidence,
  accountType: CustomerAccountType,
): void {
  if (evidence.category === 'CUSTOMER_CREDIT' && accountType !== 'CREDIT') {
    throw new AppError(
      'INVARIANT_VIOLATION',
      'A5 customer-credit evidence requires a credit account',
    );
  }
  if (evidence.category === 'PREPAID' && accountType === 'CREDIT') {
    throw new AppError('INVARIANT_VIOLATION', 'A5 prepaid evidence requires a prepaid account');
  }
  if (evidence.allocation.amount.currency !== evidence.currency) {
    throw new AppError('INVARIANT_VIOLATION', 'A5 evidence currency must match its allocation');
  }
}

export type CustomerFuelPostingRequest = Readonly<{
  accountId: string;
  accountType: CustomerAccountType;
  evidence: A5CustomerFuelEvidence;
  entryId: string;
  ledgerSource: CustomerSourceReference;
}>;

export type CustomerPaymentCommand = Readonly<{
  commandType: 'RecordCustomerPayment';
  accountId: string;
  amount: Money;
  source: CustomerSourceReference;
  occurredAt: string;
  businessDate: BusinessDate;
  note?: string;
}>;

export type PrepaidTopUpCommand = Readonly<{
  commandType: 'RecordPrepaidTopUp';
  accountId: string;
  accountType: 'PREPAID_VALUE' | 'PREPAID_LITRES';
  amount?: Money;
  productId?: string;
  litres?: CustomerFuelValue['litres'];
  source: CustomerSourceReference;
  occurredAt: string;
  businessDate: BusinessDate;
}>;

export type CustomerFuelAuthorizationCommand = Readonly<{
  commandType: 'RequestCustomerFuelAuthorization';
  authorizationId: string;
  accountId: string;
  stationId: string;
  requested: CustomerFuelValue;
  requestedBy: string;
  requestedAt: string;
  source: CustomerSourceReference;
}>;

export type CustomerFuelUsageCommand = Readonly<{
  commandType: 'CompleteCustomerFuelTransaction';
  authorizationId: string;
  accountId: string;
  used: CustomerFuelValue;
  entryId: string;
  fuelAllocationId: string;
  evidence: A5CustomerFuelEvidence;
  occurredAt: string;
  businessDate: BusinessDate;
}>;

export type CustomerAccountAuditActionCode =
  | 'CUSTOMER.CREATED'
  | 'CUSTOMER.ACCOUNT_CREATED'
  | 'CUSTOMER.LEGAL_ENTITY_SET'
  | 'CUSTOMER.ACCOUNT_STATIONS_SET'
  | 'CUSTOMER.FUEL_AUTHORIZATION_REQUESTED'
  | 'CUSTOMER.FUEL_AUTHORIZATION_RESERVED'
  | 'CUSTOMER.FUEL_TRANSACTION_POSTED'
  | 'CUSTOMER.PAYMENT_POSTED'
  | 'CUSTOMER.PREPAID_TOPUP_POSTED'
  | 'CUSTOMER.AUTHORIZATION_CANCELLED'
  | 'CUSTOMER.AUTHORIZATION_EXPIRED'
  | 'CUSTOMER.LEDGER_REVERSAL_POSTED'
  | 'CUSTOMER.UPDATED'
  | 'CUSTOMER.ACTIVATED'
  | 'CUSTOMER.DEACTIVATED'
  | 'CUSTOMER.ENTRY_DETAILS_RECORDED'
  | 'CUSTOMER.CREDIT_LIMIT_OVERRIDDEN';

export type CustomerAccountAuditEvent = Readonly<{
  eventId: string;
  tenantId: string;
  actorId: string;
  membershipId: string;
  requestId: string;
  actionCode: CustomerAccountAuditActionCode;
  subjectType: 'Customer' | 'CustomerAccount' | 'CustomerFuelAuthorization' | 'CustomerLedgerEntry';
  subjectId: string;
  source?: CustomerSourceReference;
  occurredAt: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
}>;
