import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres, { type Sql } from 'postgres';
import { clerkHeaders } from './auth-session-fixtures';
import { queryInventoryStock } from '../../src/modules/inventory/queries';
import { createQa1ScenarioContext, QA1_TIMES, type Qa1ScenarioContext } from './qa1/fixture';
import { createDelivery, inventory, postOpeningPosition, supplier } from './qa1/commands';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for inventory integrity tests.');
let client: Sql;

const hoursAfterOpening = (hours: number) =>
  new Date(Date.parse(QA1_TIMES.opening) + hours * 3_600_000).toISOString();

function base(ctx: Qa1ScenarioContext) {
  return { tenantId: ctx.tenantId, stationId: ctx.stationId, tankId: ctx.tankId };
}

async function createSupplier(ctx: Qa1ScenarioContext, key: string): Promise<string> {
  const created = await supplier(
    ctx,
    {
      commandType: 'CreateSupplier',
      tenantId: ctx.tenantId,
      legalEntityId: ctx.legalEntityId,
      code: `INT-${ctx.runId.slice(0, 8)}`,
      legalName: 'Integrity Test Supplier',
    },
    key,
  );
  return created.body.supplierId as string;
}

function recordDip(ctx: Qa1ScenarioContext, key: string, hours: number, physicalLitres: string) {
  return inventory(
    ctx,
    {
      commandType: 'RecordTankDip',
      ...base(ctx),
      measuredAt: hoursAfterOpening(hours),
      physicalLitres,
    },
    key,
  );
}

function adjust(
  ctx: Qa1ScenarioContext,
  key: string,
  movementType: 'POSITIVE_ADJUSTMENT' | 'NEGATIVE_ADJUSTMENT',
  quantityLitres: string,
  effectiveAt: string,
) {
  return inventory(
    ctx,
    {
      commandType: 'PostInventoryAdjustment',
      ...base(ctx),
      movementType,
      quantityLitres,
      effectiveAt,
      reason: 'Integrity test adjustment',
    },
    key,
  );
}

function stock(ctx: Qa1ScenarioContext) {
  return queryInventoryStock({
    request: new Request('http://127.0.0.1:3000/api/inventory/stock', {
      headers: clerkHeaders(ctx.actors.admin.token),
    }),
    ...base(ctx),
  });
}

