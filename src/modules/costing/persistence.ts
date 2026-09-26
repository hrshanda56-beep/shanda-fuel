import { and, asc, eq, gte, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { AppError } from '../../platform/errors';
import {
  DECIMAL_POLICIES,
  ExactDecimal,
  type CurrencyCode,
} from '../../platform/domain/primitives';
import type { Database } from '../../platform/db';
import {
  inventoryCostEvents,
  inventoryCostStreamState,
  inventorySaleCostAttributions,
} from '../../platform/db/schema/a12';
import {
  fuelDeliveryAllocations,
  fuelDeliveries,
  inventoryMovements,
  tanks,
} from '../../platform/db/schema/a4';
import {
  deriveSaleCogsFromPreSaleState,
  projectInventoryCost,
  projectInventoryCostBeforeSale,
  projectInventoryCostThroughSale,
  type CostingEvent,
  type CostingMovement,
  type CostStreamProjection,
  type InventoryStreamKey,
} from './domain';

export type CostingTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

type StreamInput = Readonly<{
  key: InventoryStreamKey;
  movements: readonly CostingMovement[];
  costEvents: readonly CostingEvent[];
  projectionVersion: number;
}>;

type CostProjectionWrite = Readonly<{
  key: InventoryStreamKey;
  projection: CostStreamProjection;
  projectionVersion: number;
}>;

function currency(value: string): CurrencyCode {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw new AppError('VALIDATION_FAILED', 'A three-letter currency code is required');
  }
  return normalized as CurrencyCode;
}

function positiveMoney(value: string): string {
  const amount = new ExactDecimal(value).quantize(DECIMAL_POLICIES.money);
  if (!amount.value.isPositive()) {
    throw new AppError('VALIDATION_FAILED', 'An authoritative inventory cost must be positive');
  }
  return amount.toString();
}

function timestamp(value: Date | string | null): string | null {
  if (value === null) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new AppError('VALIDATION_FAILED', 'A valid costing timestamp is required');
  }
  return parsed.toISOString();
}

function sameInstant(left: Date | string, right: Date | string): boolean {
  return timestamp(left) === timestamp(right);
}

function sameCurrency(left: string, right: string): boolean {
  return currency(left) === currency(right);
}

function sameDecimal(left: string | null, right: string | null): boolean {
  return left !== null && right !== null && new ExactDecimal(left).equals(new ExactDecimal(right));
}

function streamKey(input: {
  tenantId: string;
  stationId: string;
  tankId: string;
  productId: string;
}): InventoryStreamKey {
  return {
    tenantId: input.tenantId,
    stationId: input.stationId,
    tankId: input.tankId,
    productId: input.productId,
  };
}

async function lockTankForStream(
  transaction: CostingTransaction,
  input: { tenantId: string; stationId: string; tankId: string; productId?: string },
): Promise<void> {
  const rows = await transaction
    .select({ id: tanks.id, productId: tanks.productId, status: tanks.status })
    .from(tanks)
    .where(
      and(
        eq(tanks.tenantId, input.tenantId),
        eq(tanks.stationId, input.stationId),
        eq(tanks.id, input.tankId),
      ),
    )
    .for('update');
  const tank = rows[0];
  if (!tank) throw new AppError('NOT_FOUND', 'The costing tank was not found');
  if (input.productId && tank.productId !== input.productId) {
    throw new AppError('INVARIANT_VIOLATION', 'The costing product does not match the tank');
  }
}

