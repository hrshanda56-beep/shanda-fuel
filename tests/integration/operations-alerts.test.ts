import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres, { type Sql } from 'postgres';
import { withInventoryReadContext } from '../../src/modules/inventory/application';
import { loadOperationsFacts } from '../../src/modules/approvals/operations-facts';
import { clerkHeaders } from './auth-session-fixtures';
import { createQa1ScenarioContext, QA1_TIMES, type Qa1ScenarioContext } from './qa1/fixture';
import {
  createApprovedSale,
  inventory,
  openBusinessDayAndShift,
  postOpeningPosition,
} from './qa1/commands';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for operations alert tests.');
let client: Sql;

const facts = (ctx: Qa1ScenarioContext) =>
  withInventoryReadContext(
    new Request('http://127.0.0.1:3000/x', { headers: clerkHeaders(ctx.actors.admin.token) }),
    ctx.tenantId,
    ctx.stationId,
    (tx, context) => loadOperationsFacts(tx, context, { lookbackDays: 36500 }),
  );

describe('operations alert facts (PostgreSQL)', { timeout: 120_000 }, () => {
  beforeAll(() => {
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';
    process.env.AUDIT_SIGNING_KEY_ID ??= 'integration-opsalert-key';
    process.env.AUDIT_SIGNING_KEY ??= 'integration-opsalert-secret';
    client = postgres(databaseUrl!, { max: 1, prepare: false });
  });
  afterAll(async () => client?.end());

  it('reads the dip variance against book stock at dip time, reorder level and unsubmitted days', async () => {
    const ctx = await createQa1ScenarioContext(client, 'opsalert-a');
    await postOpeningPosition(client, ctx, 'opsalert-a');
    await client.unsafe(
      `update app.tanks set acceptable_variance_litres = 10, reorder_level_litres = 1200
       where tenant_id='${ctx.tenantId}' and id='${ctx.tankId}'`,
    );
    const dip = await inventory(
      ctx,
      {
        commandType: 'RecordTankDip',
        tenantId: ctx.tenantId,
        stationId: ctx.stationId,
        tankId: ctx.tankId,
        measuredAt: '2026-09-26T07:00:00.000Z',
        physicalLitres: '900.000',
      },
      'opsalert-a-dip',
    );
    expect(dip.response.status).toBe(200);
    await openBusinessDayAndShift(ctx, 'opsalert-a');

    const result = await facts(ctx);
    expect(result.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.tanks).toEqual([
      expect.objectContaining({
        expectedLitres: '1000.000',
        physicalLitres: '900.000',
        varianceAtDipLitres: '-100.000',
        toleranceLitres: '10.000',
        reorderLevelLitres: '1200.000',
      }),
    ]);
    expect(result.reports?.unsubmittedDates).toEqual([ctx.businessDate]);
    expect(result.reports?.cashShortages).toEqual([]);
  });

  it('finds a cash shortage once the day is submitted, and stops calling the day unsubmitted', async () => {
    const ctx = await createQa1ScenarioContext(client, 'opsalert-b');
    await createApprovedSale(client, ctx, 'opsalert-b', {
      saleLitres: '30.000',
      payments: [{ method: 'CASH', amount: '75.0000' }],
      countedCash: '70.0000',
      explanations: { CASH: 'Short at count' },
      post: true,
      completeShiftAfter: true,
    });
    const result = await facts(ctx);
    expect(result.reports?.cashShortages).toEqual([
      { businessDate: ctx.businessDate, amount: '5.0000' },
    ]);
    expect(result.reports?.unsubmittedDates).toEqual([]);
  });

  it('keeps its facts tenant-scoped', async () => {
    const ctx = await createQa1ScenarioContext(client, 'opsalert-c');
    const result = await facts(ctx);
    expect(result.tanks?.every((tank) => tank.tankId === ctx.tankId)).toBe(true);
    expect(QA1_TIMES.opening).toBeTruthy();
  });
});
