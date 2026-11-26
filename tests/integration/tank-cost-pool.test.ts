import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres, { type Sql } from 'postgres';
import { createQa1ScenarioContext, QA1_TIMES } from './qa1/fixture';
import { randomUUID } from 'node:crypto';
import {
  confirmDelivery,
  createApprovedSale,
  createDelivery,
  inventory,
  openBusinessDayAndShift,
  postOpeningPosition,
  forecourt,
  recordReceiptCost,
  sealMeterSegments,
  supplier,
} from './qa1/commands';
import { expectStatus } from './qa1/assertions';
import { GET as inventoryValuationGet } from '../../src/app/api/inventory/valuation/route';
import { GET as reconciliationGet } from '../../src/app/api/forecourt/reconciliations/[id]/route';
import { clerkHeaders } from './auth-session-fixtures';

/**
 * One cost pool per fuel (#314, DEC-058). Two tanks of one fuel are one stock and one cost: a sale
 * is not taken from a named tank, so one tank can be empty while the other holds the fuel.
 */
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for the tank cost pool tests.');

let client: Sql;

describe('tanks of one fuel share one cost pool', () => {
  beforeAll(() => {
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';
    process.env.AUDIT_SIGNING_KEY_ID ??= 'integration-pool-key';
    process.env.AUDIT_SIGNING_KEY ??= 'integration-pool-secret';
    client = postgres(databaseUrl!, { max: 1, prepare: false });
  });

  afterAll(async () => client?.end());

  it('prices a sale from the whole pool and keeps one cost record for both tanks', async () => {
    const ctx = await createQa1ScenarioContext(client, 'pool');
    const tankA = ctx.tankId;

    // Tank A: 1000 L that cost 1000.
    await postOpeningPosition(client, ctx, 'pool', '1000.000', '1000.0000');

    // A second tank of the same fuel is added through the real command: it joins A's pool.
    const created = await inventory(
      ctx,
      {
        commandType: 'CreateTank',
        tenantId: ctx.tenantId,
        stationId: ctx.stationId,
        code: `POOL-B-${ctx.runId.slice(0, 6)}`,
        productId: ctx.productId,
        capacityLitres: '10000',
        reorderLevelLitres: '500',
        acceptableVarianceLitres: '10',
      },
      'pool-create-tank-b',
    );
    expectStatus(created, 200);
    const tankB = created.body.tankId as string;
    const pools = await client.unsafe<{ id: string; pool: string }[]>(
      `select id, cost_pool_tank_id as pool from app.tanks
       where tenant_id='${ctx.tenantId}' and station_id='${ctx.stationId}' order by created_at, id`,
    );
    expect(pools).toEqual([
      { id: tankA, pool: tankA },
      { id: tankB, pool: tankA },
    ]);

    // 500 L that cost 1000 go into tank B. Tank A is still full of the cheaper fuel.
    const sup = await supplier(
      ctx,
      {
        commandType: 'CreateSupplier',
        tenantId: ctx.tenantId,
        legalEntityId: ctx.legalEntityId,
        code: `POOL-SUP-${ctx.runId.slice(0, 8)}`,
        legalName: 'Pool Fuel Supplier',
      },
      'pool-create-supplier',
    );
    expectStatus(sup, 201);
    const supplierId = sup.body.supplierId as string;
    const delivery = await createDelivery({ ...ctx, tankId: tankB }, 'pool-b', {
      quantityLitres: '500.000',
      deliveredAt: '2026-09-26T05:30:00.000Z',
      supplierId,
    });
    await confirmDelivery(ctx, delivery.deliveryId, 'pool-b-confirm');
    await recordReceiptCost(ctx, delivery.allocationId, '1000.0000', 'pool-b-cost');

    // One cost record for the whole fuel, kept on the pool's tank: 1500 L worth 2000.
    const beforeSale = await client.unsafe<
      {
        tank_id: string;
        quantity_litres: string;
        inventory_value: string;
        valuation_status: string;
      }[]
    >(
      `select tank_id, quantity_litres, inventory_value, valuation_status
       from app.inventory_cost_stream_state
       where tenant_id='${ctx.tenantId}' and station_id='${ctx.stationId}' and product_id='${ctx.productId}'`,
    );
    expect(beforeSale).toEqual([
      {
        tank_id: tankA,
        quantity_litres: '1500.000',
        inventory_value: '2000.0000',
        valuation_status: 'VALUED',
      },
    ]);

    // Sell 300 L. The sale is priced from the pool (2000 / 1500 per litre), not from either tank.
    const shift = await openBusinessDayAndShift(ctx, 'pool-sale');
    const sale = await createApprovedSale(client, ctx, 'pool-sale', {
      saleLitres: '300.000',
      payments: [{ method: 'CASH', amount: '750.0000' }],
      existingShiftId: shift.shiftId,
      post: true,
      completeShiftAfter: true,
    });
    const cogs = await client.unsafe<{ tank_id: string; amount: string }[]>(
      `select tank_id, amount::text from app.inventory_cost_events
       where tenant_id='${ctx.tenantId}' and event_type='SALE_COGS'
         and source_id in ('${sale.segmentIds.join("','")}')`,
    );
    expect(cogs).toEqual([{ tank_id: tankA, amount: '-400.0000' }]);
    const attribution = await client.unsafe<{ tank_id: string; original_cogs: string }[]>(
      `select tank_id, original_cogs::text from app.inventory_sale_cost_attributions
       where tenant_id='${ctx.tenantId}' and meter_segment_id in ('${sale.segmentIds.join("','")}')`,
    );
    expect(attribution).toEqual([{ tank_id: tankA, original_cogs: '400.0000' }]);
    const afterSale = await client.unsafe<
      { quantity_litres: string; inventory_value: string; valuation_status: string }[]
    >(
      `select quantity_litres, inventory_value, valuation_status from app.inventory_cost_stream_state
       where tenant_id='${ctx.tenantId}' and station_id='${ctx.stationId}' and product_id='${ctx.productId}'`,
    );
    expect(afterSale).toEqual([
      { quantity_litres: '1200.000', inventory_value: '1600.0000', valuation_status: 'VALUED' },
    ]);

    // The valuation screen shows the fuel once, with both tanks counted in it.
    const valuationResponse = await inventoryValuationGet(
      new Request(
        `http://127.0.0.1:3000/api/inventory/valuation?tenantId=${ctx.tenantId}&stationId=${ctx.stationId}`,
        { headers: { ...clerkHeaders(ctx.actors.admin.token) } },
      ),
    );
    expect(valuationResponse.status).toBe(200);
    const valuation = (await valuationResponse.json()) as {
      streams: unknown[];
      tankReport: { inventory: { rows: Array<Record<string, string>> } };
    };
    expect(valuation.streams).toHaveLength(1);
    expect(valuation.tankReport.inventory.rows).toHaveLength(1);
    const card = valuation.tankReport.inventory.rows[0]!;
    expect(card.expectedLitres).toBe('1200.000');
    expect(card.capacityLitres).toBe('20000.000');
    expect(card.tankCode).toContain(' + ');
  });

  it('refuses a movement only when the whole fuel would go below zero, not one tank', async () => {
    const ctx = await createQa1ScenarioContext(client, 'pool-stock');
    const tankA = ctx.tankId;
    await postOpeningPosition(client, ctx, 'pool-stock', '1000.000', '1000.0000');
    const tankBId = crypto.randomUUID();
    await client.unsafe(`
      insert into app.tanks
        (id, tenant_id, station_id, code, product_id, capacity_litres, status, cost_pool_tank_id,
         created_by, updated_by)
      values ('${tankBId}', '${ctx.tenantId}', '${ctx.stationId}', 'POOL-STOCK-B', '${ctx.productId}',
        10000, 'ACTIVE', '${tankA}', '${ctx.actors.admin.membershipId}', '${ctx.actors.admin.membershipId}')
    `);

    const insertMovement = (tankId: string, litres: string) => `
      insert into app.inventory_movements
        (tenant_id, station_id, tank_id, product_id, movement_type, quantity_litres, effective_at,
         business_date, source_type, source_id, actor_membership_id, reason)
      values ('${ctx.tenantId}', '${ctx.stationId}', '${tankId}', '${ctx.productId}',
        'NEGATIVE_ADJUSTMENT', ${litres}, '${QA1_TIMES.segmentClose}', '${ctx.businessDate}',
        'MANUAL_ADJUSTMENT', gen_random_uuid(), '${ctx.actors.admin.membershipId}', 'test')`;

    // The pool holds 1000 L. Taking 600 L from the empty tank B leaves the pool at 400 L: allowed,
    // although tank B on its own would go below zero.
    await expect(
      client.begin(async (tx) => {
        await tx.unsafe(insertMovement(tankBId, '-600'));
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    // Taking 1100 L would take the whole fuel below zero: refused.
    await expect(
      client.begin(async (tx) => {
        await tx.unsafe(insertMovement(tankBId, '-1100'));
      }),
    ).rejects.toThrow(/negative stock/);
  });

  it("checks the day's stock for both tanks together, using every tank's dip", async () => {
    const ctx = await createQa1ScenarioContext(client, 'pool-dips');
    const tankA = ctx.tankId;
    await postOpeningPosition(client, ctx, 'pool-dips', '1000.000', '1000.0000');
    const created = await inventory(
      ctx,
      {
        commandType: 'CreateTank',
        tenantId: ctx.tenantId,
        stationId: ctx.stationId,
        code: `POOL-DIP-B-${ctx.runId.slice(0, 6)}`,
        productId: ctx.productId,
        capacityLitres: '10000',
        reorderLevelLitres: '500',
        acceptableVarianceLitres: '10',
      },
      'pool-dips-create-tank-b',
    );
    expectStatus(created, 200);
    const tankB = created.body.tankId as string;
    const sup = await supplier(
      ctx,
      {
        commandType: 'CreateSupplier',
        tenantId: ctx.tenantId,
        legalEntityId: ctx.legalEntityId,
        code: `POOL-DIP-SUP-${ctx.runId.slice(0, 8)}`,
        legalName: 'Pool Dip Supplier',
      },
      'pool-dips-supplier',
    );
    expectStatus(sup, 201);
    const delivery = await createDelivery({ ...ctx, tankId: tankB }, 'pool-dips-b', {
      quantityLitres: '500.000',
      deliveredAt: '2026-09-26T05:30:00.000Z',
      supplierId: sup.body.supplierId as string,
    });
    await confirmDelivery(ctx, delivery.deliveryId, 'pool-dips-b-confirm');
    await recordReceiptCost(ctx, delivery.allocationId, '1000.0000', 'pool-dips-b-cost');

    const shift = await openBusinessDayAndShift(ctx, 'pool-dips');
    await sealMeterSegments(client, ctx, shift.shiftId, ['100000.000', '100300.000'], 'pool-dips');

    const reconciliationId = randomUUID();
    const common = { tenantId: ctx.tenantId, stationId: ctx.stationId, reconciliationId };
    const version = async () =>
      (
        await client.unsafe<{ version: number }[]>(
          `select version from app.reconciliations where id='${reconciliationId}'`,
        )
      )[0]!.version;
    const step = async (body: Record<string, unknown>, key: string) => {
      const result = await forecourt(
        ctx,
        { ...body, ...common, expectedVersion: body.expectedVersion ?? (await version()) },
        `pool-dips-${key}`,
        'supervisor',
      );
      expectStatus(result, 200);
      return result;
    };
    await step(
      {
        commandType: 'CreateProductionReconciliation',
        businessDayId: ctx.businessDayId,
        shiftId: shift.shiftId,
        expectedVersion: 0,
      },
      'create',
    );
    await step({ commandType: 'SaveReconciliationDraft' }, 'draft');
    await step(
      { commandType: 'SetAttendants', attendantIds: [ctx.actors.attendant.membershipId] },
      'attendants',
    );
    await step(
      {
        commandType: 'SaveMeterReadings',
        readings: [
          {
            nozzleId: ctx.nozzleId,
            productId: ctx.productId,
            shiftId: shift.shiftId,
            openingReading: '100000.000',
            closingReading: '100300.000',
            sellingPriceId: ctx.priceId,
          },
        ],
      },
      'readings',
    );

    // 1000 + 500 delivered - 300 sold = 1200 L expected across both tanks.
    const dip = async (tankId: string, litres: string, key: string) => {
      const result = await inventory(
        ctx,
        {
          commandType: 'RecordTankDip',
          tenantId: ctx.tenantId,
          stationId: ctx.stationId,
          tankId,
          measuredAt: '2026-09-26T09:00:00.000Z',
          physicalLitres: litres,
        },
        key,
      );
      expectStatus(result, 200);
      return result.body.dipId as string;
    };
    const dipA = await dip(tankA, '700.000', 'pool-dips-dip-a');
    const dipB = await dip(tankB, '500.000', 'pool-dips-dip-b');
    const read = () =>
      reconciliationGet(
        new Request(
          `http://127.0.0.1:3000/api/forecourt/reconciliations/${reconciliationId}?tenantId=${ctx.tenantId}&stationId=${ctx.stationId}`,
          { headers: { ...clerkHeaders(ctx.actors.supervisor.token) } },
        ),
        { params: Promise.resolve({ id: reconciliationId }) },
      );

    // Only one of the two tanks was dipped: the day cannot be checked yet.
    await step(
      {
        commandType: 'LinkTankDips',
        dips: [{ dipId: dipA, tankId: tankA, productId: ctx.productId }],
      },
      'link-one',
    );
    expect((await read()).status).toBe(409);

    // Both tanks dipped: 700 + 500 = 1200 L, exactly what the books expect.
    await step(
      {
        commandType: 'LinkTankDips',
        dips: [
          { dipId: dipA, tankId: tankA, productId: ctx.productId },
          { dipId: dipB, tankId: tankB, productId: ctx.productId },
        ],
      },
      'link-both',
    );
    const response = await read();
    expect(response.status).toBe(200);
    const body = (await response.json()) as { totals: { stockVariance: Record<string, string> } };
    expect(Object.keys(body.totals.stockVariance)).toEqual([tankA]);
    expect(Number(body.totals.stockVariance[tankA])).toBe(0);
  });

  it('keeps a tank on its own in its own pool, so existing figures do not move', async () => {
    const ctx = await createQa1ScenarioContext(client, 'pool-alone');
    const row = await client.unsafe<{ pool: string }[]>(
      `select cost_pool_tank_id as pool from app.tanks where id='${ctx.tankId}'`,
    );
    expect(row).toEqual([{ pool: ctx.tankId }]);
    // A tank added by raw SQL without naming a pool is its own pool (the database fills it in).
    const loneId = crypto.randomUUID();
    await client.unsafe(`
      insert into app.tanks
        (id, tenant_id, station_id, code, product_id, capacity_litres, status, created_by, updated_by)
      values ('${loneId}', '${ctx.tenantId}', '${ctx.stationId}', 'POOL-ALONE-2', '${ctx.productId}',
        5000, 'INACTIVE', '${ctx.actors.admin.membershipId}', '${ctx.actors.admin.membershipId}')
    `);
    const lone = await client.unsafe<{ pool: string }[]>(
      `select cost_pool_tank_id as pool from app.tanks where id='${loneId}'`,
    );
    expect(lone).toEqual([{ pool: loneId }]);
  });
});
