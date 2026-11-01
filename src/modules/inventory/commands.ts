import 'server-only';

import { randomUUID } from 'node:crypto';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AppError } from '../../platform/errors';
import { deriveBusinessDate } from '../../platform/domain/business-time';
import { DECIMAL_POLICIES, ExactDecimal, litres } from '../../platform/domain/primitives';
import {
  fuelDeliveries,
  fuelDeliveryAllocations,
  inventoryMovements,
  tankCalibrationPoints,
  tanks,
  tankDips,
} from '../../platform/db/schema/a4';
import { inventoryCostStreamState } from '../../platform/db/schema/a12';
import { litresForReading, normaliseCalibrationChart } from './calibration';
import { assertLandedCostPairMatchesLitres, buildLandedCost } from './landed-cost';
import { assertWaterTestAllowsConfirmation } from '../deliveries/persistence';
import {
  assertWithinTankCapacity,
  calculateDeliveryShortageExcess,
  requireAdjustmentReason,
  validateDeliveryDipWindow,
  validateDeliveryAllocations,
} from './domain';
import {
  authorizeInventoryCommand,
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
  /** Red limit: above it a difference is urgent. Empty means twice the yellow limit. */
  varianceRedLitres: decimalText.nullish(),
});

/** Change a tank's two variance limits: yellow (explain) and red (urgent). */
const setTankVarianceLimitsPayload = authorityPayload.extend({
  tankId: uuid,
  acceptableVarianceLitres: decimalText.nullable(),
  varianceRedLitres: decimalText.nullable(),
});

const deactivateTankPayload = authorityPayload.extend({
  tankId: uuid,
  status: z.enum(['INACTIVE', 'RETIRED']),
});

const dipPayload = authorityPayload.extend({
  tankId: uuid,
  measuredAt: instant,
  /** Optional when a dipstick reading is given and the tank has a calibration chart. */
  physicalLitres: decimalText.nullish(),
  rawMeasurement: decimalText.nullish(),
  measurementUnit: z.enum(['mm', 'cm', 'inches']).nullish(),
  notes: z.string().trim().max(1000).nullish(),
});

const deliveryDipPayload = z.object({
  measuredAt: instant,
  physicalLitres: decimalText.nullish(),
  rawMeasurement: decimalText.nullish(),
  measurementUnit: z.enum(['mm', 'cm', 'inches']).nullish(),
  notes: z.string().trim().max(1000).nullish(),
});

const calibrationPayload = authorityPayload.extend({
  tankId: uuid,
  measurementUnit: z.enum(['mm', 'cm', 'inches']),
  points: z
    .array(
      z.object({
        measurement: z.string().regex(/^\d+(?:\.\d{1,3})?$/, 'A reading is required'),
        litres: z.string().regex(/^\d+(?:\.\d{1,3})?$/, 'Litres are required'),
      }),
    )
    .min(2)
    .max(500),
});

const allocationPayload = z.object({ tankId: uuid, quantityLitres: decimalText });
/** Why a delivery has no purchase order. OTHER needs a short note. */
export const NO_PO_REASONS = [
  'EMERGENCY_PURCHASE',
  'CASH_PURCHASE',
  'SUPPLIER_DIRECT',
  'PO_NOT_RAISED',
  'OTHER',
] as const;

const deliveryPayload = authorityPayload
  .extend({
    productId: uuid,
    /** Mandatory: who delivered the fuel. Must be an active supplier of this tenant. */
    supplierId: uuid,
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
    preDeliveryDip: deliveryDipPayload.nullish(),
    postDeliveryDip: deliveryDipPayload.nullish(),
    unitLandedCost: z
      .string()
      .regex(/^\d+(?:\.\d{1,8})?$/)
      .nullish(),
    totalLandedCost: z
      .string()
      .regex(/^\d+(?:\.\d{1,4})?$/)
      .nullish(),
    currency: z.string().trim().length(3).nullish(),
    noPoReason: z.enum(NO_PO_REASONS).nullish(),
    noPoNote: z.string().trim().max(300).nullish(),
  })
  .refine((value) => value.noPoReason !== 'OTHER' || !!value.noPoNote, {
    message: 'Say in a few words why there is no purchase order',
    path: ['noPoNote'],
  });

/**
 * Correcting a delivery that is still a draft: the same details as recording one. Tank dips are
 * not part of it (they were measured, not typed), and the fuel cannot change.
 */
const updateDeliveryPayload = authorityPayload
  .extend({
    deliveryId: uuid,
    supplierId: uuid,
    tankId: uuid,
    deliveryNoteNumber: z.string().trim().min(1).max(80),
    deliveredAt: instant,
    noteQuantityLitres: decimalText,
    actualQuantityLitres: decimalText,
    transporter: z.string().trim().max(120).nullish(),
    driver: z.string().trim().max(120).nullish(),
    truckRegistration: z.string().trim().max(80).nullish(),
    noPoReason: z.enum(NO_PO_REASONS).nullish(),
    noPoNote: z.string().trim().max(300).nullish(),
  })
  .refine((value) => value.noPoReason !== 'OTHER' || !!value.noPoNote, {
    message: 'Say in a few words why there is no purchase order',
    path: ['noPoNote'],
  });

