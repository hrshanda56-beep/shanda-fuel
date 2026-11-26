import { and, asc, desc, eq, inArray, isNull, lte } from 'drizzle-orm';
import { AppError } from '../../platform/errors';
import {
  assertMovementFitsTank,
  deriveExpectedTankStock,
  calculateTankStockVariance,
  type TimedStockMovement,
  validateMovementQuantity,
  type InventoryMovementType,
} from './domain';
import { ExactDecimal, litres } from '../../platform/domain/primitives';
import type { InventoryCommandContext, InventoryTransaction } from './application';
import { withTenantTransaction } from '../../platform/db/transaction';
import { products } from '../../platform/db/schema/a3';
import { inventoryMovements, tanks, tankDips } from '../../platform/db/schema/a4';

export type TankRecord = Readonly<{
  id: string;
  tenantId: string;
  stationId: string;
  code: string;
  productId: string;
  capacityLitres: string;
  reorderLevelLitres: string | null;
  acceptableVarianceLitres: string | null;
  varianceRedLitres: string | null;
  status: string;
  /** The tank this tank's cost pool is kept on: its own id when it is on its own (DEC-058). */
  costPoolTankId: string;
  version: number;
}>;

export type StockPosition = Readonly<{
  tankId: string;
  stationId: string;
  productId: string;
  expectedLitres: string;
  physicalLitres: string | null;
  varianceLitres: string | null;
}>;

export async function assertProductBelongsToTenant(
  transaction: InventoryTransaction,
  tenantId: string,
  productId: string,
): Promise<void> {
  const rows = await transaction
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.tenantId, tenantId), eq(products.id, productId)))
    .limit(1);
  if (rows.length !== 1) throw new AppError('NOT_FOUND', 'The fuel product was not found');
}

export async function loadTankForUpdate(
  transaction: InventoryTransaction,
  input: { tenantId: string; stationId: string; tankId: string },
): Promise<TankRecord> {
  return loadTank(transaction, input, true);
}

/** Reads must not take row locks: polling would otherwise block deliveries, dips and sales. */
async function loadTankForRead(
  transaction: InventoryTransaction,
  input: { tenantId: string; stationId: string; tankId: string },
): Promise<TankRecord> {
  return loadTank(transaction, input, false);
}

async function loadTank(
  transaction: InventoryTransaction,
  input: { tenantId: string; stationId: string; tankId: string },
  lock: boolean,
): Promise<TankRecord> {
  const query = transaction
    .select({
      id: tanks.id,
      tenantId: tanks.tenantId,
      stationId: tanks.stationId,
      code: tanks.code,
      productId: tanks.productId,
      capacityLitres: tanks.capacityLitres,
      reorderLevelLitres: tanks.reorderLevelLitres,
      acceptableVarianceLitres: tanks.acceptableVarianceLitres,
      varianceRedLitres: tanks.varianceRedLitres,
      status: tanks.status,
      costPoolTankId: tanks.costPoolTankId,
      version: tanks.version,
    })
    .from(tanks)
    .where(
      and(
        eq(tanks.tenantId, input.tenantId),
        eq(tanks.stationId, input.stationId),
        eq(tanks.id, input.tankId),
      ),
    );
  const rows = await (lock ? query.for('update') : query);
  const tank = rows[0];
  if (!tank) throw new AppError('NOT_FOUND', 'The requested tank was not found');
  return { ...tank, costPoolTankId: tank.costPoolTankId ?? tank.id };
}

/**
 * The tanks that share one stock and cost pool with this tank (DEC-058), the tank itself included,
 * and the room they have together. A tank on its own is a pool of one, so its room is its capacity.
 */
async function loadPool(
  transaction: InventoryTransaction,
  input: { tenantId: string; stationId: string; tankId: string },
): Promise<{
  poolTankId: string;
  tankIds: readonly string[];
  /** Tanks that can hold fuel: not retired. */
  openTankIds: readonly string[];
  capacityLitres: string;
}> {
  const own = await transaction
    .select({ id: tanks.id, costPoolTankId: tanks.costPoolTankId })
    .from(tanks)
    .where(
      and(
        eq(tanks.tenantId, input.tenantId),
        eq(tanks.stationId, input.stationId),
        eq(tanks.id, input.tankId),
      ),
    );
  if (!own[0]) throw new AppError('NOT_FOUND', 'The requested tank was not found');
  const poolTankId = own[0].costPoolTankId ?? own[0].id;
  const members = await transaction
    .select({ id: tanks.id, capacityLitres: tanks.capacityLitres, status: tanks.status })
    .from(tanks)
    .where(
      and(
        eq(tanks.tenantId, input.tenantId),
        eq(tanks.stationId, input.stationId),
        eq(tanks.costPoolTankId, poolTankId),
      ),
    )
    .orderBy(asc(tanks.createdAt), asc(tanks.id));
  const open = members.filter((tank) => tank.status !== 'RETIRED' || tank.id === input.tankId);
  const capacity =
    open.length === 1
      ? open[0]!.capacityLitres
      : open
          .reduce((total, tank) => total.add(litres(tank.capacityLitres)), new ExactDecimal('0'))
          .toString();
  return {
    poolTankId,
    tankIds: members.length > 0 ? members.map((tank) => tank.id) : [input.tankId],
    openTankIds: open.map((tank) => tank.id),
    capacityLitres: capacity,
  };
}

