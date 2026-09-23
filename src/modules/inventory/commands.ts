import 'server-only';

import { randomUUID } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { AppError } from '../../platform/errors';
import { deriveBusinessDate } from '../../platform/domain/business-time';
import { litres } from '../../platform/domain/primitives';
import {
  fuelDeliveries,
  fuelDeliveryAllocations,
  inventoryMovements,
  tanks,
  tankDips,
} from '../../platform/db/schema/a4';
import {
  assertWithinTankCapacity,
  calculateDeliveryShortageExcess,
  requireAdjustmentReason,
  validateDeliveryAllocations,
} from './domain';
import {
  executeInventoryCommand,
  requestHash,
  resolveInventoryCommandContext,
  type InventoryCommandContext,
  type InventoryTransaction,
} from './application';
import {
  assertProductBelongsToTenant,
  loadTankForUpdate,
  postInventoryMovementInTransaction,
} from './persistence';

const uuid = z.string().uuid();
const decimalText = z
  .string()
  .regex(/^-?(?:\d+)(?:\.\d{1,3})?$/, 'A decimal litre value is required');
const instant = z.string().datetime({ offset: true });

const authorityPayload = z.object({ tenantId: uuid, stationId: uuid });
const idempotency = (request: Request): string =>
  request.headers.get('idempotency-key')?.trim() ?? '';

const createTankPayload = authorityPayload.extend({
  code: z.string().trim().min(1).max(32),
  productId: uuid,
  capacityLitres: decimalText,
  reorderLevelLitres: decimalText.nullish(),
  acceptableVarianceLitres: decimalText.nullish(),
});

const deactivateTankPayload = authorityPayload.extend({
  tankId: uuid,
  status: z.enum(['INACTIVE', 'RETIRED']),
});

const dipPayload = authorityPayload.extend({
  tankId: uuid,
  measuredAt: instant,
  physicalLitres: decimalText,
  rawMeasurement: decimalText.nullish(),
  measurementUnit: z.string().trim().min(1).max(32).nullish(),
  notes: z.string().trim().max(1000).nullish(),
});

const allocationPayload = z.object({ tankId: uuid, quantityLitres: decimalText });
const deliveryPayload = authorityPayload.extend({
  productId: uuid,
  deliveryNoteNumber: z.string().trim().min(1).max(80),
  deliveredAt: instant,
  noteQuantityLitres: decimalText,
  actualQuantityLitres: decimalText,
  allocations: z.array(allocationPayload).min(1),
  supplierReference: z.string().trim().max(120).nullish(),
  transporter: z.string().trim().max(120).nullish(),
  driver: z.string().trim().max(120).nullish(),
  truckRegistration: z.string().trim().max(80).nullish(),
  sealReference: z.string().trim().max(80).nullish(),
  preDeliveryDipId: uuid.nullish(),
  postDeliveryDipId: uuid.nullish(),
  unitLandedCost: z
    .string()
    .regex(/^\d+(?:\.\d{1,8})?$/)
    .nullish(),
  totalLandedCost: z
    .string()
    .regex(/^\d+(?:\.\d{1,4})?$/)
    .nullish(),
  currency: z.string().trim().length(3).nullish(),
});

const confirmDeliveryPayload = authorityPayload.extend({ deliveryId: uuid });
const adjustmentPayload = authorityPayload.extend({
  tankId: uuid,
  quantityLitres: decimalText,
  effectiveAt: instant,
  movementType: z.enum(['POSITIVE_ADJUSTMENT', 'NEGATIVE_ADJUSTMENT']),
  reason: z.string().trim().min(1).max(500),
});
const openingBalancePayload = authorityPayload.extend({
  tankId: uuid,
  quantityLitres: decimalText,
  effectiveAt: instant,
});

function contextFor(request: Request, payload: { tenantId: string; stationId: string }) {
  return resolveInventoryCommandContext({
    request,
    requestedTenantId: payload.tenantId,
    stationId: payload.stationId,
  });
}

