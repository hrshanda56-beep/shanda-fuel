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
  tankCalibrationPoints,
  tankDips,
} from '../../platform/db/schema/a4';
import {
  assertWithinTankCapacity,
  calculateDeliveryShortageExcess,
  classifyDeliveryReceipt,
  convertCalibratedMeasurementToLitres,
  requireAdjustmentReason,
  validateCalibrationPoints,
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
import {
  approveInventoryCostRevaluationInTransaction,
  persistInventoryCostProjectionInTransaction,
  persistHistoricalLateSourceUnvaluedProjectionInTransaction,
  postInventoryCostRevaluationInTransaction,
  postOpeningInventoryCostInTransaction,
  postReceiptCostInTransaction,
  requestInventoryCostRevaluationInTransaction,
} from '../costing';

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

const dipPayload = authorityPayload
  .extend({
    tankId: uuid,
    measuredAt: instant,
    physicalLitres: decimalText.nullish(),
    rawMeasurement: decimalText.nullish(),
    measurementUnit: z.string().trim().min(1).max(32).nullish(),
    notes: z.string().trim().max(1000).nullish(),
  })
  .superRefine((value, refinement) => {
    if (!value.physicalLitres && !value.rawMeasurement) {
      refinement.addIssue({
        code: 'custom',
        path: ['physicalLitres'],
        message: 'Physical litres or a calibrated raw measurement is required',
      });
    }
    if (value.rawMeasurement && !value.measurementUnit) {
      refinement.addIssue({
        code: 'custom',
        path: ['measurementUnit'],
        message: 'A measurement unit is required for a calibrated raw measurement',
      });
    }
  });

const calibrationPayload = authorityPayload.extend({
  tankId: uuid,
  points: z
    .array(
      z.object({
        measurementValue: decimalText,
        litres: decimalText,
        measurementUnit: z.string().trim().min(1).max(32),
      }),
    )
    .min(2)
    .max(500),
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
const currencyCode = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{3}$/);
const costAmount = z.string().regex(/^\d+(?:\.\d{1,4})?$/);
const openingInventoryCostPayload = authorityPayload.extend({
  tankId: uuid,
  amount: costAmount.optional(),
  inventoryValue: costAmount.optional(),
  currency: currencyCode,
});
const receiptCostPayload = authorityPayload.extend({
  allocationId: uuid,
  amount: costAmount,
  currency: currencyCode,
});
const revaluationSourceType = z.enum(['OPENING_BALANCE', 'FUEL_DELIVERY_ALLOCATION']);
const requestInventoryCostRevaluationPayload = authorityPayload.extend({
  tankId: uuid,
  productId: uuid,
  sourceType: revaluationSourceType,
  sourceId: uuid,
  amount: costAmount,
  currency: currencyCode,
  reason: z.string().trim().min(1).max(1000),
  // Reserved metadata only; v1 supports whole-history posting and rejects bounds below.
  restatementFromAt: instant.nullish(),
  restatementThroughAt: instant.nullish(),
});
const inventoryCostRevaluationTransitionPayload = authorityPayload.extend({
  revaluationId: uuid,
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
  if (Boolean(payload.rawMeasurement) !== Boolean(payload.measurementUnit)) {
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
      const calibrationPoints = payload.rawMeasurement
        ? await transaction
            .select({
              measurementValue: tankCalibrationPoints.measurementValue,
              litres: tankCalibrationPoints.litres,
              measurementUnit: tankCalibrationPoints.measurementUnit,
            })
            .from(tankCalibrationPoints)
            .where(
              and(
                eq(tankCalibrationPoints.tenantId, context.tenantId),
                eq(tankCalibrationPoints.stationId, context.stationId),
                eq(tankCalibrationPoints.tankId, tank.id),
              ),
            )
            .orderBy(asc(tankCalibrationPoints.measurementValue))
        : [];
      const calibratedLitres = payload.rawMeasurement
        ? convertCalibratedMeasurementToLitres(
            payload.rawMeasurement,
            payload.measurementUnit!,
            calibrationPoints,
          )
        : undefined;
      if (
        calibratedLitres &&
        payload.physicalLitres &&
        litres(calibratedLitres).value.eq(litres(payload.physicalLitres).value) === false
      ) {
        throw new AppError(
          'VALIDATION_FAILED',
          'Physical litres do not match the approved calibration chart conversion',
        );
      }
      const physicalLitres = payload.physicalLitres ?? calibratedLitres;
      if (!physicalLitres) {
        throw new AppError('VALIDATION_FAILED', 'A physical litre value could not be derived');
      }
      assertWithinTankCapacity(physicalLitres, tank.capacityLitres);
      const dipId = randomUUID();
      await transaction.insert(tankDips).values({
        id: dipId,
        tenantId: context.tenantId,
        stationId: context.stationId,
        tankId: tank.id,
        measuredAt: new Date(payload.measuredAt),
        businessDate: deriveBusinessDate(payload.measuredAt, context.stationTimezone),
        physicalLitres: litres(physicalLitres).toString(),
        rawMeasurement: payload.rawMeasurement ? litres(payload.rawMeasurement).toString() : null,
        measurementUnit: payload.measurementUnit ?? null,
        recordedBy: context.authority.membership.membershipId,
        notes: payload.notes ?? null,
      });
      return { dipId, tankId: tank.id, physicalLitres: litres(physicalLitres).toString() };
    },
  });
}

export async function recordTankCalibrationChartFromRequest(request: Request, input: unknown) {
  const payload = calibrationPayload.parse(input);
  const context = await contextFor(request, payload);
  const key = requireIdempotency(request);
  return executeInventoryCommand({
    context,
    commandType: 'RecordTankCalibrationChart',
    permissionCode: 'inventory.tank.manage',
    idempotencyKey: key,
    requestHash: requestHash(payload),
    audit: {
      actionCode: 'INVENTORY.TANK_CALIBRATION_CHART_RECORDED',
      subjectType: 'Tank',
      subjectId: payload.tankId,
      metadata: { pointCount: payload.points.length },
    },
    execute: async (transaction) => {
      const tank = await loadTankForUpdate(transaction, {
        tenantId: context.tenantId,
        stationId: context.stationId,
        tankId: payload.tankId,
      });
      if (tank.status === 'RETIRED') {
        throw new AppError('CONFLICT', 'Retired tanks cannot receive a calibration chart');
      }
      const points = validateCalibrationPoints(payload.points);
      await transaction.insert(tankCalibrationPoints).values(
        points.map((point) => ({
          id: randomUUID(),
          tenantId: context.tenantId,
          stationId: context.stationId,
          tankId: tank.id,
          measurementValue: point.measurementValue,
          litres: point.litres,
          measurementUnit: point.measurementUnit!,
          recordedBy: context.authority.membership.membershipId,
        })),
      );
      return { tankId: tank.id, pointCount: points.length };
    },
  });
}

async function insertDelivery(
  transaction: InventoryTransaction,
  context: InventoryCommandContext,
  payload: z.infer<typeof deliveryPayload>,
): Promise<{
  deliveryId: string;
  allocationIds: readonly string[];
  receiptKind: ReturnType<typeof classifyDeliveryReceipt>;
  noteQuantityLitres: string;
  actualQuantityLitres: string;
  shortageExcessLitres: string;
  allocatedQuantityLitres: string;
}> {
  await assertProductBelongsToTenant(transaction, context.tenantId, payload.productId);
  const allocatedQuantityLitres = validateDeliveryAllocations(
    payload.actualQuantityLitres,
    payload.allocations.map((item) => item.quantityLitres),
  );
  const actual = litres(payload.actualQuantityLitres);
  const noteQuantity = litres(payload.noteQuantityLitres);
  const receiptKind = classifyDeliveryReceipt(noteQuantity.toString(), actual.toString());
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
  return {
    deliveryId,
    allocationIds,
    receiptKind,
    noteQuantityLitres: noteQuantity.toString(),
    actualQuantityLitres: actual.toString(),
    shortageExcessLitres: shortageExcess,
    allocatedQuantityLitres,
  };
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
      const receiptKind = classifyDeliveryReceipt(
        delivery.noteQuantityLitres,
        delivery.actualQuantityLitres,
      );
      if (delivery.status === 'CONFIRMED')
        return {
          deliveryId: delivery.id,
          status: delivery.status,
          receiptKind,
          noteQuantityLitres: delivery.noteQuantityLitres,
          actualQuantityLitres: delivery.actualQuantityLitres,
          shortageExcessLitres: delivery.shortageExcessLitres,
        };
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
      const affectedStreams = new Map<
        string,
        { tankId: string; productId: string; sourceIds: string[] }
      >();
      for (const allocation of allocations) {
        const stream = affectedStreams.get(`${allocation.tankId}:${delivery.productId}`) ?? {
          tankId: allocation.tankId,
          productId: delivery.productId,
          sourceIds: [],
        };
        stream.sourceIds.push(allocation.id);
        affectedStreams.set(`${allocation.tankId}:${delivery.productId}`, stream);
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
      for (const stream of affectedStreams.values()) {
        let persistedUnvaluedProjection = false;
        for (const sourceId of stream.sourceIds) {
          if (
            await persistHistoricalLateSourceUnvaluedProjectionInTransaction(transaction, {
              tenantId: context.tenantId,
              stationId: context.stationId,
              tankId: stream.tankId,
              productId: stream.productId,
              sourceType: 'FUEL_DELIVERY_ALLOCATION',
              sourceId,
            })
          ) {
            persistedUnvaluedProjection = true;
            break;
          }
        }
        if (!persistedUnvaluedProjection) {
          await persistInventoryCostProjectionInTransaction(transaction, {
            tenantId: context.tenantId,
            stationId: context.stationId,
            tankId: stream.tankId,
            productId: stream.productId,
          });
        }
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
      return {
        deliveryId: delivery.id,
        status: 'CONFIRMED',
        movementCount: allocations.length,
        receiptKind,
        noteQuantityLitres: delivery.noteQuantityLitres,
        actualQuantityLitres: delivery.actualQuantityLitres,
        shortageExcessLitres: delivery.shortageExcessLitres,
      };
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
      const sourceId = randomUUID();
      const movementId = await postInventoryMovementInTransaction(transaction, {
        tenantId: context.tenantId,
        stationId: context.stationId,
        tankId: tank.id,
        productId: tank.productId,
        movementType: 'OPENING_BALANCE',
        quantityLitres: payload.quantityLitres,
        effectiveAt: new Date(payload.effectiveAt),
        businessDate: deriveBusinessDate(payload.effectiveAt, context.stationTimezone),
        sourceType: 'OPENING_BALANCE',
        sourceId,
        actorMembershipId: context.authority.membership.membershipId,
      });
      const persistedUnvaluedProjection =
        await persistHistoricalLateSourceUnvaluedProjectionInTransaction(transaction, {
          tenantId: context.tenantId,
          stationId: context.stationId,
          tankId: tank.id,
          productId: tank.productId,
          sourceType: 'OPENING_BALANCE',
          sourceId,
        });
      if (!persistedUnvaluedProjection) {
        await persistInventoryCostProjectionInTransaction(transaction, {
          tenantId: context.tenantId,
          stationId: context.stationId,
          tankId: tank.id,
          productId: tank.productId,
        });
      }
      return { movementId, sourceId };
    },
  });
}