async function loadStreamInput(
  transaction: CostingTransaction,
  key: InventoryStreamKey,
): Promise<StreamInput> {
  const [movementRows, eventRows, stateRows] = await Promise.all([
    transaction
      .select({
        id: inventoryMovements.id,
        movementType: inventoryMovements.movementType,
        quantityLitres: inventoryMovements.quantityLitres,
        effectiveAt: inventoryMovements.effectiveAt,
        businessDate: inventoryMovements.businessDate,
        sourceType: inventoryMovements.sourceType,
        sourceId: inventoryMovements.sourceId,
      })
      .from(inventoryMovements)
      .where(
        and(
          eq(inventoryMovements.tenantId, key.tenantId),
          eq(inventoryMovements.stationId, key.stationId),
          eq(inventoryMovements.tankId, key.tankId),
          eq(inventoryMovements.productId, key.productId),
        ),
      )
      .orderBy(asc(inventoryMovements.effectiveAt), asc(inventoryMovements.id)),
    transaction
      .select({
        id: inventoryCostEvents.id,
        eventType: inventoryCostEvents.eventType,
        sourceType: inventoryCostEvents.sourceType,
        sourceId: inventoryCostEvents.sourceId,
        effectiveAt: inventoryCostEvents.effectiveAt,
        businessDate: inventoryCostEvents.businessDate,
        amount: inventoryCostEvents.amount,
        currency: inventoryCostEvents.currency,
      })
      .from(inventoryCostEvents)
      .where(
        and(
          eq(inventoryCostEvents.tenantId, key.tenantId),
          eq(inventoryCostEvents.stationId, key.stationId),
          eq(inventoryCostEvents.tankId, key.tankId),
          eq(inventoryCostEvents.productId, key.productId),
        ),
      )
      .orderBy(asc(inventoryCostEvents.effectiveAt), asc(inventoryCostEvents.id)),
    transaction
      .select({ projectionVersion: inventoryCostStreamState.projectionVersion })
      .from(inventoryCostStreamState)
      .where(
        and(
          eq(inventoryCostStreamState.tenantId, key.tenantId),
          eq(inventoryCostStreamState.stationId, key.stationId),
          eq(inventoryCostStreamState.tankId, key.tankId),
          eq(inventoryCostStreamState.productId, key.productId),
        ),
      )
      .for('update'),
  ]);

  return {
    key,
    movements: movementRows.map((row) => ({
      ...key,
      id: row.id,
      movementType: row.movementType,
      quantityLitres: row.quantityLitres,
      effectiveAt: row.effectiveAt,
      businessDate: row.businessDate,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
    })),
    costEvents: eventRows.map((row) => ({
      ...key,
      id: row.id,
      eventType: row.eventType as CostingEvent['eventType'],
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      effectiveAt: row.effectiveAt,
      businessDate: row.businessDate,
      amount: row.amount,
      currency: currency(row.currency),
    })),
    projectionVersion: Number(stateRows[0]?.projectionVersion ?? 0),
  };
}

async function persistProjectionInTransaction(
  transaction: CostingTransaction,
  input: CostProjectionWrite,
): Promise<void> {
  const { key, projection } = input;
  await transaction.execute(sql`
    select app.upsert_inventory_cost_stream_state(
      ${key.tenantId}::uuid,
      ${key.stationId}::uuid,
      ${key.tankId}::uuid,
      ${key.productId}::uuid,
      ${projection.quantityLitres}::numeric,
      ${projection.inventoryValue}::numeric,
      ${projection.currency}::text,
      ${projection.weightedAverageCost}::numeric,
      ${projection.valuationStatus}::text,
      ${timestamp(projection.lastMovement?.effectiveAt ?? null)}::timestamptz,
      ${projection.lastMovement?.id ?? null}::uuid,
      ${timestamp(projection.lastCostEvent?.effectiveAt ?? null)}::timestamptz,
      ${projection.lastCostEvent?.id ?? null}::uuid,
      ${input.projectionVersion}::integer
    )
  `);
}

async function projectAndPersist(
  transaction: CostingTransaction,
  key: InventoryStreamKey,
): Promise<CostStreamProjection> {
  const input = await loadStreamInput(transaction, key);
  const projection = projectInventoryCost(input);
  await persistProjectionInTransaction(transaction, {
    key,
    projection,
    projectionVersion: input.projectionVersion + 1,
  });
  return projection;
}