async function movementRows(
  transaction: InventoryTransaction,
  input: { tenantId: string; stationId: string; tankIds: readonly string[]; asOf?: Date },
): Promise<readonly TimedStockMovement[]> {
  const rows = await transaction
    .select({
      movementType: inventoryMovements.movementType,
      quantityLitres: inventoryMovements.quantityLitres,
      effectiveAt: inventoryMovements.effectiveAt,
    })
    .from(inventoryMovements)
    .where(
      and(
        eq(inventoryMovements.tenantId, input.tenantId),
        eq(inventoryMovements.stationId, input.stationId),
        inArray(inventoryMovements.tankId, [...input.tankIds]),
        input.asOf ? lte(inventoryMovements.effectiveAt, input.asOf) : undefined,
      ),
    )
    .orderBy(asc(inventoryMovements.effectiveAt), asc(inventoryMovements.id));
  return rows.map((row) => ({
    movementType: row.movementType as InventoryMovementType,
    quantityLitres: row.quantityLitres,
    effectiveAt: row.effectiveAt,
  }));
}

export async function getExpectedTankStockInTransaction(
  transaction: InventoryTransaction,
  input: { tenantId: string; stationId: string; tankId: string; asOf?: Date },
): Promise<string> {
  const pool = await loadPool(transaction, input);
  return deriveExpectedTankStock(
    undefined,
    await movementRows(transaction, { ...input, tankIds: pool.tankIds }),
  );
}

async function latestDip(
  transaction: InventoryTransaction,
  input: { tenantId: string; stationId: string; tankId: string; asOf?: Date },
): Promise<{ physicalLitres: string; measuredAt: Date } | null> {
  const rows = await transaction
    .select({ physicalLitres: tankDips.physicalLitres, measuredAt: tankDips.measuredAt })
    .from(tankDips)
    .where(
      and(
        eq(tankDips.tenantId, input.tenantId),
        eq(tankDips.stationId, input.stationId),
        eq(tankDips.tankId, input.tankId),
        // A voided dip was recorded in error and must never count as a measurement.
        isNull(tankDips.voidedAt),
        input.asOf ? lte(tankDips.measuredAt, input.asOf) : undefined,
      ),
    )
    .orderBy(desc(tankDips.measuredAt), desc(tankDips.id))
    .limit(1);
  const row = rows[0];
  return row
    ? { physicalLitres: litres(row.physicalLitres).toString(), measuredAt: row.measuredAt }
    : null;
}

export async function getPhysicalTankStockInTransaction(
  transaction: InventoryTransaction,
  input: { tenantId: string; stationId: string; tankId: string; asOf?: Date },
): Promise<string | null> {
  return (await latestDip(transaction, input))?.physicalLitres ?? null;
}

export async function getTankStockPositionInTransaction(
  transaction: InventoryTransaction,
  input: { tenantId: string; stationId: string; tankId: string; asOf?: Date },
): Promise<StockPosition> {
  const tank = await loadTankForRead(transaction, input);
  const pool = await loadPool(transaction, input);
  // A pool of several tanks is one stock: the dips of all its tanks together are compared with the
  // books. If any open tank has no dip yet there is no honest total, so none is given.
  const dips = await Promise.all(
    pool.openTankIds.map((tankId) => latestDip(transaction, { ...input, tankId })),
  );
  const measured = dips.filter((dip): dip is NonNullable<typeof dip> => dip !== null);
  const complete = measured.length === dips.length && measured.length > 0;
  const physicalLitres = complete
    ? measured
        .reduce((total, dip) => total.add(litres(dip.physicalLitres)), new ExactDecimal('0'))
        .toString()
    : null;
  const dipAt = complete
    ? measured.reduce(
        (latest, dip) => (dip.measuredAt > latest ? dip.measuredAt : latest),
        measured[0]!.measuredAt,
      )
    : undefined;
  // The books are compared at the moment of the dip, not today: stock sold or delivered since the
  // dip would otherwise show up as a false shortage or surplus.
  const expectedLitres = await getExpectedTankStockInTransaction(transaction, {
    ...input,
    asOf: dipAt ?? input.asOf,
  });
  return {
    tankId: tank.id,
    stationId: tank.stationId,
    productId: tank.productId,
    expectedLitres,
    physicalLitres,
    varianceLitres:
      physicalLitres === null ? null : calculateTankStockVariance(physicalLitres, expectedLitres),
  };
}

