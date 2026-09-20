import type { CurrencyCode, Money } from '../../platform/domain/primitives';
import type { MeterSegment, ReconciliationRevision } from './domain';

export type MeterSegmentSealedEvent = {
  eventType: 'forecourt.meter_segment_sealed.v1';
  eventVersion: 1;
  eventId: string;
  tenantId: string;
  legalEntityId: string;
  stationId: string;
  businessDayId: string;
  businessDate: string;
  shiftId: string;
  segmentId: string;
  nozzleId: string;
  meterInstallationId: string;
  productId: string;
  attendantId: string;
  enteredBy: string;
  onBehalfOf?: string;
  openingReading: string;
  closingReading: string;
  litres: string;
  unitPrice: string;
  expectedSaleValue: Money;
  currency: CurrencyCode;
  sealedAt: string;
  occurredAt: string;
  correctionOfSegmentId?: string;
};

export type DeclarationTotalSnapshot = {
  category: string;
  amount: Money;
};

export type ReconciliationApprovedEvent = {
  eventType: 'reconciliation.approved.v1';
  eventVersion: 1;
  eventId: string;
  tenantId: string;
  legalEntityId: string;
  stationId: string;
  businessDayId: string;
  businessDate: string;
  reconciliationId: string;
  revisionId: string;
  revision: number;
  expectedSales: Money;
  accountedSales: Money;
  variance: Money;
  varianceClassification: string;
  varianceExplanation?: string;
  declarationTotals: readonly DeclarationTotalSnapshot[];
  approvedBy: string;
  occurredAt: string;
};

export type ReconciliationPostedEvent = Omit<ReconciliationApprovedEvent, 'eventType'> & {
  eventType: 'reconciliation.posted.v1';
  postedBy: string;
  postedAt: string;
};

export type BusinessDayLockedEvent = {
  eventType: 'forecourt.business_day_locked.v1';
  eventVersion: 1;
  eventId: string;
  tenantId: string;
  legalEntityId: string;
  stationId: string;
  businessDayId: string;
  businessDate: string;
  lockedAt: string;
  occurredAt: string;
};

export type PriceBoundaryActivatedEvent = {
  eventType: 'forecourt.price_boundary_activated.v1';
  eventId: string;
  tenantId: string;
  stationId: string;
  priceId: string;
  productId: string;
  effectiveFrom: string;
  unitPrice: string;
  currency: CurrencyCode;
};

export type ForecourtEvent =
  | MeterSegmentSealedEvent
  | ReconciliationApprovedEvent
  | ReconciliationPostedEvent
  | BusinessDayLockedEvent
  | PriceBoundaryActivatedEvent;

export function meterSegmentSealedEvent(
  eventId: string,
  segment: MeterSegment,
  input: { legalEntityId: string; businessDate: string; occurredAt?: string },
): MeterSegmentSealedEvent {
  return {
    eventType: 'forecourt.meter_segment_sealed.v1',
    eventVersion: 1,
    eventId,
    tenantId: segment.tenantId,
    legalEntityId: input.legalEntityId,
    stationId: segment.stationId,
    businessDayId: segment.businessDayId,
    businessDate: input.businessDate,
    shiftId: segment.shiftId,
    segmentId: segment.id,
    nozzleId: segment.nozzleId,
    meterInstallationId: segment.meterInstallationId,
    productId: segment.productId,
    attendantId: segment.attendantId,
    enteredBy: segment.enteredBy,
    ...(segment.onBehalfOf ? { onBehalfOf: segment.onBehalfOf } : {}),
    openingReading: segment.openingReading,
    closingReading: segment.closingReading,
    litres: segment.litres.toString(),
    unitPrice: segment.unitPrice.toString(),
    expectedSaleValue: segment.expectedSaleValue,
    currency: segment.currency,
    sealedAt: segment.sealedAt,
    occurredAt: input.occurredAt ?? segment.sealedAt,
  };
}

export function reconciliationApprovedEvent(
  eventId: string,
  revision: ReconciliationRevision,
  input: { legalEntityId: string; businessDate: string; occurredAt?: string },
): ReconciliationApprovedEvent {
  if (revision.state !== 'APPROVED') {
    throw new Error('Only an approved reconciliation revision can publish an approval event');
  }
  if (!revision.approvedBy) throw new Error('Approved reconciliation requires an approver');
  return {
    eventType: 'reconciliation.approved.v1',
    eventVersion: 1,
    eventId,
    tenantId: revision.tenantId,
    legalEntityId: input.legalEntityId,
    stationId: revision.stationId,
    businessDayId: revision.businessDayId,
    businessDate: input.businessDate,
    reconciliationId: revision.reconciliationId,
    revisionId: revision.id,
    revision: revision.revision,
    expectedSales: revision.expectedSales,
    accountedSales: revision.accountedSales,
    variance: revision.variance,
    varianceClassification: revision.varianceClassification,
    ...(revision.varianceExplanation ? { varianceExplanation: revision.varianceExplanation } : {}),
    declarationTotals: revision.declarations.map((declaration) => ({
      category: declaration.category,
      amount: declaration.amount,
    })),
    approvedBy: revision.approvedBy,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
  };
}

export function reconciliationPostedEvent(
  eventId: string,
  revision: ReconciliationRevision,
  input: { legalEntityId: string; businessDate: string; occurredAt?: string },
): ReconciliationPostedEvent {
  if (revision.state !== 'POSTED') {
    throw new Error('Only a posted reconciliation revision can publish a posting event');
  }
  if (!revision.approvedBy || !revision.postedBy || !revision.postedAt) {
    throw new Error('Posted reconciliation requires approval and posting provenance');
  }
  const approved = reconciliationApprovedEvent(eventId, { ...revision, state: 'APPROVED' }, input);
  return {
    ...approved,
    eventType: 'reconciliation.posted.v1',
    postedBy: revision.postedBy,
    postedAt: revision.postedAt,
  };
}

export function priceBoundaryActivatedEvent(input: {
  eventId: string;
  tenantId: string;
  stationId: string;
  priceId: string;
  productId: string;
  effectiveFrom: string;
  unitPrice: string;
  currency: CurrencyCode;
}): PriceBoundaryActivatedEvent {
  return { eventType: 'forecourt.price_boundary_activated.v1', ...input };
}

export function businessDayLockedEvent(input: {
  eventId: string;
  tenantId: string;
  stationId: string;
  businessDayId: string;
  businessDate: string;
  lockedAt: string;
  legalEntityId: string;
  occurredAt?: string;
}): BusinessDayLockedEvent {
  return {
    eventType: 'forecourt.business_day_locked.v1',
    eventVersion: 1,
    ...input,
    occurredAt: input.occurredAt ?? input.lockedAt,
  };
}
