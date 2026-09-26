import { createHash } from 'node:crypto';
import {
  DECIMAL_POLICIES,
  ExactDecimal,
  litres,
  money,
  unitPrice,
  type CurrencyCode,
} from '../../platform/domain/primitives';

export const REVENUE_CLASSIFICATIONS = ['ORDINARY_FUEL_SALE'] as const;
export type RevenueClassification = (typeof REVENUE_CLASSIFICATIONS)[number];

export const REVENUE_SOURCE_TYPES = ['METER_SEGMENT_SALE'] as const;
export type RevenueSourceType = (typeof REVENUE_SOURCE_TYPES)[number];

export type OrdinaryFuelSaleRevenue = Readonly<{
  quantityLitres: string;
  unitPrice: string;
  reconciliationValue: string;
  recognizedRevenueAmount: string;
  currency: CurrencyCode;
  classification: 'ORDINARY_FUEL_SALE';
  sourceType: 'METER_SEGMENT_SALE';
}>;

/**
 * REV1's only recognised revenue derivation: sealed segment litres multiplied
 * by that segment's authoritative selling price, rounded once to money scale.
 */
export function deriveOrdinaryFuelSaleRevenue(input: {
  quantityLitres: string;
  unitPrice: string;
  currency?: CurrencyCode;
}): OrdinaryFuelSaleRevenue {
  const quantity = litres(input.quantityLitres);
  const price = unitPrice(input.unitPrice);
  if (quantity.value.isZero() || quantity.value.isNegative()) {
    throw new Error('A revenue segment must have positive litres');
  }
  if (price.value.isZero() || price.value.isNegative()) {
    throw new Error('A revenue segment must have a positive price');
  }

  const amount = new ExactDecimal(quantity.toString())
    .multiply(new ExactDecimal(price.toString()))
    .quantize(DECIMAL_POLICIES.money);
  const canonicalAmount = money(amount.toString(), input.currency ?? 'USD');
  return {
    quantityLitres: quantity.toString(),
    unitPrice: price.toString(),
    reconciliationValue: canonicalAmount.amount.toString(),
    recognizedRevenueAmount: canonicalAmount.amount.toString(),
    currency: canonicalAmount.currency,
    classification: 'ORDINARY_FUEL_SALE',
    sourceType: 'METER_SEGMENT_SALE',
  };
}

export function revenueReplayFingerprint(input: {
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
  reconciliationValue: string;
  recognizedRevenueAmount: string;
  currency: CurrencyCode;
  effectiveAt: Date | string;
  classification: RevenueClassification;
  sourceType: RevenueSourceType;
}): string {
  const effectiveAt =
    input.effectiveAt instanceof Date
      ? input.effectiveAt.toISOString()
      : new Date(input.effectiveAt).toISOString();
  const payload = [
    input.tenantId,
    input.legalEntityId,
    input.stationId,
    input.businessDate,
    input.productId,
    input.tankId,
    input.nozzleId,
    input.shiftId,
    input.meterSegmentId,
    input.inventorySaleMovementId,
    input.reconciliationId,
    input.reconciliationRevisionId,
    input.reconciliationMeterReadingId,
    input.quantityLitres,
    input.unitPrice,
    input.reconciliationValue,
    input.recognizedRevenueAmount,
    input.currency,
    effectiveAt,
    input.classification,
    input.sourceType,
  ].join('|');
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}
