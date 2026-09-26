import { and, asc, eq, gte, sql } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { AppError } from '../../platform/errors';
import {
  DECIMAL_POLICIES,
  ExactDecimal,
  type CurrencyCode,
} from '../../platform/domain/primitives';
import type { Database } from '../../platform/db';
import {
  inventoryCostEvents,
  inventoryCostRevaluationLines,
  inventoryCostRevaluations,
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
  calculateLateCostRevaluation,
  projectInventoryCost,
  projectInventoryCostWithRevaluations,
  projectInventoryCostBeforeSale,
  projectInventoryCostBeforeSaleWithRevaluations,
  projectInventoryCostThroughSale,
  projectInventoryCostThroughSaleWithRevaluations,
  type CostingEvent,
  type CostingMovement,
  type CostRevaluationCalculation,
  type CostStreamProjection,
  type InventoryStreamKey,
  type OriginalSaleCostAttribution,
  type PriorCogsRevaluationEvidence,
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
  const stateRows = await transaction
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
    .for('update');
  const [movementRows, eventRows] = await Promise.all([
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
  const projection = input.costEvents.some((event) => event.eventType === 'COGS_REVALUATION')
    ? projectInventoryCostWithRevaluations(input)
    : projectInventoryCost(input);
  await persistProjectionInTransaction(transaction, {
    key,
    projection,
    projectionVersion: input.projectionVersion + 1,
  });
  return projection;
}

export async function persistHistoricalLateSourceUnvaluedProjectionInTransaction(
  transaction: CostingTransaction,
  input: InventoryStreamKey & { sourceType: string; sourceId: string },
): Promise<boolean> {
  const stream = await loadStreamInput(transaction, input);
  const sourceMovement = stream.movements.find(
    (movement) => movement.sourceType === input.sourceType && movement.sourceId === input.sourceId,
  );
  if (
    !sourceMovement ||
    !['OPENING_BALANCE', 'DELIVERY'].includes(sourceMovement.movementType) ||
    !new ExactDecimal(sourceMovement.quantityLitres).value.isPositive()
  ) {
    return false;
  }

  const expectedCostEventType =
    sourceMovement.movementType === 'OPENING_BALANCE' ? 'OPENING_COST' : 'RECEIPT_COST';
  const hasOrdinaryCost = stream.costEvents.some(
    (event) =>
      event.eventType === expectedCostEventType &&
      event.sourceType === sourceMovement.sourceType &&
      event.sourceId === sourceMovement.sourceId,
  );
  if (hasOrdinaryCost) return false;

  const hasHistoricalSale = stream.movements.some(
    (movement) =>
      movement.movementType === 'SALE' &&
      movement.sourceType === 'METER_SEGMENT_SALE' &&
      new Date(movement.effectiveAt).getTime() >= new Date(sourceMovement.effectiveAt).getTime(),
  );
  if (!hasHistoricalSale) return false;

  const quantity = stream.movements
    .reduce(
      (total, movement) => total.add(new ExactDecimal(movement.quantityLitres)),
      new ExactDecimal('0'),
    )
    .quantize(DECIMAL_POLICIES.litres);
  if (quantity.value.isNegative()) {
    throw new AppError(
      'INVARIANT_VIOLATION',
      'The historical late source would create negative stock',
    );
  }
  const lastMovement = stream.movements[stream.movements.length - 1];
  const lastCostEvent = stream.costEvents[stream.costEvents.length - 1];
  const projection: CostStreamProjection = {
    key: stream.key,
    quantityLitres: quantity.toString(),
    inventoryValue: null,
    weightedAverageCost: null,
    currency: null,
    valuationStatus: 'UNVALUED',
    lastMovement: lastMovement
      ? { effectiveAt: lastMovement.effectiveAt, id: lastMovement.id }
      : null,
    lastCostEvent: lastCostEvent
      ? { effectiveAt: lastCostEvent.effectiveAt, id: lastCostEvent.id }
      : null,
    saleAttributions: [],
  };
  await persistProjectionInTransaction(transaction, {
    key: stream.key,
    projection,
    projectionVersion: stream.projectionVersion + 1,
  });
  return true;
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

function deterministicUuid(seed: string): string {
  const hex = createHash('sha256').update(seed, 'utf8').digest('hex').slice(0, 32);
  const versioned = `${hex.slice(0, 12)}5${hex.slice(13, 16)}8${hex.slice(17)}`;
  return `${versioned.slice(0, 8)}-${versioned.slice(8, 12)}-${versioned.slice(12, 16)}-${versioned.slice(16, 20)}-${versioned.slice(20)}`;
}

async function loadLateCostSourceForUpdate(
  transaction: CostingTransaction,
  input: {
    tenantId: string;
    stationId: string;
    tankId: string;
    productId: string;
    sourceType: string;
    sourceId: string;
  },
) {
  if (!['OPENING_BALANCE', 'FUEL_DELIVERY_ALLOCATION'].includes(input.sourceType)) {
    throw new AppError(
      'VALIDATION_FAILED',
      'Late cost source must be an opening balance or confirmed delivery allocation',
    );
  }
  const movements = await transaction
    .select()
    .from(inventoryMovements)
    .where(
      and(
        eq(inventoryMovements.tenantId, input.tenantId),
        eq(inventoryMovements.stationId, input.stationId),
        eq(inventoryMovements.tankId, input.tankId),
        eq(inventoryMovements.productId, input.productId),
        eq(inventoryMovements.sourceType, input.sourceType),
        eq(inventoryMovements.sourceId, input.sourceId),
      ),
    )
    .orderBy(asc(inventoryMovements.id))
    .for('update');
  const movement = movements[0];
  if (!movement) throw new AppError('NOT_FOUND', 'The authoritative cost source was not found');
  if (
    (input.sourceType === 'OPENING_BALANCE' && movement.movementType !== 'OPENING_BALANCE') ||
    (input.sourceType === 'FUEL_DELIVERY_ALLOCATION' &&
      (movement.movementType !== 'DELIVERY' || movement.sourceId !== input.sourceId)) ||
    !new ExactDecimal(movement.quantityLitres).value.isPositive()
  ) {
    throw new AppError(
      'INVARIANT_VIOLATION',
      'The late cost source must reference a positive canonical A4 movement',
    );
  }

  if (input.sourceType === 'FUEL_DELIVERY_ALLOCATION') {
    const allocations = await transaction
      .select()
      .from(fuelDeliveryAllocations)
      .where(
        and(
          eq(fuelDeliveryAllocations.tenantId, input.tenantId),
          eq(fuelDeliveryAllocations.stationId, input.stationId),
          eq(fuelDeliveryAllocations.tankId, input.tankId),
          eq(fuelDeliveryAllocations.productId, input.productId),
          eq(fuelDeliveryAllocations.id, input.sourceId),
        ),
      )
      .for('update');
    const allocation = allocations[0];
    if (!allocation || allocation.deliveryId === null) {
      throw new AppError('NOT_FOUND', 'The delivery allocation was not found');
    }
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
      .for('update');
    if (deliveries[0]?.status !== 'CONFIRMED') {
      throw new AppError('CONFLICT', 'Only a confirmed delivery allocation can be revalued');
    }
  }
  return movement;
}

async function assertLateCostSourceIsRequired(
  transaction: CostingTransaction,
  input: {
    tenantId: string;
    stationId: string;
    tankId: string;
    productId: string;
    sourceType: string;
    sourceId: string;
    effectiveAt: Date;
  },
): Promise<void> {
  const existingCost = await transaction
    .select({ id: inventoryCostEvents.id })
    .from(inventoryCostEvents)
    .where(
      and(
        eq(inventoryCostEvents.tenantId, input.tenantId),
        eq(inventoryCostEvents.sourceType, input.sourceType),
        eq(inventoryCostEvents.sourceId, input.sourceId),
        sql`${inventoryCostEvents.eventType} in ('OPENING_COST', 'RECEIPT_COST')`,
      ),
    )
    .limit(1);
  if (existingCost.length > 0) {
    throw new AppError('CONFLICT', 'The authoritative cost source already has ordinary cost');
  }
  const historicalSales = await transaction.execute<{ id: string }>(sql`
    select movement.id
    from app.inventory_movements movement
    join app.inventory_sale_cost_attributions attribution
      on attribution.tenant_id = movement.tenant_id
     and attribution.station_id = movement.station_id
     and attribution.inventory_movement_id = movement.id
    where movement.tenant_id = ${input.tenantId}
      and movement.station_id = ${input.stationId}
      and movement.tank_id = ${input.tankId}
      and movement.product_id = ${input.productId}
      and movement.movement_type = 'SALE'
      and movement.source_type = 'METER_SEGMENT_SALE'
      and movement.effective_at >= ${input.effectiveAt.toISOString()}
    order by movement.effective_at, movement.id
    limit 1
  `);
  if (historicalSales.length === 0) {
    throw new AppError(
      'CONFLICT',
      'The authoritative cost source does not require historical revaluation',
    );
  }
}

async function insertOrVerifyCogsRevaluationEvent(
  transaction: CostingTransaction,
  input: {
    key: InventoryStreamKey;
    id: string;
    sourceId: string;
    effectiveAt: Date;
    businessDate: string;
    amount: string;
    currency: CurrencyCode;
    actorMembershipId: string;
  },
): Promise<string> {
  const existing = await transaction
    .select()
    .from(inventoryCostEvents)
    .where(
      and(
        eq(inventoryCostEvents.tenantId, input.key.tenantId),
        eq(inventoryCostEvents.eventType, 'COGS_REVALUATION'),
        eq(inventoryCostEvents.sourceType, 'INVENTORY_COST_REVALUATION_LINE'),
        eq(inventoryCostEvents.sourceId, input.sourceId),
      ),
    )
    .for('update');
  const row = existing[0];
  if (row) {
    if (
      row.id !== input.id ||
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
        'The COGS revaluation event does not match replay',
      );
    }
    return row.id;
  }
  await transaction.insert(inventoryCostEvents).values({
    id: input.id,
    tenantId: input.key.tenantId,
    stationId: input.key.stationId,
    tankId: input.key.tankId,
    productId: input.key.productId,
    eventType: 'COGS_REVALUATION',
    sourceType: 'INVENTORY_COST_REVALUATION_LINE',
    sourceId: input.sourceId,
    effectiveAt: input.effectiveAt,
    businessDate: input.businessDate,
    amount: input.amount,
    currency: input.currency,
    actorMembershipId: input.actorMembershipId,
  });
  return input.id;
}

async function loadOriginalSaleAttributions(
  transaction: CostingTransaction,
  key: InventoryStreamKey,
): Promise<OriginalSaleCostAttribution[]> {
  const rows = await transaction
    .select()
    .from(inventorySaleCostAttributions)
    .where(
      and(
        eq(inventorySaleCostAttributions.tenantId, key.tenantId),
        eq(inventorySaleCostAttributions.stationId, key.stationId),
        eq(inventorySaleCostAttributions.tankId, key.tankId),
        eq(inventorySaleCostAttributions.productId, key.productId),
      ),
    )
    .orderBy(asc(inventorySaleCostAttributions.effectiveAt), asc(inventorySaleCostAttributions.id));
  return rows.map((row) => {
    if (!row.preSaleWac || !row.originalCogs || !row.saleCostEventId) {
      throw new AppError('INVARIANT_VIOLATION', 'A stored sale attribution is incomplete');
    }
    return {
      id: row.id,
      movementId: row.inventoryMovementId,
      meterSegmentId: row.meterSegmentId,
      saleQuantityLitres: row.saleQuantityLitres,
      preSaleWac: row.preSaleWac,
      originalCogs: row.originalCogs,
      saleCostEventId: row.saleCostEventId,
      valuationStatus: row.valuationStatus as 'VALUED',
      valuationBasis: row.valuationBasis as 'PRE_SALE_WAC',
      replayFingerprint: row.replayFingerprint,
      effectiveAt: row.effectiveAt,
      businessDate: row.businessDate,
    };
  });
}

async function loadPostedRevaluationEvidence(
  transaction: CostingTransaction,
  key: InventoryStreamKey,
): Promise<PriorCogsRevaluationEvidence[]> {
  const rows = await transaction.execute<{
    revaluation_line_id: string;
    sale_movement_id: string;
    sale_cost_event_id: string;
    cogs_delta: string;
    prior_restated_cogs: string;
    recomputed_cogs: string;
    replay_fingerprint: string;
    posted_at: Date;
  }>(sql`
    select line.id as revaluation_line_id,
           line.sale_movement_id,
           attribution.sale_cost_event_id,
           line.cogs_delta,
           line.prior_restated_cogs,
           line.recomputed_cogs,
           line.replay_fingerprint,
           revaluation.posted_at
    from app.inventory_cost_revaluation_lines line
    join app.inventory_cost_revaluations revaluation
      on revaluation.tenant_id = line.tenant_id
     and revaluation.id = line.revaluation_id
    join app.inventory_sale_cost_attributions attribution
      on attribution.tenant_id = line.tenant_id
     and attribution.id = line.sale_attribution_id
    where line.tenant_id = ${key.tenantId}
      and line.station_id = ${key.stationId}
      and line.tank_id = ${key.tankId}
      and line.product_id = ${key.productId}
      and revaluation.status = 'POSTED'
    order by revaluation.posted_at, line.id
  `);
  return rows.map((row) => ({
    revaluationLineId: row.revaluation_line_id,
    saleMovementId: row.sale_movement_id,
    saleCostEventId: row.sale_cost_event_id,
    amount: row.cogs_delta,
    priorRestatedCogs: row.prior_restated_cogs,
    recomputedCogs: row.recomputed_cogs,
    replayFingerprint: row.replay_fingerprint,
    postedAt: row.posted_at,
  }));
}

export async function requestInventoryCostRevaluationInTransaction(
  transaction: CostingTransaction,
  input: {
    tenantId: string;
    stationId: string;
    tankId: string;
    productId: string;
    sourceType: string;
    sourceId: string;
    amount: string;
    currency: string;
    reason: string;
    restatementFromAt?: Date;
    restatementThroughAt?: Date;
    requestedBy: string;
  },
): Promise<{
  revaluationId: string;
  status: 'REQUESTED';
  effectiveAt: Date;
  businessDate: string;
}> {
  const amount = positiveMoney(input.amount);
  const normalizedCurrency = currency(input.currency);
  const movement = await loadLateCostSourceForUpdate(transaction, input);
  await assertLateCostSourceIsRequired(transaction, {
    ...input,
    effectiveAt: movement.effectiveAt,
  });
  const existing = await transaction
    .select({ id: inventoryCostRevaluations.id, status: inventoryCostRevaluations.status })
    .from(inventoryCostRevaluations)
    .where(
      and(
        eq(inventoryCostRevaluations.tenantId, input.tenantId),
        eq(inventoryCostRevaluations.sourceType, input.sourceType),
        eq(inventoryCostRevaluations.sourceId, input.sourceId),
      ),
    )
    .for('update');
  if (existing.length > 0) {
    throw new AppError('CONFLICT', 'The authoritative source already has a revaluation workflow');
  }
  const revaluationId = randomUUID();
  await transaction.insert(inventoryCostRevaluations).values({
    id: revaluationId,
    tenantId: input.tenantId,
    stationId: input.stationId,
    tankId: input.tankId,
    productId: input.productId,
    reason: input.reason,
    status: 'REQUESTED',
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    amount,
    currency: normalizedCurrency,
    effectiveAt: movement.effectiveAt,
    businessDate: movement.businessDate,
    restatementFromAt: input.restatementFromAt ?? null,
    restatementThroughAt: input.restatementThroughAt ?? null,
    requestedBy: input.requestedBy,
  });
  return {
    revaluationId,
    status: 'REQUESTED',
    effectiveAt: movement.effectiveAt,
    businessDate: movement.businessDate,
  };
}

export async function approveInventoryCostRevaluationInTransaction(
  transaction: CostingTransaction,
  input: { tenantId: string; stationId: string; revaluationId: string; approvedBy: string },
): Promise<{ revaluationId: string; status: 'APPROVED'; approvedAt: Date }> {
  const rows = await transaction
    .select()
    .from(inventoryCostRevaluations)
    .where(
      and(
        eq(inventoryCostRevaluations.tenantId, input.tenantId),
        eq(inventoryCostRevaluations.stationId, input.stationId),
        eq(inventoryCostRevaluations.id, input.revaluationId),
      ),
    )
    .for('update');
  const revaluation = rows[0];
  if (!revaluation) throw new AppError('NOT_FOUND', 'The inventory cost revaluation was not found');
  if (revaluation.status !== 'REQUESTED') {
    throw new AppError('CONFLICT', 'Only a requested inventory cost revaluation can be approved');
  }
  const approvedAt = new Date();
  await transaction
    .update(inventoryCostRevaluations)
    .set({ status: 'APPROVED', approvedBy: input.approvedBy, approvedAt, updatedAt: approvedAt })
    .where(
      and(
        eq(inventoryCostRevaluations.tenantId, input.tenantId),
        eq(inventoryCostRevaluations.id, input.revaluationId),
        eq(inventoryCostRevaluations.status, 'REQUESTED'),
      ),
    );
  return { revaluationId: input.revaluationId, status: 'APPROVED', approvedAt };
}

export async function postInventoryCostRevaluationInTransaction(
  transaction: CostingTransaction,
  input: { tenantId: string; stationId: string; revaluationId: string; postedBy: string },
): Promise<{
  revaluationId: string;
  status: 'POSTED';
  ordinaryCostEventId: string;
  cogsRevaluationEventIds: readonly string[];
  revaluationLineIds: readonly string[];
  replayFingerprint: string;
  conservation: CostRevaluationCalculation['conservation'];
  projection: CostStreamProjection;
}> {
  const envelopeRows = await transaction
    .select()
    .from(inventoryCostRevaluations)
    .where(
      and(
        eq(inventoryCostRevaluations.tenantId, input.tenantId),
        eq(inventoryCostRevaluations.stationId, input.stationId),
        eq(inventoryCostRevaluations.id, input.revaluationId),
      ),
    )
    .for('update');
  const envelope = envelopeRows[0];
  if (!envelope) throw new AppError('NOT_FOUND', 'The inventory cost revaluation was not found');
  if (envelope.status !== 'APPROVED') {
    throw new AppError('CONFLICT', 'Only an approved inventory cost revaluation can be posted');
  }
  if (!envelope.sourceType || !envelope.sourceId || !envelope.amount || !envelope.currency) {
    throw new AppError('INVARIANT_VIOLATION', 'The approved revaluation envelope is incomplete');
  }
  const movement = await loadLateCostSourceForUpdate(transaction, {
    tenantId: envelope.tenantId,
    stationId: envelope.stationId,
    tankId: envelope.tankId,
    productId: envelope.productId,
    sourceType: envelope.sourceType,
    sourceId: envelope.sourceId,
  });
  await lockTankForStream(transaction, {
    tenantId: envelope.tenantId,
    stationId: envelope.stationId,
    tankId: envelope.tankId,
    productId: envelope.productId,
  });
  const sourceWorkflows = await transaction
    .select({ id: inventoryCostRevaluations.id, status: inventoryCostRevaluations.status })
    .from(inventoryCostRevaluations)
    .where(
      and(
        eq(inventoryCostRevaluations.tenantId, envelope.tenantId),
        eq(inventoryCostRevaluations.sourceType, envelope.sourceType),
        eq(inventoryCostRevaluations.sourceId, envelope.sourceId),
      ),
    )
    .for('update');
  if (sourceWorkflows.some((row) => row.id !== envelope.id)) {
    throw new AppError('CONFLICT', 'The authoritative source belongs to another revaluation');
  }

  const key = streamKey(movement);
  const stream = await loadStreamInput(transaction, key);
  const existingLateEvents = stream.costEvents.filter(
    (event) =>
      event.eventType ===
        (envelope.sourceType === 'OPENING_BALANCE' ? 'OPENING_COST' : 'RECEIPT_COST') &&
      event.sourceType === envelope.sourceType &&
      event.sourceId === envelope.sourceId,
  );
  if (existingLateEvents.length > 1) {
    throw new AppError(
      'INVARIANT_VIOLATION',
      'The authoritative source has duplicate ordinary costs',
    );
  }
  const lateEventRow = existingLateEvents[0];
  const ordinaryCost = lateEventRow
    ? { id: lateEventRow.id, inserted: false }
    : await insertOrVerifyCostEvent(transaction, {
        key,
        eventType: envelope.sourceType === 'OPENING_BALANCE' ? 'OPENING_COST' : 'RECEIPT_COST',
        sourceType: movement.sourceType,
        sourceId: movement.sourceId,
        effectiveAt: movement.effectiveAt,
        businessDate: movement.businessDate,
        amount: positiveMoney(envelope.amount),
        currency: currency(envelope.currency),
        actorMembershipId: input.postedBy,
      });
  const lateCostEvent: CostingEvent = lateEventRow ?? {
    ...key,
    id: ordinaryCost.id,
    eventType: envelope.sourceType === 'OPENING_BALANCE' ? 'OPENING_COST' : 'RECEIPT_COST',
    sourceType: movement.sourceType,
    sourceId: movement.sourceId,
    effectiveAt: movement.effectiveAt,
    businessDate: movement.businessDate,
    amount: positiveMoney(envelope.amount),
    currency: currency(envelope.currency),
  };
  if (
    lateCostEvent.sourceType !== movement.sourceType ||
    lateCostEvent.sourceId !== movement.sourceId ||
    !sameInstant(lateCostEvent.effectiveAt, movement.effectiveAt) ||
    lateCostEvent.businessDate !== movement.businessDate ||
    !new ExactDecimal(lateCostEvent.amount).equals(new ExactDecimal(envelope.amount)) ||
    !sameCurrency(lateCostEvent.currency, envelope.currency)
  ) {
    throw new AppError(
      'IDEMPOTENCY_CONFLICT',
      'The ordinary historical cost does not match the envelope',
    );
  }

  const originalMovements = stream.movements.filter((item) => item.id !== movement.id);
  const originalCostEvents = stream.costEvents.filter((event) => event.id !== lateCostEvent.id);
  const originalAttributions = await loadOriginalSaleAttributions(transaction, key);
  const priorRevaluationDeltas = await loadPostedRevaluationEvidence(transaction, key);
  const calculation = calculateLateCostRevaluation({
    key,
    originalMovements,
    originalCostEvents,
    lateCostMovement: {
      ...key,
      id: movement.id,
      movementType: movement.movementType,
      quantityLitres: movement.quantityLitres,
      effectiveAt: movement.effectiveAt,
      businessDate: movement.businessDate,
      sourceType: movement.sourceType,
      sourceId: movement.sourceId,
    },
    lateCostEvent,
    originalAttributions,
    priorRevaluationDeltas,
  });
  const movementById = new Map(stream.movements.map((item) => [item.id, item]));
  const cogsRevaluationEventIds: string[] = [];
  const revaluationLineIds: string[] = [];
  for (const line of calculation.affectedSales) {
    const saleMovement = movementById.get(line.saleMovementId);
    if (!saleMovement)
      throw new AppError('INVARIANT_VIOLATION', 'The affected sale movement disappeared');
    if (!saleMovement.businessDate)
      throw new AppError('INVARIANT_VIOLATION', 'The affected sale movement has no business date');
    const lineId = deterministicUuid(
      `a12.4:revaluation-line:${envelope.id}:${line.saleMovementId}`,
    );
    const eventId = deterministicUuid(`a12.4:revaluation-event:${lineId}`);
    await insertOrVerifyCogsRevaluationEvent(transaction, {
      key,
      id: eventId,
      sourceId: lineId,
      effectiveAt: new Date(line.saleEffectiveAt),
      businessDate: saleMovement.businessDate,
      amount: line.cogsDelta,
      currency: line.currency,
      actorMembershipId: input.postedBy,
    });
    const existingLines = await transaction
      .select()
      .from(inventoryCostRevaluationLines)
      .where(
        and(
          eq(inventoryCostRevaluationLines.tenantId, key.tenantId),
          eq(inventoryCostRevaluationLines.id, lineId),
        ),
      )
      .for('update');
    const existingLine = existingLines[0];
    if (existingLine) {
      if (
        existingLine.revaluationId !== envelope.id ||
        existingLine.saleMovementId !== line.saleMovementId ||
        existingLine.saleAttributionId !== line.saleAttributionId ||
        !sameDecimal(existingLine.originalPreSaleWac, line.originalPreSaleWac) ||
        !sameDecimal(existingLine.recomputedPreSaleWac, line.recomputedPreSaleWac) ||
        !sameDecimal(existingLine.originalCogs, line.originalCogs) ||
        !sameDecimal(existingLine.priorRestatedCogs, line.priorRestatedCogs) ||
        !sameDecimal(existingLine.recomputedCogs, line.recomputedCogs) ||
        !sameDecimal(existingLine.cogsDelta, line.cogsDelta) ||
        !sameCurrency(existingLine.currency, line.currency) ||
        !sameInstant(existingLine.saleEffectiveAt, line.saleEffectiveAt) ||
        existingLine.cogsRevaluationEventId !== eventId ||
        existingLine.replayFingerprint !== line.replayFingerprint
      ) {
        throw new AppError('IDEMPOTENCY_CONFLICT', 'The revaluation line does not match replay');
      }
    } else {
      await transaction.insert(inventoryCostRevaluationLines).values({
        id: lineId,
        tenantId: key.tenantId,
        stationId: key.stationId,
        tankId: key.tankId,
        productId: key.productId,
        revaluationId: envelope.id,
        saleMovementId: line.saleMovementId,
        saleAttributionId: line.saleAttributionId,
        originalPreSaleWac: line.originalPreSaleWac,
        recomputedPreSaleWac: line.recomputedPreSaleWac,
        originalCogs: line.originalCogs,
        priorRestatedCogs: line.priorRestatedCogs,
        recomputedCogs: line.recomputedCogs,
        cogsDelta: line.cogsDelta,
        currency: line.currency,
        saleEffectiveAt: new Date(line.saleEffectiveAt),
        cogsRevaluationEventId: eventId,
        replayFingerprint: line.replayFingerprint,
      });
    }
    cogsRevaluationEventIds.push(eventId);
    revaluationLineIds.push(lineId);
  }
  const projection = await projectAndPersist(transaction, key);
  const postedAt = new Date();
  await transaction
    .update(inventoryCostRevaluations)
    .set({
      status: 'POSTED',
      postedBy: input.postedBy,
      postedAt,
      replayFingerprint: calculation.replayFingerprint,
      updatedAt: postedAt,
    })
    .where(
      and(
        eq(inventoryCostRevaluations.tenantId, envelope.tenantId),
        eq(inventoryCostRevaluations.id, envelope.id),
        eq(inventoryCostRevaluations.status, 'APPROVED'),
      ),
    );
  return {
    revaluationId: envelope.id,
    status: 'POSTED',
    ordinaryCostEventId: ordinaryCost.id,
    cogsRevaluationEventIds,
    revaluationLineIds,
    replayFingerprint: calculation.replayFingerprint,
    conservation: calculation.conservation,
    projection,
  };
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
  const hasRevaluations = fullInput.costEvents.some(
    (event) => event.eventType === 'COGS_REVALUATION',
  );
  const preSale = hasRevaluations
    ? projectInventoryCostBeforeSaleWithRevaluations({
        key,
        movements: fullInput.movements,
        costEvents: fullInput.costEvents,
        saleMovementId: saleMovement.id,
      })
    : projectInventoryCostBeforeSale({
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
    projection = hasRevaluations
      ? projectInventoryCostThroughSaleWithRevaluations({
          key,
          movements: afterEventInput.movements,
          costEvents: afterEventInput.costEvents,
          saleMovementId: sale.id,
        })
      : projectInventoryCostThroughSale({
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