const confirmDeliveryPayload = authorityPayload.extend({ deliveryId: uuid });
const voidTankDipPayload = authorityPayload.extend({
  dipId: uuid,
  reason: z.string().trim().min(5).max(500),
});
const correctDeliverySupplierPayload = authorityPayload.extend({
  deliveryId: uuid,
  supplierId: uuid,
  reason: z.string().trim().min(1).max(500),
});
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
  /** Cost per litre, as an alternative to the total: the total is worked out from the opening litres. */
  unitCost: z
    .string()
    .regex(/^\d+(?:\.\d{1,6})?$/)
    .optional(),
  currency: currencyCode,
});
const receiptCostPayload = authorityPayload.extend({
  allocationId: uuid,
  /** The cost of this tank's share, when the person already knows it. */
  amount: costAmount.optional(),
  /** Or the pieces of the delivery's cost, to be spread over the litres that arrived. */
  costBuildUp: z
    .object({
      fuelCost: costAmount,
      freight: costAmount.optional(),
      otherCosts: z
        .array(z.object({ label: z.string().trim().min(1).max(80), amount: costAmount }))
        .max(10)
        .optional(),
    })
    .optional(),
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

/** Yellow and red limits: neither is negative, and red is never below yellow. */
function assertVarianceLimits(
  yellow: string | null | undefined,
  red: string | null | undefined,
): void {
  if (yellow && litres(yellow).value.isNegative()) {
    throw new AppError('VALIDATION_FAILED', 'The yellow limit cannot be negative');
  }
  if (red && litres(red).value.isNegative()) {
    throw new AppError('VALIDATION_FAILED', 'The red limit cannot be negative');
  }
  if (red && !yellow) {
    throw new AppError('VALIDATION_FAILED', 'Set the yellow limit before the red one');
  }
  if (red && yellow && litres(red).value.lt(litres(yellow).value)) {
    throw new AppError('VALIDATION_FAILED', 'The red limit cannot be lower than the yellow limit');
  }
}

async function insertTank(
  transaction: InventoryTransaction,
  context: InventoryCommandContext,
  payload: z.infer<typeof createTankPayload>,
): Promise<{ tankId: string; code: string }> {
  await assertProductBelongsToTenant(transaction, context.tenantId, payload.productId);
  const capacity = litres(payload.capacityLitres);
  if (!capacity.value.gt(0))
    throw new AppError('VALIDATION_FAILED', 'Tank capacity must be positive');
  if (payload.reorderLevelLitres) {
    const reorder = litres(payload.reorderLevelLitres);
    if (reorder.value.isNegative() || reorder.value.gt(capacity.value)) {
      throw new AppError('VALIDATION_FAILED', 'Reorder level must be between zero and capacity');
    }
  }
  if (
    payload.acceptableVarianceLitres &&
    litres(payload.acceptableVarianceLitres).value.isNegative()
  ) {
    throw new AppError('VALIDATION_FAILED', 'Acceptable variance cannot be negative');
  }
  assertVarianceLimits(payload.acceptableVarianceLitres, payload.varianceRedLitres);
  // Pumps are not linked to individual tanks, so the day's stock check cannot tell two tanks of one
  // fuel apart and would refuse to close the day. Refuse the second tank up front instead.
  const sameFuel = await transaction
    .select({ code: tanks.code })
    .from(tanks)
    .where(
      and(
        eq(tanks.tenantId, context.tenantId),
        eq(tanks.stationId, context.stationId),
        eq(tanks.productId, payload.productId),
        eq(tanks.status, 'ACTIVE'),
      ),
    )
    .limit(1);
  if (sameFuel[0]) {
    throw new AppError(
      'CONFLICT',
      `This station already has an active tank for this fuel (${sameFuel[0].code}). Two tanks of the same fuel cannot be tracked yet. Ask the owner before adding another.`,
    );
  }
  const tankId = randomUUID();
  try {
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
      varianceRedLitres: payload.varianceRedLitres
        ? litres(payload.varianceRedLitres).toString()
        : null,
      status: 'ACTIVE',
      createdBy: context.authority.membership.membershipId,
      updatedBy: context.authority.membership.membershipId,
    });
  } catch (error) {
    const code = (error as { code?: string })?.code;
    const causeCode = (error as { cause?: { code?: string } })?.cause?.code;
    if (code === '23505' || causeCode === '23505') {
      throw new AppError('CONFLICT', 'A tank with this code already exists at the station');
    }
    throw error;
  }
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

export async function setTankVarianceLimitsFromRequest(request: Request, input: unknown) {
  const payload = setTankVarianceLimitsPayload.parse(input);
  assertVarianceLimits(payload.acceptableVarianceLitres, payload.varianceRedLitres);
  const context = await contextFor(request, payload);
  const key = requireIdempotency(request);
  return executeInventoryCommand({
    context,
    commandType: 'SetTankVarianceLimits',
    permissionCode: 'inventory.tank.manage',
    idempotencyKey: key,
    requestHash: requestHash(payload),
    audit: {
      actionCode: 'INVENTORY.TANK_VARIANCE_LIMITS_SET',
      subjectType: 'Tank',
      subjectId: payload.tankId,
      readBefore: async (transaction) => {
        const rows = await transaction.execute<{
          acceptable: string | null;
          red: string | null;
        }>(sql`
          select acceptable_variance_litres::text as acceptable, variance_red_litres::text as red
          from app.tanks where tenant_id = ${context.tenantId} and id = ${payload.tankId}
        `);
        return rows[0]
          ? { acceptableVarianceLitres: rows[0].acceptable, varianceRedLitres: rows[0].red }
          : undefined;
      },
    },
    execute: async (transaction) => {
      const tank = await loadTankForUpdate(transaction, {
        tenantId: context.tenantId,
        stationId: context.stationId,
        tankId: payload.tankId,
      });
      await transaction
        .update(tanks)
        .set({
          acceptableVarianceLitres: payload.acceptableVarianceLitres
            ? litres(payload.acceptableVarianceLitres).toString()
            : null,
          varianceRedLitres: payload.varianceRedLitres
            ? litres(payload.varianceRedLitres).toString()
            : null,
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
      return {
        tankId: tank.id,
        acceptableVarianceLitres: payload.acceptableVarianceLitres ?? null,
        varianceRedLitres: payload.varianceRedLitres ?? null,
      };
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
      readBefore: async (transaction) => {
        const rows = await transaction.execute<{ status: string }>(sql`
          select status from app.tanks
          where tenant_id = ${context.tenantId} and id = ${payload.tankId}
        `);
        return rows[0] ? { status: rows[0].status } : undefined;
      },
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

/** The newest calibration chart for a tank in one unit, or null when none was entered. */
async function currentCalibration(
  transaction: InventoryTransaction,
  context: InventoryCommandContext,
  tankId: string,
  unit: string,
): Promise<{ version: number; points: { measurement: string; litres: string }[] } | null> {
  const rows = await transaction.execute<{
    chart_version: number;
    measurement: string;
    litres: string;
  }>(sql`
    select chart_version, measurement_value::text as measurement, litres::text as litres
    from app.tank_calibration_points p
    where p.tenant_id = ${context.tenantId}
      and p.station_id = ${context.stationId}
      and p.tank_id = ${tankId}
      and p.measurement_unit = ${unit}
      and p.chart_version = (
        select max(chart_version) from app.tank_calibration_points
        where tenant_id = p.tenant_id and tank_id = p.tank_id and measurement_unit = p.measurement_unit
      )
    order by measurement_value
  `);
  if (rows.length === 0) return null;
  return {
    version: Number(rows[0]!.chart_version),
    points: rows.map((row) => ({ measurement: row.measurement, litres: row.litres })),
  };
}

/**
 * The litres a dip records: worked out from the tank's chart when a dipstick reading comes with a
 * chart, otherwise the litres the person typed. A reading with no chart and no litres is refused.
 */
async function dipLitres(
  transaction: InventoryTransaction,
  context: InventoryCommandContext,
  tankId: string,
  payload: Pick<
    z.infer<typeof dipPayload>,
    'rawMeasurement' | 'measurementUnit' | 'physicalLitres'
  >,
): Promise<string> {
  if (payload.rawMeasurement && payload.measurementUnit) {
    const chart = await currentCalibration(transaction, context, tankId, payload.measurementUnit);
    if (chart) return litresForReading(chart.points, payload.rawMeasurement);
  }
  if (!payload.physicalLitres) {
    throw new AppError(
      'VALIDATION_FAILED',
      payload.rawMeasurement
        ? 'This tank has no calibration chart for that unit yet. Add the chart, or enter the litres.'
        : 'Enter the litres in the tank',
    );
  }
  return litres(payload.physicalLitres).toString();
}

async function insertTankDipInTransaction(
  transaction: InventoryTransaction,
  context: InventoryCommandContext,
  tankId: string,
  payload: z.infer<typeof deliveryDipPayload>,
): Promise<{ dipId: string; tankId: string; physicalLitres: string }> {
  if ((payload.rawMeasurement === undefined) !== (payload.measurementUnit === undefined)) {
    throw new AppError(
      'VALIDATION_FAILED',
      'Raw dip measurement and unit must be supplied together',
    );
  }
  const tank = await loadTankForUpdate(transaction, {
    tenantId: context.tenantId,
    stationId: context.stationId,
    tankId,
  });
  if (tank.status === 'RETIRED') throw new AppError('CONFLICT', 'Retired tanks cannot be dipped');
  const physicalLitres = await dipLitres(transaction, context, tank.id, payload);
  assertWithinTankCapacity(physicalLitres, tank.capacityLitres);
  const dipId = randomUUID();
  await transaction.insert(tankDips).values({
    id: dipId,
    tenantId: context.tenantId,
    stationId: context.stationId,
    tankId: tank.id,
    measuredAt: new Date(payload.measuredAt),
    businessDate: deriveBusinessDate(payload.measuredAt, context.stationTimezone),
    physicalLitres,
    rawMeasurement: payload.rawMeasurement ? litres(payload.rawMeasurement).toString() : null,
    measurementUnit: payload.measurementUnit ?? null,
    recordedBy: context.authority.membership.membershipId,
    notes: payload.notes ?? null,
  });
  return { dipId, tankId: tank.id, physicalLitres };
}

export async function setTankCalibrationFromRequest(request: Request, input: unknown) {
  const payload = calibrationPayload.parse(input);
  const context = await contextFor(request, payload);
  const key = requireIdempotency(request);
  return executeInventoryCommand({
    context,
    commandType: 'SetTankCalibration',
    permissionCode: 'inventory.tank.manage',
    idempotencyKey: key,
    requestHash: requestHash(payload),
    audit: {
      actionCode: 'INVENTORY.TANK_CALIBRATION_SET',
      subjectType: 'Tank',
      subjectId: payload.tankId,
    },
    execute: async (transaction) => {
      const tank = await loadTankForUpdate(transaction, {
        tenantId: context.tenantId,
        stationId: context.stationId,
        tankId: payload.tankId,
      });
      const chart = normaliseCalibrationChart(payload.points, tank.capacityLitres);
      const previous = await currentCalibration(
        transaction,
        context,
        tank.id,
        payload.measurementUnit,
      );
      const chartVersion = (previous?.version ?? 0) + 1;
      await transaction.insert(tankCalibrationPoints).values(
        chart.map((row) => ({
          tenantId: context.tenantId,
          stationId: context.stationId,
          tankId: tank.id,
          measurementUnit: payload.measurementUnit,
          measurementValue: row.measurement,
          litres: row.litres,
          chartVersion,
          recordedBy: context.authority.membership.membershipId,
        })),
      );
      return { tankId: tank.id, chartVersion, rows: chart.length };
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
      return insertTankDipInTransaction(transaction, context, payload.tankId, payload);
    },
  });
}

export async function voidTankDipFromRequest(request: Request, input: unknown) {
  const payload = voidTankDipPayload.parse(input);
  const context = await contextFor(request, payload);
  const key = requireIdempotency(request);
  return executeInventoryCommand({
    context,
    commandType: 'VoidTankDip',
    permissionCode: 'inventory.dip.record',
    idempotencyKey: key,
    requestHash: requestHash(payload),
    audit: {
      actionCode: 'INVENTORY.TANK_DIP_VOIDED',
      subjectType: 'TankDip',
      subjectId: payload.dipId,
      reason: payload.reason,
    },
    execute: async (transaction) => {
      const dips = await transaction.execute<{ id: string; voided_at: Date | string | null }>(sql`
        select id, voided_at
        from app.tank_dips
        where tenant_id=${context.tenantId} and station_id=${context.stationId} and id=${payload.dipId}
        for update
      `);
      const dip = dips[0];
      if (!dip) throw new AppError('NOT_FOUND', 'That tank dip was not found');
      if (dip.voided_at) throw new AppError('CONFLICT', 'That tank dip has already been voided');
      const deliveryRefs = await transaction.execute<{ id: string }>(sql`
        select id
        from app.fuel_deliveries
        where tenant_id=${context.tenantId} and station_id=${context.stationId}
          and (pre_delivery_dip_id=${payload.dipId} or post_delivery_dip_id=${payload.dipId})
        limit 1
      `);
      if (deliveryRefs[0]) {
        throw new AppError(
          'CONFLICT',
          'This dip is attached to a delivery and cannot be voided. Correct the delivery instead.',
        );
      }
      const reconciliationRefs = await transaction.execute<{ id: string }>(sql`
        select id
        from app.reconciliation_dip_refs
        where tenant_id=${context.tenantId} and station_id=${context.stationId} and dip_id=${payload.dipId}
        limit 1
      `);
      if (reconciliationRefs[0]) {
        throw new AppError(
          'CONFLICT',
          'This dip is attached to a reconciliation and cannot be voided. Remove that link first.',
        );
      }
      await transaction.execute(sql`
        update app.tank_dips
        set voided_at=now(), voided_by=${context.authority.membership.membershipId}, void_reason=${payload.reason}
        where tenant_id=${context.tenantId} and station_id=${context.stationId} and id=${payload.dipId} and voided_at is null
      `);
      return { dipId: payload.dipId, voided: true };
    },
  });
}

async function assertActiveSupplier(
  transaction: InventoryTransaction,
  tenantId: string,
  supplierId: string,
): Promise<void> {
  const rows = await transaction.execute<{ status: string }>(sql`
    select status from app.suppliers where tenant_id = ${tenantId} and id = ${supplierId}
  `);
  if (!rows[0]) {
    throw new AppError(
      'NOT_FOUND',
      'That supplier was not found. Pick a supplier from your supplier list, or add the supplier first.',
    );
  }
  if (rows[0].status !== 'ACTIVE') {
    throw new AppError(
      'CONFLICT',
      'That supplier is inactive, so it cannot receive new deliveries. Pick an active supplier or reactivate this one.',
    );
  }
}

/**
 * A dip attached to a delivery is evidence of what arrived, so it must be a real, current reading of
 * the tank the fuel went into. A dip cannot be both typed in and picked from the existing ones.
 */
async function assertDeliveryDipEvidence(
  transaction: InventoryTransaction,
  context: InventoryCommandContext,
  payload: z.infer<typeof deliveryPayload>,
  allocations: readonly { tankId: string }[],
): Promise<void> {
  const slots = [
    { label: 'before', inline: payload.preDeliveryDip, dipId: payload.preDeliveryDipId },
    { label: 'after', inline: payload.postDeliveryDip, dipId: payload.postDeliveryDipId },
  ];
  for (const slot of slots) {
    if (!slot.dipId) continue;
    if (slot.inline) {
      throw new AppError(
        'VALIDATION_FAILED',
        `Choose an existing ${slot.label}-delivery dip or enter a new one, not both.`,
      );
    }
    const rows = await transaction
      .select({ tankId: tankDips.tankId, voidedAt: tankDips.voidedAt })
      .from(tankDips)
      .where(
        and(
          eq(tankDips.tenantId, context.tenantId),
          eq(tankDips.stationId, context.stationId),
          eq(tankDips.id, slot.dipId),
        ),
      )
      .limit(1);
    const dip = rows[0];
    if (!dip) {
      throw new AppError('NOT_FOUND', `The ${slot.label}-delivery dip could not be found.`);
    }
    if (dip.voidedAt) {
      throw new AppError(
        'CONFLICT',
        `The ${slot.label}-delivery dip was cancelled. Pick a dip that is still valid.`,
      );
    }
    if (!allocations.some((allocation) => allocation.tankId === dip.tankId)) {
      throw new AppError(
        'CONFLICT',
        `The ${slot.label}-delivery dip is for a different tank than the one receiving this fuel.`,
      );
    }
  }
}

async function insertDeliveryRow(
  transaction: InventoryTransaction,
  values: typeof fuelDeliveries.$inferInsert,
): Promise<void> {
  try {
    await transaction.insert(fuelDeliveries).values(values);
  } catch (error) {
    const constraint =
      (error as { constraint_name?: string })?.constraint_name ??
      (error as { cause?: { constraint_name?: string } })?.cause?.constraint_name;
    if (constraint === 'fuel_deliveries_station_note_uidx') {
      throw new AppError(
        'CONFLICT',
        `A delivery with note number ${values.deliveryNoteNumber} is already recorded at this station. Check the note number, or open the existing delivery.`,
      );
    }
    throw error;
  }
}

async function insertDelivery(
  transaction: InventoryTransaction,
  context: InventoryCommandContext,
  payload: z.infer<typeof deliveryPayload>,
): Promise<{
  deliveryId: string;
  allocationIds: readonly string[];
  preDeliveryDipId: string | null;
  postDeliveryDipId: string | null;
}> {
  await assertProductBelongsToTenant(transaction, context.tenantId, payload.productId);
  await assertActiveSupplier(transaction, context.tenantId, payload.supplierId);
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
  if ((payload.preDeliveryDip || payload.postDeliveryDip) && sortedAllocations.length !== 1) {
    throw new AppError(
      'VALIDATION_FAILED',
      'Before and after dips can only be recorded when the delivery is allocated to one tank.',
    );
  }
  validateDeliveryDipWindow(
    payload.deliveredAt,
    payload.preDeliveryDip?.measuredAt,
    payload.postDeliveryDip?.measuredAt,
  );
  const dipTankId = sortedAllocations[0]?.tankId;
  await assertDeliveryDipEvidence(transaction, context, payload, sortedAllocations);
  const preDeliveryDip =
    payload.preDeliveryDip && dipTankId
      ? await insertTankDipInTransaction(transaction, context, dipTankId, payload.preDeliveryDip)
      : null;
  const postDeliveryDip =
    payload.postDeliveryDip && dipTankId
      ? await insertTankDipInTransaction(transaction, context, dipTankId, payload.postDeliveryDip)
      : null;
  assertLandedCostPairMatchesLitres({
    unitLandedCost: payload.unitLandedCost,
    totalLandedCost: payload.totalLandedCost,
    currency: payload.currency,
    actualLitres: actual.toString(),
  });
  const deliveryId = randomUUID();
  const noteQuantity = litres(payload.noteQuantityLitres);
  const shortageExcess = calculateDeliveryShortageExcess(
    noteQuantity.toString(),
    actual.toString(),
  );
  await insertDeliveryRow(transaction, {
    id: deliveryId,
    tenantId: context.tenantId,
    stationId: context.stationId,
    productId: payload.productId,
    supplierId: payload.supplierId,
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
    preDeliveryDipId: preDeliveryDip?.dipId ?? payload.preDeliveryDipId ?? null,
    postDeliveryDipId: postDeliveryDip?.dipId ?? payload.postDeliveryDipId ?? null,
    status: 'DRAFT',
    noPoReason: payload.noPoReason ?? null,
    noPoNote: payload.noPoReason ? payload.noPoNote || null : null,
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
    preDeliveryDipId: preDeliveryDip?.dipId ?? payload.preDeliveryDipId ?? null,
    postDeliveryDipId: postDeliveryDip?.dipId ?? payload.postDeliveryDipId ?? null,
  };
}

/**
 * Changes the details of a delivery that has not been confirmed. Refused once it is confirmed or
 * cancelled (the database refuses too), when it is split across tanks, or when the change would
 * contradict something already recorded: a linked purchase order, a landed cost, or the dips of
 * the current tank.
 */
export async function updateDeliveryFromRequest(request: Request, input: unknown) {
  const payload = updateDeliveryPayload.parse(input);
  const context = await contextFor(request, payload);
  const key = requireIdempotency(request);
  return executeInventoryCommand({
    context,
    commandType: 'UpdateDelivery',
    permissionCode: 'inventory.delivery.manage',
    idempotencyKey: key,
    requestHash: requestHash(payload),
    audit: {
      actionCode: 'INVENTORY.DELIVERY_UPDATED',
      subjectType: 'FuelDelivery',
      subjectId: payload.deliveryId,
      readBefore: async (transaction) => {
        const rows = await transaction.execute<{
          status: string;
          supplier_id: string | null;
          delivery_note_number: string;
          note_quantity_litres: string;
          actual_quantity_litres: string;
        }>(sql`
          select status, supplier_id, delivery_note_number,
            note_quantity_litres::text as note_quantity_litres,
            actual_quantity_litres::text as actual_quantity_litres
          from app.fuel_deliveries
          where tenant_id = ${context.tenantId} and id = ${payload.deliveryId}
        `);
        return rows[0]
          ? {
              status: rows[0].status,
              supplierId: rows[0].supplier_id,
              deliveryNoteNumber: rows[0].delivery_note_number,
              noteQuantityLitres: rows[0].note_quantity_litres,
              actualQuantityLitres: rows[0].actual_quantity_litres,
            }
          : undefined;
      },
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
      if (delivery.status !== 'DRAFT') {
        throw new AppError(
          'CONFLICT',
          'This delivery is already confirmed or cancelled, so its details can no longer be changed.',
        );
      }
      const allocations = await transaction
        .select()
        .from(fuelDeliveryAllocations)
        .where(
          and(
            eq(fuelDeliveryAllocations.tenantId, context.tenantId),
            eq(fuelDeliveryAllocations.stationId, context.stationId),
            eq(fuelDeliveryAllocations.deliveryId, delivery.id),
          ),
        );
      const allocation = allocations[0];
      if (allocations.length !== 1 || !allocation) {
        throw new AppError(
          'CONFLICT',
          'This delivery is split across several tanks, so it cannot be edited here.',
        );
      }
      await assertActiveSupplier(transaction, context.tenantId, payload.supplierId);
      if (payload.supplierId !== delivery.supplierId) {
        const linked = await transaction.execute(sql`
          select 1 from app.purchase_order_delivery_links
          where tenant_id = ${context.tenantId} and delivery_id = ${delivery.id} and state = 'ACTIVE'
        `);
        if (linked.length > 0) {
          throw new AppError(
            'CONFLICT',
            'This delivery is linked to a purchase order, so its supplier cannot be changed. Unlink the order in Purchasing first.',
          );
        }
      }
      const tank = await loadTankForUpdate(transaction, {
        tenantId: context.tenantId,
        stationId: context.stationId,
        tankId: payload.tankId,
      });
      if (tank.productId !== delivery.productId) {
        throw new AppError('CONFLICT', 'Choose a tank that holds the same fuel as this delivery.');
      }
      if (tank.status === 'RETIRED') {
        throw new AppError('CONFLICT', 'Retired tanks cannot receive deliveries');
      }
      if (
        payload.tankId !== allocation.tankId &&
        (delivery.preDeliveryDipId !== null || delivery.postDeliveryDipId !== null)
      ) {
        throw new AppError(
          'CONFLICT',
          'Tank dips were recorded for the tank this delivery is going into, so the tank cannot be changed.',
        );
      }
      const actual = litres(payload.actualQuantityLitres);
      const note = litres(payload.noteQuantityLitres);
      if (
        delivery.totalLandedCost !== null &&
        !litres(delivery.actualQuantityLitres).value.eq(actual.value)
      ) {
        throw new AppError(
          'CONFLICT',
          'A cost is already recorded for this delivery, so the litres received cannot be changed.',
        );
      }
      validateDeliveryAllocations(payload.actualQuantityLitres, [payload.actualQuantityLitres]);
      try {
        await transaction
          .update(fuelDeliveries)
          .set({
            supplierId: payload.supplierId,
            deliveryNoteNumber: payload.deliveryNoteNumber,
            deliveredAt: new Date(payload.deliveredAt),
            businessDate: deriveBusinessDate(payload.deliveredAt, context.stationTimezone),
            noteQuantityLitres: note.toString(),
            actualQuantityLitres: actual.toString(),
            shortageExcessLitres: calculateDeliveryShortageExcess(
              note.toString(),
              actual.toString(),
            ),
            transporter: payload.transporter || null,
            driver: payload.driver || null,
            truckRegistration: payload.truckRegistration || null,
            noPoReason: payload.noPoReason ?? null,
            noPoNote: payload.noPoReason ? payload.noPoNote || null : null,
          })
          .where(
            and(
              eq(fuelDeliveries.tenantId, context.tenantId),
              eq(fuelDeliveries.stationId, context.stationId),
              eq(fuelDeliveries.id, delivery.id),
            ),
          );
      } catch (error) {
        const constraint =
          (error as { constraint_name?: string })?.constraint_name ??
          (error as { cause?: { constraint_name?: string } })?.cause?.constraint_name;
        if (constraint === 'fuel_deliveries_station_note_uidx') {
          throw new AppError(
            'CONFLICT',
            `A delivery with note number ${payload.deliveryNoteNumber} is already recorded at this station. Check the note number, or open the existing delivery.`,
          );
        }
        throw error;
      }
      await transaction
        .update(fuelDeliveryAllocations)
        .set({ tankId: payload.tankId, quantityLitres: actual.toString() })
        .where(
          and(
            eq(fuelDeliveryAllocations.tenantId, context.tenantId),
            eq(fuelDeliveryAllocations.stationId, context.stationId),
            eq(fuelDeliveryAllocations.id, allocation.id),
          ),
        );
      return { deliveryId: delivery.id };
    },
  });
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
      readBefore: async (transaction) => {
        const rows = await transaction.execute<{ status: string }>(sql`
          select status from app.fuel_deliveries
          where tenant_id = ${context.tenantId} and id = ${payload.deliveryId}
        `);
        return rows[0] ? { status: rows[0].status } : undefined;
      },
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
      if (delivery.supplierId === null) {
        throw new AppError(
          'CONFLICT',
          'This delivery has no supplier recorded. Every delivery must say who delivered the fuel, so assign a supplier (Correct delivery supplier) before confirming it.',
        );
      }
      await assertActiveSupplier(transaction, context.tenantId, delivery.supplierId);
      if (delivery.status !== 'DRAFT')
        throw new AppError('CONFLICT', 'Only draft deliveries can be confirmed');
      if (delivery.noPoReason === null) {
        const linked = await transaction.execute(sql`
          select 1 from app.purchase_order_delivery_links
          where tenant_id = ${context.tenantId} and delivery_id = ${delivery.id} and state = 'ACTIVE'
        `);
        if (linked.length === 0) {
          throw new AppError(
            'CONFLICT',
            'This delivery has no purchase order. Link it to a purchase order, or record why there is none, before confirming it.',
          );
        }
      }
      // Only enforced when the owner turned the water-test rule on; otherwise recorded, not blocking.
      await assertWaterTestAllowsConfirmation(transaction, {
        tenantId: context.tenantId,
        stationId: context.stationId,
        deliveryId: delivery.id,
      });
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
      return { deliveryId: delivery.id, status: 'CONFIRMED', movementCount: allocations.length };
    },
  });
}

/**
 * Named, audited correction of the supplier on a delivery (never a plain edit). Allowed on
 * a draft or confirmed delivery, also to assign a legacy "supplier unassigned" delivery, and
 * refused once any posted supplier document references the delivery. Needs the delivery
 * permission (high-risk, so a current step-up) plus the supplier-link permission, and a
 * reason.
 */
export async function correctDeliverySupplierFromRequest(request: Request, input: unknown) {
  const payload = correctDeliverySupplierPayload.parse(input);
  const context = await contextFor(request, payload);
  const key = requireIdempotency(request);
  authorizeInventoryCommand(context, 'supplier.delivery.link');
  return executeInventoryCommand({
    context,
    commandType: 'CorrectDeliverySupplier',
    permissionCode: 'inventory.delivery.manage',
    idempotencyKey: key,
    requestHash: requestHash(payload),
    audit: {
      actionCode: 'INVENTORY.DELIVERY_SUPPLIER_CORRECTED',
      subjectType: 'FuelDelivery',
      subjectId: payload.deliveryId,
      reason: payload.reason,
    },
    execute: async (transaction) => {
      // Lock order matches PostSupplierDocument: the delivery row first.
      const rows = await transaction.execute<{
        id: string;
        status: string;
        supplier_id: string | null;
        delivery_note_number: string;
      }>(sql`
        select id, status, supplier_id, delivery_note_number
        from app.fuel_deliveries
        where tenant_id = ${context.tenantId} and station_id = ${context.stationId}
          and id = ${payload.deliveryId}
        for update
      `);
      const delivery = rows[0];
      if (!delivery) throw new AppError('NOT_FOUND', 'The requested delivery was not found');
      if (delivery.status === 'CANCELLED') {
        throw new AppError('CONFLICT', 'A cancelled delivery cannot be changed.');
      }
      if (delivery.supplier_id === payload.supplierId) {
        throw new AppError(
          'CONFLICT',
          'That supplier is already recorded on this delivery, so there is nothing to correct.',
        );
      }
      await assertActiveSupplier(transaction, context.tenantId, payload.supplierId);
      const posted = await transaction.execute<{ reference_number: string }>(sql`
        select distinct d.reference_number
        from app.supplier_document_delivery_refs r
        join app.supplier_documents d on d.tenant_id = r.tenant_id and d.id = r.supplier_document_id
        where r.tenant_id = ${context.tenantId} and r.delivery_id = ${delivery.id}
          and d.state in ('POSTED', 'PARTIALLY_PAID', 'PAID')
        order by d.reference_number
      `);
      if (posted.length > 0) {
        throw new AppError(
          'CONFLICT',
          `Delivery note ${delivery.delivery_note_number} is already covered by posted supplier document ${posted
            .map((row) => row.reference_number)
            .join(', ')}, so its supplier can no longer be changed. Reverse that document first.`,
        );
      }
      await transaction.execute(
        sql`select set_config('app.delivery_supplier_correction', 'on', true)`,
      );
      await transaction.execute(sql`
        update app.fuel_deliveries
        set supplier_id = ${payload.supplierId}, updated_at = now()
        where tenant_id = ${context.tenantId} and id = ${delivery.id}
      `);
      await transaction.execute(
        sql`select set_config('app.delivery_supplier_correction', 'off', true)`,
      );
      await transaction.execute(sql`
        insert into app.delivery_supplier_corrections (
          tenant_id, station_id, delivery_id, previous_supplier_id, supplier_id, reason,
          actor_membership_id
        ) values (
          ${context.tenantId}, ${context.stationId}, ${delivery.id}, ${delivery.supplier_id},
          ${payload.supplierId}, ${payload.reason}, ${context.authority.membership.membershipId}
        )
      `);
      return {
        deliveryId: delivery.id,
        previousSupplierId: delivery.supplier_id,
        supplierId: payload.supplierId,
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
    execute: async (transaction) => {
      const tank = await loadTankForUpdate(transaction, {
        tenantId: context.tenantId,
        stationId: context.stationId,
        tankId: payload.tankId,
      });
      await assertNoCostRecordBlocksAdjustment(transaction, context, tank);
      return {
        movementId: await postInventoryMovementInTransaction(transaction, {
          tenantId: context.tenantId,
          stationId: context.stationId,
          tankId: payload.tankId,
          productId: tank.productId,
          movementType: payload.movementType,
          quantityLitres: signedQuantity,
          effectiveAt: new Date(payload.effectiveAt),
          businessDate: deriveBusinessDate(payload.effectiveAt, context.stationTimezone),
          sourceType: 'MANUAL_ADJUSTMENT',
          sourceId: randomUUID(),
          actorMembershipId: context.authority.membership.membershipId,
          reason,
        }),
      };
    },
  });
}

/**
 * The cost record has no rule yet for stock that leaves or appears outside a delivery or a sale.
 * Posting one would make every later delivery, cost entry or sale on this tank fail, so it is
 * refused up front with a message the manager can act on.
 */
async function assertNoCostRecordBlocksAdjustment(
  transaction: InventoryTransaction,
  context: InventoryCommandContext,
  tank: { id: string; productId: string },
): Promise<void> {
  const costed = await transaction
    .select({ tankId: inventoryCostStreamState.tankId })
    .from(inventoryCostStreamState)
    .where(
      and(
        eq(inventoryCostStreamState.tenantId, context.tenantId),
        eq(inventoryCostStreamState.stationId, context.stationId),
        eq(inventoryCostStreamState.tankId, tank.id),
        eq(inventoryCostStreamState.productId, tank.productId),
      ),
    )
    .limit(1);
  if (costed.length > 0) {
    throw new AppError(
      'CONFLICT',
      'This tank already has a cost record, so its stock cannot be adjusted here yet. Ask the owner to record the correction.',
    );
  }
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
      if (!value.amount && !value.inventoryValue && !value.unitCost) {
        ctx.addIssue({ code: 'custom', message: 'An opening inventory value is required' });
      }
      if (value.unitCost && (value.amount || value.inventoryValue)) {
        ctx.addIssue({
          code: 'custom',
          message: 'Give either the cost per litre or the total value, not both',
        });
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
    execute: async (transaction) => {
      let amount = payload.amount ?? payload.inventoryValue;
      if (!amount) {
        const rows = await transaction.execute<{ quantity: string }>(sql`
          select quantity_litres::text as quantity
          from app.inventory_movements
          where tenant_id = ${context.tenantId} and station_id = ${context.stationId}
            and tank_id = ${payload.tankId} and movement_type = 'OPENING_BALANCE'
        `);
        const opening = rows[0];
        if (!opening) {
          throw new AppError('CONFLICT', 'Record the opening litres for this tank before its cost');
        }
        amount = new ExactDecimal(opening.quantity)
          .multiply(new ExactDecimal(payload.unitCost!))
          .quantize(DECIMAL_POLICIES.money)
          .toString();
      }
      return postOpeningInventoryCostInTransaction(transaction, {
        tenantId: context.tenantId,
        stationId: context.stationId,
        tankId: payload.tankId,
        amount,
        currency: payload.currency,
        actorMembershipId: context.authority.membership.membershipId,
      });
    },
  });
}

export async function recordReceiptCostFromRequest(request: Request, input: unknown) {
  const payload = receiptCostPayload.parse(input);
  if ((payload.amount === undefined) === (payload.costBuildUp === undefined)) {
    throw new AppError(
      'VALIDATION_FAILED',
      'Give either the cost of this share or the costs to spread over the litres received, not both',
    );
  }
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
    execute: async (transaction) => {
      let amount = payload.amount;
      let landed: ReturnType<typeof buildLandedCost> | undefined;
      if (payload.costBuildUp) {
        const rows = await transaction.execute<{ allocated: string; received: string }>(sql`
          select a.quantity_litres::text as allocated, d.actual_quantity_litres::text as received
          from app.fuel_delivery_allocations a
          join app.fuel_deliveries d
            on d.tenant_id = a.tenant_id and d.station_id = a.station_id and d.id = a.delivery_id
          where a.tenant_id = ${context.tenantId}
            and a.station_id = ${context.stationId}
            and a.id = ${payload.allocationId}
        `);
        const row = rows[0];
        if (!row) throw new AppError('NOT_FOUND', 'That delivery was not found');
        landed = buildLandedCost({
          ...payload.costBuildUp,
          deliveryLitres: row.received,
          allocationLitres: row.allocated,
        });
        amount = landed.allocationCost;
      }
      const posted = await postReceiptCostInTransaction(transaction, {
        tenantId: context.tenantId,
        stationId: context.stationId,
        allocationId: payload.allocationId,
        amount: amount!,
        currency: payload.currency,
        actorMembershipId: context.authority.membership.membershipId,
      });
      return landed
        ? { ...posted, landedCost: { ...landed, currency: payload.currency.toUpperCase() } }
        : posted;
    },
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