async function loadMovementBySource(
  transaction: CostingTransaction,
  input: { tenantId: string; stationId: string; sourceType: string; sourceId: string },
) {
  const rows = await transaction
    .select()
    .from(inventoryMovements)
    .where(
      and(
        eq(inventoryMovements.tenantId, input.tenantId),
        eq(inventoryMovements.stationId, input.stationId),
        eq(inventoryMovements.sourceType, input.sourceType),
        eq(inventoryMovements.sourceId, input.sourceId),
      ),
    )
    .for('update');
  const movement = rows[0];
  if (!movement)
    throw new AppError('CONFLICT', 'The authoritative inventory movement was not found');
  return movement;
}

async function assertNoLateCostRevaluation(
  transaction: CostingTransaction,
  input: { tenantId: string; stationId: string; tankId: string; effectiveAt: Date },
): Promise<void> {
  const laterSales = await transaction
    .select({ id: inventoryMovements.id })
    .from(inventoryMovements)
    .where(
      and(
        eq(inventoryMovements.tenantId, input.tenantId),
        eq(inventoryMovements.stationId, input.stationId),
        eq(inventoryMovements.tankId, input.tankId),
        eq(inventoryMovements.movementType, 'SALE'),
        eq(inventoryMovements.sourceType, 'METER_SEGMENT_SALE'),
        gte(inventoryMovements.effectiveAt, input.effectiveAt),
      ),
    )
    .limit(1);
  if (laterSales.length > 0) {
    throw new AppError(
      'CONFLICT',
      'Receipt or opening cost arrived after a historical sale; late-cost revaluation is deferred to A12.4',
    );
  }
}

async function insertOrVerifyCostEvent(
  transaction: CostingTransaction,
  input: {
    key: InventoryStreamKey;
    eventType: 'OPENING_COST' | 'RECEIPT_COST' | 'SALE_COGS';
    sourceType: string;
    sourceId: string;
    effectiveAt: Date;
    businessDate: string;
    amount: string;
    currency: CurrencyCode;
    actorMembershipId: string;
  },
): Promise<{ id: string; inserted: boolean }> {
  const existing = await transaction
    .select({
      id: inventoryCostEvents.id,
      stationId: inventoryCostEvents.stationId,
      tankId: inventoryCostEvents.tankId,
      productId: inventoryCostEvents.productId,
      amount: inventoryCostEvents.amount,
      currency: inventoryCostEvents.currency,
      effectiveAt: inventoryCostEvents.effectiveAt,
      businessDate: inventoryCostEvents.businessDate,
    })
    .from(inventoryCostEvents)
    .where(
      and(
        eq(inventoryCostEvents.tenantId, input.key.tenantId),
        eq(inventoryCostEvents.sourceType, input.sourceType),
        eq(inventoryCostEvents.sourceId, input.sourceId),
        eq(inventoryCostEvents.eventType, input.eventType),
      ),
    )
    .for('update');
  const row = existing[0];
  if (row) {
    if (
      row.stationId !== input.key.stationId ||
      row.tankId !== input.key.tankId ||
      row.productId !== input.key.productId ||
      !new ExactDecimal(row.amount).equals(new ExactDecimal(input.amount)) ||
      !sameCurrency(row.currency, input.currency) ||
      !sameInstant(row.effectiveAt, input.effectiveAt) ||
      row.businessDate !== input.businessDate
    ) {
      throw new AppError(
        'IDEMPOTENCY_CONFLICT',
        'The authoritative cost source was reused with new data',
      );
    }
    return { id: row.id, inserted: false };
  }

  const id = randomUUID();
  await transaction.insert(inventoryCostEvents).values({
    id,
    tenantId: input.key.tenantId,
    stationId: input.key.stationId,
    tankId: input.key.tankId,
    productId: input.key.productId,
    eventType: input.eventType,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    effectiveAt: input.effectiveAt,
    businessDate: input.businessDate,
    amount: input.amount,
    currency: input.currency,
    actorMembershipId: input.actorMembershipId,
  });
  return { id, inserted: true };
}