function requireIdempotency(request: Request): string {
  const key = idempotency(request);
  if (!key) throw new AppError('VALIDATION_FAILED', 'Idempotency-Key is required');
  return key;
}

async function insertTank(
  transaction: InventoryTransaction,
  context: InventoryCommandContext,
  payload: z.infer<typeof createTankPayload>,
): Promise<{ tankId: string; code: string }> {
  await assertProductBelongsToTenant(transaction, context.tenantId, payload.productId);
  const capacity = litres(payload.capacityLitres);
  if (!capacity.value.isPositive())
    throw new AppError('VALIDATION_FAILED', 'Tank capacity must be positive');
  if (payload.reorderLevelLitres) {
    const reorder = litres(payload.reorderLevelLitres);
    if (reorder.value.isNegative() || reorder.value.gt(capacity.value)) {
      throw new AppError('VALIDATION_FAILED', 'Reorder level must be between zero and capacity');
    }
  }
  const tankId = randomUUID();
  await transaction.insert(tanks).values({
    id: tankId,
    tenantId: context.tenantId,
    stationId: context.stationId,
    code: payload.code,
    productId: payload.productId,
    capacityLitres: capacity.toString(),
    reorderLevelLitres: payload.reorderLevelLitres
      ? litres(payload.reorderLevelLitres).toString()
      : null,
    acceptableVarianceLitres: payload.acceptableVarianceLitres
      ? litres(payload.acceptableVarianceLitres).toString()
      : null,
    status: 'ACTIVE',
    createdBy: context.authority.membership.membershipId,
    updatedBy: context.authority.membership.membershipId,
  });
  return { tankId, code: payload.code };
}

export async function createTankFromRequest(request: Request, input: unknown) {
  const payload = createTankPayload.parse(input);
  const context = await contextFor(request, payload);
  const key = requireIdempotency(request);
  return executeInventoryCommand({
    context,
    commandType: 'CreateTank',
    permissionCode: 'inventory.tank.manage',
    idempotencyKey: key,
    requestHash: requestHash(payload),
    audit: {
      actionCode: 'INVENTORY.TANK_CREATED',
      subjectType: 'Tank',
      subjectId: (result) => (result as { tankId: string }).tankId,
    },
    execute: async (transaction) => {
      const result = await insertTank(transaction, context, payload);
      return result;
    },
  });
}

export async function deactivateTankFromRequest(request: Request, input: unknown) {
  const payload = deactivateTankPayload.parse(input);
  const context = await contextFor(request, payload);
  const key = requireIdempotency(request);
  return executeInventoryCommand({
    context,
    commandType: 'DeactivateTank',
    permissionCode: 'inventory.tank.manage',
    idempotencyKey: key,
    requestHash: requestHash(payload),
    audit: {
      actionCode: 'INVENTORY.TANK_STATUS_CHANGED',
      subjectType: 'Tank',
      subjectId: payload.tankId,
    },
    execute: async (transaction) => {
      const tank = await loadTankForUpdate(transaction, {
        tenantId: context.tenantId,
        stationId: context.stationId,
        tankId: payload.tankId,
      });
      if (tank.status === 'RETIRED' && payload.status !== 'RETIRED') {
        throw new AppError('CONFLICT', 'A retired tank cannot be reactivated');
      }
      await transaction
        .update(tanks)
        .set({
          status: payload.status,
          updatedBy: context.authority.membership.membershipId,
          version: tank.version + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(tanks.tenantId, context.tenantId),
            eq(tanks.stationId, context.stationId),
            eq(tanks.id, tank.id),
          ),
        );
      return { tankId: tank.id, status: payload.status };
    },
  });
}

