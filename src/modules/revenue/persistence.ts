import 'server-only';

import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { AppError } from '../../platform/errors';
import type { Database } from '../../platform/db';
import { saleRecognitionMovements } from '../../platform/db/schema/revenue';
import { deriveOrdinaryFuelSaleRevenue, revenueReplayFingerprint } from './domain';
import type { CanonicalSaleRevenuePosting, SaleRevenueMovement } from './contracts';

export type RevenueTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

function sameInstant(left: Date | string, right: Date | string): boolean {
  return new Date(left).toISOString() === new Date(right).toISOString();
}

/**
 * Posts or verifies exactly one ordinary fuel-sale revenue movement for an
 * already-posted canonical A4 SALE. The database trigger performs the final
 * cross-module lineage validation.
 */
export async function postCanonicalSaleRevenueInTransaction(
  transaction: RevenueTransaction,
  input: CanonicalSaleRevenuePosting,
): Promise<SaleRevenueMovement> {
  const derived = deriveOrdinaryFuelSaleRevenue({
    quantityLitres: input.quantityLitres,
    unitPrice: input.unitPrice,
    currency: input.currency,
  });
  const fingerprint = revenueReplayFingerprint({
    tenantId: input.tenantId,
    legalEntityId: input.legalEntityId,
    stationId: input.stationId,
    businessDate: input.businessDate,
    productId: input.productId,
    tankId: input.tankId,
    nozzleId: input.nozzleId,
    shiftId: input.shiftId,
    meterSegmentId: input.meterSegmentId,
    inventorySaleMovementId: input.inventorySaleMovementId,
    reconciliationId: input.reconciliationId,
    reconciliationRevisionId: input.reconciliationRevisionId,
    reconciliationMeterReadingId: input.reconciliationMeterReadingId,
    quantityLitres: derived.quantityLitres,
    unitPrice: derived.unitPrice,
    reconciliationValue: derived.reconciliationValue,
    recognizedRevenueAmount: derived.recognizedRevenueAmount,
    currency: derived.currency,
    effectiveAt: input.effectiveAt,
    classification: input.classification,
    sourceType: input.sourceType,
  });

  const existing = await transaction
    .select()
    .from(saleRecognitionMovements)
    .where(
      and(
        eq(saleRecognitionMovements.tenantId, input.tenantId),
        eq(saleRecognitionMovements.stationId, input.stationId),
        eq(saleRecognitionMovements.sourceType, input.sourceType),
        eq(saleRecognitionMovements.sourceId, input.meterSegmentId),
        eq(saleRecognitionMovements.classification, input.classification),
      ),
    );
  // Sale-recognition rows are append-only. The unique source/classification
  // key provides duplicate protection; locking this immutable table would
  // incorrectly require UPDATE privilege from the runtime role.
  if (existing[0]) {
    const row = existing[0];
    if (
      row.replayFingerprint !== fingerprint ||
      row.inventorySaleMovementId !== input.inventorySaleMovementId ||
      row.legalEntityId !== input.legalEntityId ||
      row.productId !== input.productId ||
      row.tankId !== input.tankId ||
      row.nozzleId !== input.nozzleId ||
      row.shiftId !== input.shiftId ||
      row.businessDate !== input.businessDate ||
      row.reconciliationId !== input.reconciliationId ||
      row.reconciliationRevisionId !== input.reconciliationRevisionId ||
      row.reconciliationMeterReadingId !== input.reconciliationMeterReadingId ||
      row.quantityLitres !== derived.quantityLitres ||
      row.reconciliationValue !== derived.reconciliationValue ||
      row.recognizedRevenueAmount !== derived.recognizedRevenueAmount ||
      row.currency !== derived.currency ||
      !sameInstant(row.effectiveAt, input.effectiveAt)
    ) {
      throw new AppError(
        'CONFLICT',
        'Existing canonical sale revenue does not match the requested posting',
      );
    }
    return {
      id: row.id,
      tenantId: row.tenantId,
      stationId: row.stationId,
      meterSegmentId: row.meterSegmentId,
      inventorySaleMovementId: row.inventorySaleMovementId,
      quantityLitres: row.quantityLitres,
      reconciliationValue: row.reconciliationValue,
      recognizedRevenueAmount: row.recognizedRevenueAmount,
      currency: row.currency as 'USD',
      effectiveAt: row.effectiveAt,
      postedAt: row.postedAt,
      classification: row.classification as 'ORDINARY_FUEL_SALE',
      sourceType: row.sourceType as 'METER_SEGMENT_SALE',
      sourceId: row.sourceId,
      replayFingerprint: row.replayFingerprint,
    };
  }

  const rows = await transaction
    .insert(saleRecognitionMovements)
    .values({
      id: randomUUID(),
      tenantId: input.tenantId,
      legalEntityId: input.legalEntityId,
      stationId: input.stationId,
      businessDate: input.businessDate,
      productId: input.productId,
      tankId: input.tankId,
      nozzleId: input.nozzleId,
      shiftId: input.shiftId,
      meterSegmentId: input.meterSegmentId,
      inventorySaleMovementId: input.inventorySaleMovementId,
      reconciliationId: input.reconciliationId,
      reconciliationRevisionId: input.reconciliationRevisionId,
      reconciliationMeterReadingId: input.reconciliationMeterReadingId,
      quantityLitres: derived.quantityLitres,
      reconciliationValue: derived.reconciliationValue,
      recognizedRevenueAmount: derived.recognizedRevenueAmount,
      currency: derived.currency,
      effectiveAt: input.effectiveAt,
      classification: input.classification,
      sourceType: input.sourceType,
      sourceId: input.meterSegmentId,
      actorMembershipId: input.actorMembershipId,
      requestId: input.requestId,
      replayFingerprint: fingerprint,
    })
    .returning();
  const row = rows[0];
  if (!row) throw new AppError('INTERNAL_ERROR', 'Canonical sale revenue was not persisted');
  return {
    id: row.id,
    tenantId: row.tenantId,
    stationId: row.stationId,
    meterSegmentId: row.meterSegmentId,
    inventorySaleMovementId: row.inventorySaleMovementId,
    quantityLitres: row.quantityLitres,
    reconciliationValue: row.reconciliationValue,
    recognizedRevenueAmount: row.recognizedRevenueAmount,
    currency: row.currency as 'USD',
    effectiveAt: row.effectiveAt,
    postedAt: row.postedAt,
    classification: row.classification as 'ORDINARY_FUEL_SALE',
    sourceType: row.sourceType as 'METER_SEGMENT_SALE',
    sourceId: row.sourceId,
    replayFingerprint: row.replayFingerprint,
  };
}