export async function persistInventoryCostProjectionInTransaction(
  transaction: CostingTransaction,
  input: InventoryStreamKey,
): Promise<CostStreamProjection> {
  return projectAndPersist(transaction, input);
}

export async function postOpeningInventoryCostInTransaction(
  transaction: CostingTransaction,
  input: {
    tenantId: string;
    stationId: string;
    tankId: string;
    amount: string;
    currency: string;
    actorMembershipId: string;
  },
): Promise<{ costEventId: string; projection: CostStreamProjection }> {
  await lockTankForStream(transaction, input);
  const openingRows = await transaction
    .select()
    .from(inventoryMovements)
    .where(
      and(
        eq(inventoryMovements.tenantId, input.tenantId),
        eq(inventoryMovements.stationId, input.stationId),
        eq(inventoryMovements.tankId, input.tankId),
        eq(inventoryMovements.movementType, 'OPENING_BALANCE'),
      ),
    )
    .for('update');
  const movement = openingRows[0];
  if (!movement) throw new AppError('CONFLICT', 'The requested tank has no opening balance');
  if (movement.tankId !== input.tankId || movement.movementType !== 'OPENING_BALANCE') {
    throw new AppError(
      'INVARIANT_VIOLATION',
      'The cost source is not the requested opening balance',
    );
  }
  const key = streamKey(movement);
  const event = await insertOrVerifyCostEvent(transaction, {
    key,
    eventType: 'OPENING_COST',
    sourceType: movement.sourceType,
    sourceId: movement.sourceId,
    effectiveAt: movement.effectiveAt,
    businessDate: movement.businessDate,
    amount: positiveMoney(input.amount),
    currency: currency(input.currency),
    actorMembershipId: input.actorMembershipId,
  });
  if (event.inserted) {
    await assertNoLateCostRevaluation(transaction, {
      tenantId: input.tenantId,
      stationId: input.stationId,
      tankId: input.tankId,
      effectiveAt: movement.effectiveAt,
    });
  }
  const projection = await projectAndPersist(transaction, key);
  return { costEventId: event.id, projection };
}

export async function postReceiptCostInTransaction(
  transaction: CostingTransaction,
  input: {
    tenantId: string;
    stationId: string;
    allocationId: string;
    amount: string;
    currency: string;
    actorMembershipId: string;
  },
): Promise<{ costEventId: string; projection: CostStreamProjection }> {
  const allocations = await transaction
    .select()
    .from(fuelDeliveryAllocations)
    .where(
      and(
        eq(fuelDeliveryAllocations.tenantId, input.tenantId),
        eq(fuelDeliveryAllocations.stationId, input.stationId),
        eq(fuelDeliveryAllocations.id, input.allocationId),
      ),
    )
    .for('update');
  const allocation = allocations[0];
  if (!allocation) throw new AppError('NOT_FOUND', 'The delivery allocation was not found');
  await lockTankForStream(transaction, {
    tenantId: input.tenantId,
    stationId: input.stationId,
    tankId: allocation.tankId,
    productId: allocation.productId,
  });
  const deliveries = await transaction
    .select({ status: fuelDeliveries.status })
    .from(fuelDeliveries)
    .where(
      and(
        eq(fuelDeliveries.tenantId, input.tenantId),
        eq(fuelDeliveries.stationId, input.stationId),
        eq(fuelDeliveries.id, allocation.deliveryId),
      ),
    )
    .limit(1);
  if (deliveries[0]?.status !== 'CONFIRMED') {
    throw new AppError('CONFLICT', 'Only a confirmed delivery can receive authoritative cost');
  }
  const movement = await loadMovementBySource(transaction, {
    tenantId: input.tenantId,
    stationId: input.stationId,
    sourceType: 'FUEL_DELIVERY_ALLOCATION',
    sourceId: input.allocationId,
  });
  if (
    movement.movementType !== 'DELIVERY' ||
    movement.sourceType !== 'FUEL_DELIVERY_ALLOCATION' ||
    movement.sourceId !== allocation.id ||
    movement.tankId !== allocation.tankId ||
    movement.productId !== allocation.productId ||
    !new ExactDecimal(movement.quantityLitres).value.isPositive()
  ) {
    throw new AppError(
      'INVARIANT_VIOLATION',
      'The delivery allocation has no canonical positive A4 movement',
    );
  }
  const key = streamKey(movement);
  const event = await insertOrVerifyCostEvent(transaction, {
    key,
    eventType: 'RECEIPT_COST',
    sourceType: movement.sourceType,
    sourceId: movement.sourceId,
    effectiveAt: movement.effectiveAt,
    businessDate: movement.businessDate,
    amount: positiveMoney(input.amount),
    currency: currency(input.currency),
    actorMembershipId: input.actorMembershipId,
  });
  if (event.inserted) {
    await assertNoLateCostRevaluation(transaction, {
      tenantId: input.tenantId,
      stationId: input.stationId,
      tankId: movement.tankId,
      effectiveAt: movement.effectiveAt,
    });
  }
  const projection = await projectAndPersist(transaction, key);
  return { costEventId: event.id, projection };
}