export async function recordOpeningInventoryCostFromRequest(request: Request, input: unknown) {
  const payload = openingInventoryCostPayload
    .superRefine((value, ctx) => {
      if (!value.amount && !value.inventoryValue) {
        ctx.addIssue({ code: 'custom', message: 'An opening inventory value is required' });
      }
      if (value.amount && value.inventoryValue && value.amount !== value.inventoryValue) {
        ctx.addIssue({ code: 'custom', message: 'amount and inventoryValue must agree' });
      }
    })
    .parse(input);
  const context = await contextFor(request, payload);
  const key = requireIdempotency(request);
  return executeInventoryCommand({
    context,
    commandType: 'RecordOpeningInventoryCost',
    permissionCode: 'inventory.adjustment.post',
    idempotencyKey: key,
    requestHash: requestHash(payload),
    audit: {
      actionCode: 'INVENTORY.OPENING_COST_POSTED',
      subjectType: 'InventoryCostEvent',
      subjectId: (result) => (result as { costEventId: string }).costEventId,
    },
    execute: (transaction) =>
      postOpeningInventoryCostInTransaction(transaction, {
        tenantId: context.tenantId,
        stationId: context.stationId,
        tankId: payload.tankId,
        amount: payload.amount ?? payload.inventoryValue!,
        currency: payload.currency,
        actorMembershipId: context.authority.membership.membershipId,
      }),
  });
}