export async function recordTankDipFromRequest(request: Request, input: unknown) {
  const payload = dipPayload.parse(input);
  if ((payload.rawMeasurement === undefined) !== (payload.measurementUnit === undefined)) {
    throw new AppError(
      'VALIDATION_FAILED',
      'Raw dip measurement and unit must be supplied together',
    );
  }
  const context = await contextFor(request, payload);
  const key = requireIdempotency(request);
  return executeInventoryCommand({
    context,
    commandType: 'RecordTankDip',
    permissionCode: 'inventory.dip.record',
    idempotencyKey: key,
    requestHash: requestHash(payload),
    audit: {
      actionCode: 'INVENTORY.TANK_DIP_RECORDED',
      subjectType: 'TankDip',
      subjectId: (result) => (result as { dipId: string }).dipId,
    },
    execute: async (transaction) => {
      const tank = await loadTankForUpdate(transaction, {
        tenantId: context.tenantId,
        stationId: context.stationId,
        tankId: payload.tankId,
      });
      if (tank.status === 'RETIRED')
        throw new AppError('CONFLICT', 'Retired tanks cannot be dipped');
      assertWithinTankCapacity(payload.physicalLitres, tank.capacityLitres);
      const dipId = randomUUID();
      await transaction.insert(tankDips).values({
        id: dipId,
        tenantId: context.tenantId,
        stationId: context.stationId,
        tankId: tank.id,
        measuredAt: new Date(payload.measuredAt),
        businessDate: deriveBusinessDate(payload.measuredAt, context.stationTimezone),
        physicalLitres: litres(payload.physicalLitres).toString(),
        rawMeasurement: payload.rawMeasurement ? litres(payload.rawMeasurement).toString() : null,
        measurementUnit: payload.measurementUnit ?? null,
        recordedBy: context.authority.membership.membershipId,
        notes: payload.notes ?? null,
      });
      return { dipId, tankId: tank.id, physicalLitres: litres(payload.physicalLitres).toString() };
    },
  });
}

async function insertDelivery(
  transaction: InventoryTransaction,
  context: InventoryCommandContext,
  payload: z.infer<typeof deliveryPayload>,
): Promise<{ deliveryId: string; allocationIds: readonly string[] }> {
  await assertProductBelongsToTenant(transaction, context.tenantId, payload.productId);
  validateDeliveryAllocations(
    payload.actualQuantityLitres,
    payload.allocations.map((item) => item.quantityLitres),
  );
  const actual = litres(payload.actualQuantityLitres);
  const allocationIds: string[] = [];
  const sortedAllocations = [...payload.allocations].sort((left, right) =>
    left.tankId.localeCompare(right.tankId),
  );
  for (const allocation of sortedAllocations) {
    const tank = await loadTankForUpdate(transaction, {
      tenantId: context.tenantId,
      stationId: context.stationId,
      tankId: allocation.tankId,
    });
    if (tank.productId !== payload.productId)
      throw new AppError(
        'INVARIANT_VIOLATION',
        'The delivery product does not match an allocated tank',
      );
    if (tank.status === 'RETIRED')
      throw new AppError('CONFLICT', 'Retired tanks cannot receive deliveries');
  }
  const deliveryId = randomUUID();
  const noteQuantity = litres(payload.noteQuantityLitres);
  const shortageExcess = calculateDeliveryShortageExcess(
    noteQuantity.toString(),
    actual.toString(),
  );
  await transaction.insert(fuelDeliveries).values({
    id: deliveryId,
    tenantId: context.tenantId,
    stationId: context.stationId,
    productId: payload.productId,
    deliveryNoteNumber: payload.deliveryNoteNumber,
    deliveredAt: new Date(payload.deliveredAt),
    businessDate: deriveBusinessDate(payload.deliveredAt, context.stationTimezone),
    noteQuantityLitres: noteQuantity.toString(),
    actualQuantityLitres: actual.toString(),
    shortageExcessLitres: shortageExcess,
    supplierReference: payload.supplierReference ?? null,
    transporter: payload.transporter ?? null,
    driver: payload.driver ?? null,
    truckRegistration: payload.truckRegistration ?? null,
    sealReference: payload.sealReference ?? null,
    preDeliveryDipId: payload.preDeliveryDipId ?? null,
    postDeliveryDipId: payload.postDeliveryDipId ?? null,
    status: 'DRAFT',
    unitLandedCost: payload.unitLandedCost ?? null,
    totalLandedCost: payload.totalLandedCost ?? null,
    currency: payload.currency?.toUpperCase() ?? null,
    recordedBy: context.authority.membership.membershipId,
  });
  for (const allocation of sortedAllocations) {
    const allocationId = randomUUID();
    allocationIds.push(allocationId);
    await transaction.insert(fuelDeliveryAllocations).values({
      id: allocationId,
      tenantId: context.tenantId,
      stationId: context.stationId,
      deliveryId,
      tankId: allocation.tankId,
      productId: payload.productId,
      quantityLitres: litres(allocation.quantityLitres).toString(),
    });
  }
  return { deliveryId, allocationIds };
}

