import 'server-only';

import { and, asc, eq } from 'drizzle-orm';
import { fuelDeliveries } from '../../platform/db/schema/a4';
import { deliverySettings, fuelDeliveryWaterTests } from '../../platform/db/schema/delivery-detail';
import { AppError } from '../../platform/errors';
import type { InventoryTransaction } from '../inventory/application';
import { assertWaterTestOnRecord } from './domain';

export type DeliveryRow = typeof fuelDeliveries.$inferSelect;

/** Locks and returns one delivery of the station, or fails with a plain not-found. */
export async function loadDeliveryForUpdate(
  transaction: InventoryTransaction,
  scope: { tenantId: string; stationId: string; deliveryId: string },
): Promise<DeliveryRow> {
  const rows = await transaction
    .select()
    .from(fuelDeliveries)
    .where(
      and(
        eq(fuelDeliveries.tenantId, scope.tenantId),
        eq(fuelDeliveries.stationId, scope.stationId),
        eq(fuelDeliveries.id, scope.deliveryId),
      ),
    )
    .for('update');
  const delivery = rows[0];
  if (!delivery) throw new AppError('NOT_FOUND', 'The requested delivery was not found');
  return delivery;
}

export async function readWaterTestRequired(
  transaction: InventoryTransaction,
  tenantId: string,
): Promise<boolean> {
  const rows = await transaction
    .select({ required: deliverySettings.waterTestRequired })
    .from(deliverySettings)
    .where(eq(deliverySettings.tenantId, tenantId));
  return rows[0]?.required ?? false;
}

/**
 * Called by ConfirmDelivery. Does nothing unless the owner turned the water-test rule on.
 */
export async function assertWaterTestAllowsConfirmation(
  transaction: InventoryTransaction,
  scope: { tenantId: string; stationId: string; deliveryId: string },
): Promise<void> {
  const required = await readWaterTestRequired(transaction, scope.tenantId);
  if (!required) return;
  const tests = await transaction
    .select({ id: fuelDeliveryWaterTests.id, result: fuelDeliveryWaterTests.result })
    .from(fuelDeliveryWaterTests)
    .where(
      and(
        eq(fuelDeliveryWaterTests.tenantId, scope.tenantId),
        eq(fuelDeliveryWaterTests.stationId, scope.stationId),
        eq(fuelDeliveryWaterTests.deliveryId, scope.deliveryId),
      ),
    )
    .orderBy(asc(fuelDeliveryWaterTests.id));
  assertWaterTestOnRecord({
    required,
    hasWaterTest: tests.length > 0,
    result: tests[0]?.result ?? null,
  });
}
