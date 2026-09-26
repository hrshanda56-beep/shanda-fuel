import type { CurrencyCode } from '../../platform/domain/primitives';
import type { RevenueClassification, RevenueSourceType } from './domain';

export type CanonicalSaleRevenuePosting = Readonly<{
  tenantId: string;
  legalEntityId: string;
  stationId: string;
  businessDate: string;
  productId: string;
  tankId: string;
  nozzleId: string;
  shiftId: string;
  meterSegmentId: string;
  inventorySaleMovementId: string;
  reconciliationId: string;
  reconciliationRevisionId: string;
  reconciliationMeterReadingId: string;
  quantityLitres: string;
  unitPrice: string;
  currency: CurrencyCode;
  effectiveAt: Date;
  actorMembershipId: string;
  requestId: string;
  classification: RevenueClassification;
  sourceType: RevenueSourceType;
}>;

export type SaleRevenueMovement = Readonly<{
  id: string;
  tenantId: string;
  stationId: string;
  meterSegmentId: string;
  inventorySaleMovementId: string;
  quantityLitres: string;
  reconciliationValue: string;
  recognizedRevenueAmount: string;
  currency: CurrencyCode;
  effectiveAt: Date | string;
  postedAt: Date | string;
  classification: RevenueClassification;
  sourceType: RevenueSourceType;
  sourceId: string;
  replayFingerprint: string;
}>;