export async function recordReceiptCostFromRequest(request: Request, input: unknown) {
  const payload = receiptCostPayload.parse(input);
  const context = await contextFor(request, payload);
  const key = requireIdempotency(request);
  return executeInventoryCommand({
    context,
    commandType: 'RecordReceiptCost',
    permissionCode: 'inventory.delivery.manage',
    idempotencyKey: key,
    requestHash: requestHash(payload),
    audit: {
      actionCode: 'INVENTORY.RECEIPT_COST_POSTED',
      subjectType: 'InventoryCostEvent',
      subjectId: (result) => (result as { costEventId: string }).costEventId,
    },
    execute: (transaction) =>
      postReceiptCostInTransaction(transaction, {
        tenantId: context.tenantId,
        stationId: context.stationId,
        allocationId: payload.allocationId,
        amount: payload.amount,
        currency: payload.currency,
        actorMembershipId: context.authority.membership.membershipId,
      }),
  });
}

export async function requestInventoryCostRevaluationFromRequest(request: Request, input: unknown) {
  const payload = requestInventoryCostRevaluationPayload.parse(input);
  if (payload.restatementFromAt || payload.restatementThroughAt) {
    throw new AppError(
      'VALIDATION_FAILED',
      'Bounded restatement is deferred from v1; non-null boundary values are not supported',
    );
  }
  const context = await contextFor(request, payload);
  const key = requireIdempotency(request);
  return executeInventoryCommand({
    context,
    commandType: 'RequestInventoryCostRevaluation',
    permissionCode: 'inventory.adjustment.post',
    idempotencyKey: key,
    requestHash: requestHash(payload),
    audit: {
      actionCode: 'INVENTORY.COST_REVALUATION_REQUESTED',
      subjectType: 'InventoryCostRevaluation',
      subjectId: (result) => (result as { revaluationId: string }).revaluationId,
      reason: payload.reason,
    },
    execute: (transaction) =>
      requestInventoryCostRevaluationInTransaction(transaction, {
        tenantId: context.tenantId,
        stationId: context.stationId,
        tankId: payload.tankId,
        productId: payload.productId,
        sourceType: payload.sourceType,
        sourceId: payload.sourceId,
        amount: payload.amount,
        currency: payload.currency,
        reason: payload.reason,
        restatementFromAt: payload.restatementFromAt
          ? new Date(payload.restatementFromAt)
          : undefined,
        restatementThroughAt: payload.restatementThroughAt
          ? new Date(payload.restatementThroughAt)
          : undefined,
        requestedBy: context.authority.membership.membershipId,
      }),
  });
}