describe('inventory integrity (PostgreSQL)', { timeout: 120_000 }, () => {
  beforeAll(() => {
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';
    process.env.AUDIT_SIGNING_KEY_ID ??= 'integration-inventory-key';
    process.env.AUDIT_SIGNING_KEY ??= 'integration-inventory-secret';
    client = postgres(databaseUrl!, { max: 1, prepare: false });
  });
  afterAll(async () => client?.end());

  it('refuses a stock adjustment on a tank that already has a cost record, in plain words', async () => {
    const ctx = await createQa1ScenarioContext(client, 'inv-adjust-costed');
    await postOpeningPosition(client, ctx, 'inv-adjust-costed-opening', '1000.000', '1000.0000');
    for (const [index, type] of (
      ['NEGATIVE_ADJUSTMENT', 'POSITIVE_ADJUSTMENT'] as const
    ).entries()) {
      const result = await adjust(
        ctx,
        `inv-adjust-costed-${index}`,
        type,
        '50',
        hoursAfterOpening(2),
      );
      expect(result.response.status, JSON.stringify(result.body)).toBe(409);
      expect(JSON.stringify(result.body)).toContain('already has a cost record');
    }
    const movements = await client`
      select count(*)::int as count from app.inventory_movements
      where tenant_id = ${ctx.tenantId} and tank_id = ${ctx.tankId}`;
    expect(movements[0]?.count).toBe(1);
  });

  it('judges a dip against the books at the time it was taken, not against today', async () => {
    const ctx = await createQa1ScenarioContext(client, 'inv-asof');
    await postOpeningPosition(client, ctx, 'inv-asof-opening', '1000.000', '1000.0000');
    const dip = await recordDip(ctx, 'inv-asof-dip', 1, '1000');
    expect(dip.response.status, JSON.stringify(dip.body)).toBe(200);

    const supplierId = await createSupplier(ctx, 'inv-asof-supplier');
    const delivery = await createDelivery(ctx, 'inv-asof', {
      quantityLitres: '500.000',
      deliveredAt: hoursAfterOpening(3),
      supplierId,
    });
    const confirmed = await inventory(
      ctx,
      {
        commandType: 'ConfirmDelivery',
        tenantId: ctx.tenantId,
        stationId: ctx.stationId,
        deliveryId: delivery.deliveryId,
      },
      'inv-asof-confirm',
    );
    expect(confirmed.response.status, JSON.stringify(confirmed.body)).toBe(200);

    // 500 L arrived two hours after the dip. The dip matched the books when it was taken.
    const [position] = await stock(ctx);
    expect(Number(position!.expectedLitres)).toBe(1000);
    expect(Number(position!.varianceLitres)).toBe(0);
  });

  it('ignores a voided dip when working out the measured stock', async () => {
    const ctx = await createQa1ScenarioContext(client, 'inv-voided');
    await postOpeningPosition(client, ctx, 'inv-voided-opening', '1000.000', '1000.0000');
    const first = await recordDip(ctx, 'inv-voided-dip-0', 1, '900');
    const second = await recordDip(ctx, 'inv-voided-dip-1', 2, '400');
    expect(first.response.status, JSON.stringify(first.body)).toBe(200);
    expect(second.response.status, JSON.stringify(second.body)).toBe(200);
    const dipId = second.body.dipId as string | undefined;
    expect(dipId, `RecordTankDip returned ${JSON.stringify(second.body)}`).toBeTruthy();

    const voided = await inventory(
      ctx,
      {
        commandType: 'VoidTankDip',
        tenantId: ctx.tenantId,
        stationId: ctx.stationId,
        dipId,
        reason: 'Entered the wrong tank by mistake',
      },
      'inv-voided-void',
    );
    expect(voided.response.status, JSON.stringify(voided.body)).toBe(200);

    const [position] = await stock(ctx);
    expect(Number(position!.physicalLitres)).toBe(900);
    expect(Number(position!.varianceLitres)).toBe(-100);
  });

  it('refuses a delivery that would not fit in the tank, and says how much the tank holds', async () => {
    const ctx = await createQa1ScenarioContext(client, 'inv-overfill');
    await postOpeningPosition(client, ctx, 'inv-overfill-opening', '1000.000', '1000.0000');
    const supplierId = await createSupplier(ctx, 'inv-overfill-supplier');
    // The tank holds 10,000 L and already has 1,000 L, so 9,500 L more cannot fit.
    const delivery = await createDelivery(ctx, 'inv-overfill', {
      quantityLitres: '9500.000',
      deliveredAt: hoursAfterOpening(2),
      supplierId,
    });
    const confirmed = await inventory(
      ctx,
      {
        commandType: 'ConfirmDelivery',
        tenantId: ctx.tenantId,
        stationId: ctx.stationId,
        deliveryId: delivery.deliveryId,
      },
      'inv-overfill-confirm',
    );
    expect(confirmed.response.status, JSON.stringify(confirmed.body)).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(confirmed.body)).toContain('more fuel in the tank than it can hold');
    expect(JSON.stringify(confirmed.body)).toContain('10000');
  });

  it('names the note number when it is already recorded, and checks dips attached to a delivery', async () => {
    const ctx = await createQa1ScenarioContext(client, 'inv-delivery-rules');
    await postOpeningPosition(client, ctx, 'inv-delivery-rules-opening', '1000.000', '1000.0000');
    const supplierId = await createSupplier(ctx, 'inv-delivery-rules-supplier');
    const delivery = (key: string, extra: Record<string, unknown> = {}) =>
      inventory(
        ctx,
        {
          commandType: 'CreateDelivery',
          tenantId: ctx.tenantId,
          stationId: ctx.stationId,
          productId: ctx.productId,
          supplierId,
          noPoReason: 'EMERGENCY_PURCHASE',
          deliveryNoteNumber: 'INT-DN-1',
          deliveredAt: hoursAfterOpening(2),
          noteQuantityLitres: '100.000',
          actualQuantityLitres: '100.000',
          allocations: [{ tankId: ctx.tankId, quantityLitres: '100.000' }],
          ...extra,
        },
        key,
      );

    const first = await delivery('inv-delivery-rules-1');
    expect(first.response.status, JSON.stringify(first.body)).toBe(200);
    const duplicate = await delivery('inv-delivery-rules-2');
    expect(duplicate.response.status, JSON.stringify(duplicate.body)).toBe(409);
    expect(JSON.stringify(duplicate.body)).toContain('note number INT-DN-1 is already recorded');

    const dip = await recordDip(ctx, 'inv-delivery-rules-dip', 1, '1000');
    const dipId = dip.body.dipId as string;
    const both = await delivery('inv-delivery-rules-3', {
      deliveryNoteNumber: 'INT-DN-2',
      preDeliveryDipId: dipId,
      preDeliveryDip: { measuredAt: hoursAfterOpening(1), physicalLitres: '1000' },
    });
    expect(both.response.status, JSON.stringify(both.body)).toBe(400);
    expect(JSON.stringify(both.body)).toContain('not both');

    const voided = await inventory(
      ctx,
      {
        commandType: 'VoidTankDip',
        tenantId: ctx.tenantId,
        stationId: ctx.stationId,
        dipId,
        reason: 'Entered the wrong tank by mistake',
      },
      'inv-delivery-rules-void',
    );
    expect(voided.response.status, JSON.stringify(voided.body)).toBe(200);
    const cancelled = await delivery('inv-delivery-rules-4', {
      deliveryNoteNumber: 'INT-DN-3',
      preDeliveryDipId: dipId,
    });
    expect(cancelled.response.status, JSON.stringify(cancelled.body)).toBe(409);
    expect(JSON.stringify(cancelled.body)).toContain('was cancelled');
  });

  it('refuses a second active tank for a fuel the station already has a tank for', async () => {
    const ctx = await createQa1ScenarioContext(client, 'inv-two-tanks');
    const productRows = await client`
      select product_id from app.tanks where id = ${ctx.tankId}`;
    const second = await inventory(
      ctx,
      {
        commandType: 'CreateTank',
        tenantId: ctx.tenantId,
        stationId: ctx.stationId,
        code: 'SECOND-TANK',
        productId: productRows[0]!.product_id,
        capacityLitres: '5000',
      },
      'inv-two-tanks-create',
    );
    expect(second.response.status, JSON.stringify(second.body)).toBe(409);
    expect(JSON.stringify(second.body)).toContain('already has an active tank for this fuel');
  });
});
