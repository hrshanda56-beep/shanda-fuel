import type { CurrencyCode, Money } from '../../platform/domain/primitives';
import type { CashMovementType, ProviderSettlementCalculation } from './domain';

export type CashMovementPostedEvent = {
  eventType: 'cash.movement_posted.v1';
  eventVersion: 1;
  eventId: string;
  tenantId: string;
  legalEntityId: string;
  stationId: string;
  movementId: string;
  movementType: CashMovementType;
  amount: Money;
  fromLocationId?: string;
  toLocationId?: string;
  sourceType: string;
  sourceId: string;
  effectiveAt: string;
  postedAt: string;
};

export type CashHandoverSubmittedEvent = {
  eventType: 'cash.handover_submitted.v1';
  eventVersion: 1;
  eventId: string;
  tenantId: string;
  legalEntityId: string;
  stationId: string;
  handoverId: string;
  fromLocationId: string;
  toLocationId: string;
  expectedAmount: Money;
  countedAmount: Money;
  variance: Money;
  disputed: boolean;
  submittedAt: string;
};

export type CashCollectionRecordedEvent = {
  eventType: 'cash.collection_recorded.v1';
  eventVersion: 1;
  eventId: string;
  tenantId: string;
  legalEntityId: string;
  stationId: string;
  collectionId: string;
  amount: Money;
  sourceReconciliationIds: readonly string[];
  recordedAt: string;
};

export type CashCollectionReceivedEvent = {
  eventType: 'cash.collection_received.v1';
  eventVersion: 1;
  eventId: string;
  tenantId: string;
  legalEntityId: string;
  stationId: string;
  collectionId: string;
  fromLocationId: string;
  toLocationId: string;
  receivedAt: string;
};

export type BankDepositRecordedEvent = {
  eventType: 'bank.deposit_recorded.v1';
  eventVersion: 1;
  eventId: string;
  tenantId: string;
  legalEntityId: string;
  stationId: string;
  depositId: string;
  sourceLocationId: string;
  bankAccountId: string;
  amount: Money;
  depositReference: string;
  depositedAt: string;
  recordedAt: string;
};

export type BankDepositConfirmedEvent = {
  eventType: 'bank.deposit_confirmed.v1';
  eventVersion: 1;
  eventId: string;
  tenantId: string;
  legalEntityId: string;
  stationId: string;
  depositId: string;
  bankAccountId: string;
  depositedAmount: Money;
  confirmedAmount: Money;
  variance: Money;
  bankReference: string;
  confirmedAt: string;
};

export type BankDepositCreatedEvent = {
  eventType: 'bank.deposit_created.v1';
  eventVersion: 1;
  eventId: string;
  tenantId: string;
  legalEntityId: string;
  stationId: string;
  depositId: string;
  amount: Money;
  collectionIds: readonly string[];
  depositReference: string;
  createdAt: string;
};

export type ProviderSettlementPostedEvent = {
  eventType: 'provider.settlement_posted.v1';
  eventVersion: 1;
  eventId: string;
  tenantId: string;
  legalEntityId: string;
  stationId: string;
  providerBatchId: string;
  calculation: ProviderSettlementCalculation;
  currency: CurrencyCode;
  settledAt: string;
};