export async function postCanonicalSaleCostInTransaction(
  transaction: CostingTransaction,
  input: {
    tenantId: string;
    stationId: string;
    movementId: string;
    meterSegmentId: string;
    actorMembershipId: string;
    persistProjection?: boolean;
  },
): Promise<{
  costEventId: string;
  attributionId: string;
  preSaleWac: string;
  originalCogs: string;
  projection: CostStreamProjection;
}> {
  const saleRows = await transaction
    .select()
    .from(inventoryMovements)
    .where(
      and(
        eq(inventoryMovements.tenantId, input.tenantId),
        eq(inventoryMovements.stationId, input.stationId),
        eq(inventoryMovements.id, input.movementId),
      ),
    )
    .for('update');
  const sale = saleRows[0];
  if (!sale) throw new AppError('NOT_FOUND', 'The canonical sale movement was not found');
  await lockTankForStream(transaction, {
    tenantId: input.tenantId,
    stationId: input.stationId,
    tankId: sale.tankId,
    productId: sale.productId,
  });
  if (
    sale.movementType !== 'SALE' ||
    sale.sourceType !== 'METER_SEGMENT_SALE' ||
    sale.sourceId !== input.meterSegmentId ||
    !new ExactDecimal(sale.quantityLitres).value.isNegative()
  ) {
    throw new AppError(
      'INVARIANT_VIOLATION',
      'The sale movement is not canonical meter-segment evidence',
    );
  }

  const key = streamKey(sale);
  const fullInput = await loadStreamInput(transaction, key);
  const saleMovement = fullInput.movements.find((movement) => movement.id === sale.id);
  if (!saleMovement)
    throw new AppError('INTERNAL_ERROR', 'The canonical sale movement disappeared');
  const preSale = projectInventoryCostBeforeSale({
    key,
    movements: fullInput.movements,
    costEvents: fullInput.costEvents,
    saleMovementId: saleMovement.id,
  });
  if (preSale.valuationStatus !== 'VALUED' || !preSale.inventoryValue || !preSale.currency) {
    throw new AppError(
      'CONFLICT',
      'A canonical sale cannot be posted from an UNVALUED inventory stream',
    );
  }
  const derived = deriveSaleCogsFromPreSaleState({
    quantityLitres: preSale.quantityLitres,
    inventoryValue: preSale.inventoryValue,
    saleQuantityLitres: new ExactDecimal(sale.quantityLitres).value.abs().toFixed(),
  });
  const event = await insertOrVerifyCostEvent(transaction, {
    key,
    eventType: 'SALE_COGS',
    sourceType: 'METER_SEGMENT_SALE',
    sourceId: input.meterSegmentId,
    effectiveAt: sale.effectiveAt,
    businessDate: sale.businessDate,
    amount: `-${derived.originalCogs}`,
    currency: preSale.currency,
    actorMembershipId: input.actorMembershipId,
  });
  let projection: CostStreamProjection;
  if (input.persistProjection === false) {
    const afterEventInput = await loadStreamInput(transaction, key);
    projection = projectInventoryCostThroughSale({
      key,
      movements: afterEventInput.movements,
      costEvents: afterEventInput.costEvents,
      saleMovementId: sale.id,
    });
  } else {
    projection = await projectAndPersist(transaction, key);
  }
  const attribution = projection.saleAttributions.find(
    (candidate) => candidate.movementId === input.movementId,
  );
  if (!attribution)
    throw new AppError('INTERNAL_ERROR', 'The canonical sale attribution was not projected');
  const existingAttribution = await transaction
    .select()
    .from(inventorySaleCostAttributions)
    .where(
      and(
        eq(inventorySaleCostAttributions.tenantId, input.tenantId),
        eq(inventorySaleCostAttributions.stationId, input.stationId),
        eq(inventorySaleCostAttributions.inventoryMovementId, input.movementId),
      ),
    )
    .for('update');
  const storedAttribution = existingAttribution[0];
  if (storedAttribution) {
    const matches =
      storedAttribution.tenantId === input.tenantId &&
      storedAttribution.stationId === input.stationId &&
      storedAttribution.tankId === sale.tankId &&
      storedAttribution.productId === sale.productId &&
      storedAttribution.inventoryMovementId === input.movementId &&
      storedAttribution.meterSegmentId === input.meterSegmentId &&
      sameDecimal(storedAttribution.saleQuantityLitres, attribution.saleQuantityLitres) &&
      sameDecimal(storedAttribution.preSaleWac, attribution.preSaleWac) &&
      sameDecimal(storedAttribution.originalCogs, attribution.originalCogs) &&
      storedAttribution.valuationStatus === attribution.valuationStatus &&
      storedAttribution.valuationBasis === attribution.valuationBasis &&
      storedAttribution.replayFingerprint === attribution.replayFingerprint &&
      storedAttribution.saleCostEventId === event.id &&
      sameInstant(storedAttribution.effectiveAt, attribution.effectiveAt) &&
      storedAttribution.businessDate === (attribution.businessDate ?? null);
    if (!matches) {
      throw new AppError(
        'IDEMPOTENCY_CONFLICT',
        'The canonical sale attribution does not match deterministic replay',
      );
    }
  }
  const attributionId = storedAttribution?.id ?? randomUUID();
  if (!storedAttribution) {
    await transaction.insert(inventorySaleCostAttributions).values({
      id: attributionId,
      tenantId: input.tenantId,
      stationId: input.stationId,
      tankId: sale.tankId,
      productId: sale.productId,
      inventoryMovementId: input.movementId,
      meterSegmentId: input.meterSegmentId,
      saleQuantityLitres: attribution.saleQuantityLitres,
      preSaleWac: attribution.preSaleWac,
      originalCogs: attribution.originalCogs,
      valuationStatus: attribution.valuationStatus,
      valuationBasis: attribution.valuationBasis,
      replayFingerprint: attribution.replayFingerprint,
      saleCostEventId: event.id,
      effectiveAt: sale.effectiveAt,
      businessDate: sale.businessDate,
    });
  }
  return {
    costEventId: event.id,
    attributionId,
    preSaleWac: attribution.preSaleWac,
    originalCogs: attribution.originalCogs,
    projection,
  };
}