export async function approveInventoryCostRevaluationFromRequest(request: Request, input: unknown) {
  const payload = inventoryCostRevaluationTransitionPayload.parse(input);
  const context = await contextFor(request, payload);
  const key = requireIdempotency(request);
  return executeInventoryCommand({
    context,
    commandType: 'ApproveInventoryCostRevaluation',
    permissionCode: 'approval.act',
    idempotencyKey: key,
    requestHash: requestHash(payload),
    audit: {
      actionCode: 'INVENTORY.COST_REVALUATION_APPROVED',
      subjectType: 'InventoryCostRevaluation',
      subjectId: payload.revaluationId,
    },
    execute: (transaction) =>
      approveInventoryCostRevaluationInTransaction(transaction, {
        tenantId: context.tenantId,
        stationId: context.stationId,
        revaluationId: payload.revaluationId,
        approvedBy: context.authority.membership.membershipId,
      }),
  });
}

export async function postInventoryCostRevaluationFromRequest(request: Request, input: unknown) {
  const payload = inventoryCostRevaluationTransitionPayload.parse(input);
  const context = await contextFor(request, payload);
  const key = requireIdempotency(request);
  return executeInventoryCommand({
    context,
    commandType: 'PostInventoryCostRevaluation',
    permissionCode: 'inventory.adjustment.post',
    idempotencyKey: key,
    requestHash: requestHash(payload),
    audit: {
      actionCode: 'INVENTORY.COST_REVALUATION_POSTED',
      subjectType: 'InventoryCostRevaluation',
      subjectId: payload.revaluationId,
    },
    execute: (transaction) =>
      postInventoryCostRevaluationInTransaction(transaction, {
        tenantId: context.tenantId,
        stationId: context.stationId,
        revaluationId: payload.revaluationId,
        postedBy: context.authority.membership.membershipId,
      }),
  });
}