export async function getExpectedTankStock(
  context: InventoryCommandContext,
  tankId: string,
  asOf?: Date,
): Promise<string> {
  return withTenantTransaction(context.authority.transaction, (transaction) =>
    getExpectedTankStockInTransaction(transaction, {
      tenantId: context.tenantId,
      stationId: context.stationId,
      tankId,
      asOf,
    }),
  );
}

export async function getPhysicalTankStock(
  context: InventoryCommandContext,
  tankId: string,
  asOf?: Date,
): Promise<string | null> {
  return withTenantTransaction(context.authority.transaction, (transaction) =>
    getPhysicalTankStockInTransaction(transaction, {
      tenantId: context.tenantId,
      stationId: context.stationId,
      tankId,
      asOf,
    }),
  );
}

export async function getTankVariance(
  context: InventoryCommandContext,
  tankId: string,
  asOf?: Date,
): Promise<StockPosition> {
  return withTenantTransaction(context.authority.transaction, (transaction) =>
    getTankStockPositionInTransaction(transaction, {
      tenantId: context.tenantId,
      stationId: context.stationId,
      tankId,
      asOf,
    }),
  );
}

export async function getStationProductStock(
  context: InventoryCommandContext,
  productId: string,
  asOf?: Date,
): Promise<readonly StockPosition[]> {
  return withTenantTransaction(context.authority.transaction, async (transaction) => {
    const stationTanks = await transaction
      .select({ id: tanks.id, costPoolTankId: tanks.costPoolTankId })
      .from(tanks)
      .where(
        and(
          eq(tanks.tenantId, context.tenantId),
          eq(tanks.stationId, context.stationId),
          eq(tanks.productId, productId),
        ),
      )
      .orderBy(asc(tanks.code));
    // Tanks that share a pool are one stock, so each pool is listed once.
    const onePerPool = stationTanks.filter(
      (tank, index, all) =>
        all.findIndex(
          (other) => (other.costPoolTankId ?? other.id) === (tank.costPoolTankId ?? tank.id),
        ) === index,
    );
    return Promise.all(
      onePerPool.map((tank) =>
        getTankStockPositionInTransaction(transaction, {
          tenantId: context.tenantId,
          stationId: context.stationId,
          tankId: tank.id,
          asOf,
        }),
      ),
    );
  });
}

export async function postInventoryMovementInTransaction(
  transaction: InventoryTransaction,
  input: {
    tenantId: string;
    stationId: string;
    tankId: string;
    productId: string;
    movementType: InventoryMovementType;
    quantityLitres: string;
    effectiveAt: Date;
    businessDate: string;
    sourceType: string;
    sourceId: string;
    actorMembershipId: string;
    reason?: string;
    unitLandedCost?: string;
    totalLandedCost?: string;
    currency?: string;
  },
): Promise<string> {
  const tank = await loadTankForUpdate(transaction, input);
  if (tank.productId !== input.productId) {
    throw new AppError(
      'INVARIANT_VIOLATION',
      'The movement product does not match the tank product',
    );
  }
  if (tank.status === 'RETIRED') {
    throw new AppError('CONFLICT', 'Retired tanks cannot receive new inventory movements');
  }
  const quantityLitres = validateMovementQuantity(input.movementType, input.quantityLitres);
  const pool = await loadPool(transaction, input);
  assertMovementFitsTank(
    await movementRows(transaction, { ...input, tankIds: pool.tankIds }),
    {
      movementType: input.movementType,
      quantityLitres,
      effectiveAt: input.effectiveAt,
    },
    pool.capacityLitres,
  );
  const rows = await transaction
    .insert(inventoryMovements)
    .values({
      tenantId: input.tenantId,
      stationId: input.stationId,
      tankId: input.tankId,
      productId: input.productId,
      movementType: input.movementType,
      quantityLitres,
      effectiveAt: input.effectiveAt,
      businessDate: input.businessDate,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      actorMembershipId: input.actorMembershipId,
      reason: input.reason,
      unitLandedCost: input.unitLandedCost,
      totalLandedCost: input.totalLandedCost,
      currency: input.currency,
    })
    .returning({ id: inventoryMovements.id });
  if (!rows[0]?.id) throw new AppError('INTERNAL_ERROR', 'Inventory movement was not persisted');
  return rows[0].id;
}
