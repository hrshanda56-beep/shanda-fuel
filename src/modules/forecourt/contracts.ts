import type { CurrencyCode, Money } from '../../platform/domain/primitives';
import type { MeterSegment, ReconciliationRevision } from './domain';

export type MeterSegmentSealedEvent = {
  eventType: 'forecourt.meter_segment_sealed.v1';
  eventId: string;
  tenantId: string;
  stationId: string;
  businessDayId: string;
  shiftId: string;
  segmentId: string;
  nozzleId: string;
  productId: string;
  attendantId: string;
  openingReading: string;
  closingReading: string;
  litres: string;
  unitPrice: string;
  expectedSaleValue: Money;
  currency: CurrencyCode;
  sealedAt: string;
};

export type ReconciliationApprovedEvent = {
  eventType: 'reconciliation.approved.v1';
  eventId: string;
  tenantId: string;
  stationId: string;
  businessDayId: string;
  reconciliationId: string;
  revisionId: string;
  revision: number;
  expectedSales: Money;
  accountedSales: Money;
  variance: Money;
  approvedBy: string;
};

export type ReconciliationPostedEvent = ReconciliationApprovedEvent & {
  eventType: 'reconciliation.posted.v1';
  postedAt: string;
};

export type BusinessDayLockedEvent = {
  eventType: 'forecourt.business_day_locked.v1';
  eventId: string;
  tenantId: string;
  stationId: string;
  businessDayId: string;
  businessDate: string;
  lockedAt: string;
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
): MeterSegmentSealedEvent {
  return {
    eventType: 'forecourt.meter_segment_sealed.v1',
    eventId,
    tenantId: segment.tenantId,
    stationId: segment.stationId,
    businessDayId: segment.businessDayId,
    shiftId: segment.shiftId,
    segmentId: segment.id,
    nozzleId: segment.nozzleId,
    productId: segment.productId,
    attendantId: segment.attendantId,
    openingReading: segment.openingReading,
    closingReading: segment.closingReading,
    litres: segment.litres.toString(),
    unitPrice: segment.unitPrice.toString(),
    expectedSaleValue: segment.expectedSaleValue,
    currency: segment.currency,
    sealedAt: segment.sealedAt,
  };
}

export function reconciliationApprovedEvent(
  eventId: string,
  revision: ReconciliationRevision,
): ReconciliationApprovedEvent {
  if (!['APPROVED', 'POSTED', 'LOCKED'].includes(revision.state)) {
    throw new Error('Only an approved reconciliation revision can publish an approval event');
  }
  if (!revision.approvedBy) throw new Error('Approved reconciliation requires an approver');
  return {
    eventType: 'reconciliation.approved.v1',
    eventId,
    tenantId: revision.tenantId,
    stationId: revision.stationId,
    businessDayId: revision.businessDayId,
    reconciliationId: revision.reconciliationId,
    revisionId: revision.id,
    revision: revision.revision,
    expectedSales: revision.expectedSales,
    accountedSales: revision.accountedSales,
    variance: revision.variance,
    approvedBy: revision.approvedBy,
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
}): BusinessDayLockedEvent {
  return { eventType: 'forecourt.business_day_locked.v1', ...input };
}
