import { and, asc, desc, eq, lte, sql } from 'drizzle-orm';
import { AppError } from '../../platform/errors';
import {
  deriveExpectedTankStock,
  calculateTankStockVariance,
  validateMovementQuantity,
  type InventoryMovementType,
} from './domain';
import { litres } from '../../platform/domain/primitives';
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
  status: string;
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
  const rows = await transaction
    .select({
      id: tanks.id,
      tenantId: tanks.tenantId,
      stationId: tanks.stationId,
      code: tanks.code,
      productId: tanks.productId,
      capacityLitres: tanks.capacityLitres,
      reorderLevelLitres: tanks.reorderLevelLitres,
      acceptableVarianceLitres: tanks.acceptableVarianceLitres,
      status: tanks.status,
      version: tanks.version,
    })
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
  if (!tank) throw new AppError('NOT_FOUND', 'The requested tank was not found');
  return tank;
}

async function movementRows(
  transaction: InventoryTransaction,
  input: { tenantId: string; stationId: string; tankId: string; asOf?: Date },
): Promise<readonly { movementType: InventoryMovementType; quantityLitres: string }[]> {
  const rows = await transaction
    .select({
      movementType: inventoryMovements.movementType,
      quantityLitres: inventoryMovements.quantityLitres,
    })
    .from(inventoryMovements)
    .where(
      and(
        eq(inventoryMovements.tenantId, input.tenantId),
        eq(inventoryMovements.stationId, input.stationId),
        eq(inventoryMovements.tankId, input.tankId),
        input.asOf ? lte(inventoryMovements.effectiveAt, input.asOf) : undefined,
      ),
    )
    .orderBy(asc(inventoryMovements.effectiveAt), asc(inventoryMovements.id));
  return rows.map((row) => ({
    movementType: row.movementType as InventoryMovementType,
    quantityLitres: row.quantityLitres,
  }));
}

/**
 * Command-path replay: preserve effective-time/id ordering so a new movement
 * cannot make any historical stock prefix negative.
 */
export async function getExpectedTankStockInTransaction(
  transaction: InventoryTransaction,
  input: { tenantId: string; stationId: string; tankId: string; asOf?: Date },
): Promise<string> {
  return deriveExpectedTankStock(undefined, await movementRows(transaction, input));
}

async function getExpectedTankStockProjectionInTransaction(
  transaction: InventoryTransaction,
  input: { tenantId: string; stationId: string; tankId: string; asOf?: Date },
): Promise<string> {
  const rows = await transaction
    .select({
      expectedLitres: sql<string>`coalesce(sum(${inventoryMovements.quantityLitres}), 0)::text`,
    })
    .from(inventoryMovements)
    .where(
      and(
        eq(inventoryMovements.tenantId, input.tenantId),
        eq(inventoryMovements.stationId, input.stationId),
        eq(inventoryMovements.tankId, input.tankId),
        input.asOf ? lte(inventoryMovements.effectiveAt, input.asOf) : undefined,
      ),
    );
  return rows[0]?.expectedLitres ?? '0';
}

export async function getPhysicalTankStockInTransaction(
  transaction: InventoryTransaction,
  input: { tenantId: string; stationId: string; tankId: string; asOf?: Date },
): Promise<string | null> {
  const rows = await transaction
    .select({ physicalLitres: tankDips.physicalLitres })
    .from(tankDips)
    .where(
      and(
        eq(tankDips.tenantId, input.tenantId),
        eq(tankDips.stationId, input.stationId),
        eq(tankDips.tankId, input.tankId),
        input.asOf ? lte(tankDips.measuredAt, input.asOf) : undefined,
      ),
    )
    .orderBy(desc(tankDips.measuredAt), desc(tankDips.id))
    .limit(1);
  return rows[0] ? litres(rows[0].physicalLitres).toString() : null;
}

export async function getTankStockPositionInTransaction(
  transaction: InventoryTransaction,
  input: { tenantId: string; stationId: string; tankId: string; asOf?: Date },
): Promise<StockPosition> {
  const tank = await loadTankForUpdate(transaction, input);
  const expectedLitres = await getExpectedTankStockProjectionInTransaction(transaction, input);
  const physicalLitres = await getPhysicalTankStockInTransaction(transaction, input);
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
    getExpectedTankStockProjectionInTransaction(transaction, {
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
    const rows = await transaction.execute<{
      tank_id: string;
      station_id: string;
      product_id: string;
      expected_litres: string;
      physical_litres: string | null;
      variance_litres: string | null;
    }>(sql`
      select
        t.id as tank_id,
        t.station_id,
        t.product_id,
        coalesce(sum(m.quantity_litres), 0)::text as expected_litres,
        dip.physical_litres::text as physical_litres,
        case when dip.physical_litres is null then null
          else (dip.physical_litres - coalesce(sum(m.quantity_litres), 0))::text
        end as variance_litres
      from app.tanks t
      left join app.inventory_movements m
        on m.tenant_id = t.tenant_id
       and m.station_id = t.station_id
       and m.tank_id = t.id
       ${asOf ? sql`and m.effective_at <= ${asOf}` : sql``}
      left join lateral (
        select d.physical_litres
        from app.tank_dips d
        where d.tenant_id = t.tenant_id
          and d.station_id = t.station_id
          and d.tank_id = t.id
          ${asOf ? sql`and d.measured_at <= ${asOf}` : sql``}
        order by d.measured_at desc, d.id desc
        limit 1
      ) dip on true
      where t.tenant_id = ${context.tenantId}
        and t.station_id = ${context.stationId}
        and t.product_id = ${productId}
      group by t.id, t.station_id, t.product_id, dip.physical_litres, t.code
      order by t.code, t.id
    `);
    return rows.map((row) => ({
      tankId: row.tank_id,
      stationId: row.station_id,
      productId: row.product_id,
      expectedLitres: row.expected_litres,
      physicalLitres: row.physical_litres,
      varianceLitres: row.variance_litres,
    }));
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
  const current = await getExpectedTankStockInTransaction(transaction, input);
  deriveExpectedTankStock(current, [{ movementType: input.movementType, quantityLitres }]);
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
import 'server-only';
