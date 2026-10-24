import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres, { type Sql } from 'postgres';
import { createQa1ScenarioContext, QA1_TIMES } from './qa1/fixture';
import {
  confirmDelivery,
  createDelivery,
  inventory,
  postOpeningPosition,
  supplier,
} from './qa1/commands';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for landed cost tests.');
let client: Sql;

describe('landed cost build-up (PostgreSQL)', { timeout: 120_000 }, () => {
  beforeAll(() => {
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';
    process.env.AUDIT_SIGNING_KEY_ID ??= 'integration-landed-key';
    process.env.AUDIT_SIGNING_KEY ??= 'integration-landed-secret';
    client = postgres(databaseUrl!, { max: 1, prepare: false });
  });
  afterAll(async () => client?.end());

  it('spreads fuel, freight and other costs over the litres that actually arrived', async () => {
    const ctx = await createQa1ScenarioContext(client, 'landed-a');
    await postOpeningPosition(client, ctx, 'landed-a-opening');
    const created = await supplier(
      ctx,
      {
        commandType: 'CreateSupplier',
        tenantId: ctx.tenantId,
        legalEntityId: ctx.legalEntityId,
        code: `LND-${ctx.runId.slice(0, 8)}`,
        legalName: 'Landed Cost Supplier',
      },
      'landed-a-supplier',
    );
    const supplierId = created.body.supplierId as string;
    const delivery = await createDelivery(ctx, 'landed-a', {
      quantityLitres: '980.000',
      noteQuantityLitres: '1000.000',
      deliveredAt: QA1_TIMES.opening,
      supplierId,
    });
    await confirmDelivery(ctx, delivery.deliveryId, 'landed-a-confirm');

    const cost = (key: string, extra: Record<string, unknown>) =>
      inventory(
        ctx,
        {
          commandType: 'RecordReceiptCost',
          tenantId: ctx.tenantId,
          stationId: ctx.stationId,
          allocationId: delivery.allocationId,
          currency: 'USD',
          ...extra,
        },
        key,
      );

    const both = await cost('landed-a-both', {
      amount: '1000',
      costBuildUp: { fuelCost: '1000' },
    });
    expect(both.response.status).toBe(400);
    const neither = await cost('landed-a-neither', {});
    expect(neither.response.status).toBe(400);

    const posted = await cost('landed-a-buildup', {
      costBuildUp: {
        fuelCost: '1000',
        freight: '80',
        otherCosts: [{ label: 'Offloading', amount: '18' }],
      },
    });
    expect(posted.response.status).toBe(200);
    expect(posted.body.landedCost).toMatchObject({
      totalCost: '1098',
      unitCost: '1.12040816',
      allocationCost: '1098',
      currency: 'USD',
    });
    expect(posted.body.landedCost.components.map((c: { label: string }) => c.label)).toEqual([
      'Fuel',
      'Freight',
      'Offloading',
    ]);

    const events = await client.unsafe(
      `select amount::text as amount from app.inventory_cost_events
        where source_id = '${delivery.allocationId}'`,
    );
    expect(events.map((row) => Number(row.amount))).toEqual([1098]);
  });
});