export async function createDeliveryFromRequest(request: Request, input: unknown) {
  const payload = deliveryPayload.parse(input);
  const context = await contextFor(request, payload);
  const key = requireIdempotency(request);
  return executeInventoryCommand({
    context,
    commandType: 'CreateDelivery',
    permissionCode: 'inventory.delivery.manage',
    idempotencyKey: key,
    requestHash: requestHash(payload),
    audit: {
      actionCode: 'INVENTORY.DELIVERY_CREATED',
      subjectType: 'FuelDelivery',
      subjectId: (result) => (result as { deliveryId: string }).deliveryId,
    },
    execute: (transaction) => insertDelivery(transaction, context, payload),
  });
}

export async function confirmDeliveryFromRequest(request: Request, input: unknown) {
  const payload = confirmDeliveryPayload.parse(input);
  const context = await contextFor(request, payload);
  const key = requireIdempotency(request);
  return executeInventoryCommand({
    context,
    commandType: 'ConfirmDelivery',
    permissionCode: 'inventory.delivery.manage',
    idempotencyKey: key,
    requestHash: requestHash(payload),
    audit: {
      actionCode: 'INVENTORY.DELIVERY_CONFIRMED',
      subjectType: 'FuelDelivery',
      subjectId: payload.deliveryId,
    },
    execute: async (transaction) => {
      const deliveries = await transaction
        .select()
        .from(fuelDeliveries)
        .where(
          and(
            eq(fuelDeliveries.tenantId, context.tenantId),
            eq(fuelDeliveries.stationId, context.stationId),
            eq(fuelDeliveries.id, payload.deliveryId),
          ),
        )
        .for('update');
      const delivery = deliveries[0];
      if (!delivery) throw new AppError('NOT_FOUND', 'The requested delivery was not found');
      if (delivery.status === 'CONFIRMED')
        return { deliveryId: delivery.id, status: delivery.status };
      if (delivery.status !== 'DRAFT')
        throw new AppError('CONFLICT', 'Only draft deliveries can be confirmed');
      const allocations = await transaction
        .select()
        .from(fuelDeliveryAllocations)
        .where(
          and(
            eq(fuelDeliveryAllocations.tenantId, context.tenantId),
            eq(fuelDeliveryAllocations.stationId, context.stationId),
            eq(fuelDeliveryAllocations.deliveryId, delivery.id),
          ),
        )
        .orderBy(asc(fuelDeliveryAllocations.tankId));
      const allocated = validateDeliveryAllocations(
        delivery.actualQuantityLitres,
        allocations.map((item) => item.quantityLitres),
      );
      if (!litres(allocated).value.eq(litres(delivery.actualQuantityLitres).value))
        throw new AppError(
          'CONFLICT',
          'All received delivery litres must be allocated before confirmation',
        );
      for (const allocation of allocations) {
        await postInventoryMovementInTransaction(transaction, {
          tenantId: context.tenantId,
          stationId: context.stationId,
          tankId: allocation.tankId,
          productId: delivery.productId,
          movementType: 'DELIVERY',
          quantityLitres: allocation.quantityLitres,
          effectiveAt: delivery.deliveredAt,
          businessDate: delivery.businessDate,
          sourceType: 'FUEL_DELIVERY_ALLOCATION',
          sourceId: allocation.id,
          actorMembershipId: context.authority.membership.membershipId,
          unitLandedCost: delivery.unitLandedCost ?? undefined,
          totalLandedCost: delivery.totalLandedCost ?? undefined,
          currency: delivery.currency ?? undefined,
        });
      }
      await transaction
        .update(fuelDeliveries)
        .set({
          status: 'CONFIRMED',
          confirmedBy: context.authority.membership.membershipId,
          confirmedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(fuelDeliveries.id, delivery.id));
      return { deliveryId: delivery.id, status: 'CONFIRMED', movementCount: allocations.length };
    },
  });
}

export async function postInventoryAdjustmentFromRequest(request: Request, input: unknown) {
  const payload = adjustmentPayload.parse(input);
  const context = await contextFor(request, payload);
  const key = requireIdempotency(request);
  const reason = requireAdjustmentReason(payload.reason);
  const signedQuantity =
    payload.movementType === 'NEGATIVE_ADJUSTMENT'
      ? `-${payload.quantityLitres.replace(/^-/, '')}`
      : payload.quantityLitres.replace(/^-/, '');
  return executeInventoryCommand({
    context,
    commandType: 'PostInventoryAdjustment',
    permissionCode: 'inventory.adjustment.post',
    idempotencyKey: key,
    requestHash: requestHash(payload),
    audit: {
      actionCode: 'INVENTORY.ADJUSTMENT_POSTED',
      subjectType: 'InventoryMovement',
      subjectId: (result) => (result as { movementId: string }).movementId,
      reason,
    },
    execute: async (transaction) => ({
      movementId: await postInventoryMovementInTransaction(transaction, {
        tenantId: context.tenantId,
        stationId: context.stationId,
        tankId: payload.tankId,
        productId: (
          await loadTankForUpdate(transaction, {
            tenantId: context.tenantId,
            stationId: context.stationId,
            tankId: payload.tankId,
          })
        ).productId,
        movementType: payload.movementType,
        quantityLitres: signedQuantity,
        effectiveAt: new Date(payload.effectiveAt),
        businessDate: deriveBusinessDate(payload.effectiveAt, context.stationTimezone),
        sourceType: 'MANUAL_ADJUSTMENT',
        sourceId: randomUUID(),
        actorMembershipId: context.authority.membership.membershipId,
        reason,
      }),
    }),
  });
}

export async function recordOpeningBalanceFromRequest(request: Request, input: unknown) {
  const payload = openingBalancePayload.parse(input);
  const context = await contextFor(request, payload);
  const key = requireIdempotency(request);
  return executeInventoryCommand({
    context,
    commandType: 'RecordOpeningBalance',
    permissionCode: 'inventory.adjustment.post',
    idempotencyKey: key,
    requestHash: requestHash(payload),
    audit: {
      actionCode: 'INVENTORY.OPENING_BALANCE_POSTED',
      subjectType: 'InventoryMovement',
      subjectId: (result) => (result as { movementId: string }).movementId,
    },
    execute: async (transaction) => {
      const tank = await loadTankForUpdate(transaction, {
        tenantId: context.tenantId,
        stationId: context.stationId,
        tankId: payload.tankId,
      });
      const existing = await transaction
        .select({ id: inventoryMovements.id })
        .from(inventoryMovements)
        .where(
          and(
            eq(inventoryMovements.tenantId, context.tenantId),
            eq(inventoryMovements.stationId, context.stationId),
            eq(inventoryMovements.tankId, tank.id),
            eq(inventoryMovements.movementType, 'OPENING_BALANCE'),
          ),
        )
        .limit(1);
      if (existing.length)
        throw new AppError('CONFLICT', 'An opening balance already exists for this tank');
      return {
        movementId: await postInventoryMovementInTransaction(transaction, {
          tenantId: context.tenantId,
          stationId: context.stationId,
          tankId: tank.id,
          productId: tank.productId,
          movementType: 'OPENING_BALANCE',
          quantityLitres: payload.quantityLitres,
          effectiveAt: new Date(payload.effectiveAt),
          businessDate: deriveBusinessDate(payload.effectiveAt, context.stationTimezone),
          sourceType: 'OPENING_BALANCE',
          sourceId: randomUUID(),
          actorMembershipId: context.authority.membership.membershipId,
        }),
      };
    },
  });
}
