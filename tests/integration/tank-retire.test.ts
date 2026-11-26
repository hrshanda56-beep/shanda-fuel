import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres, { type Sql } from 'postgres';
import { createQa1ScenarioContext, QA1_TIMES } from './qa1/fixture';
import { inventory, openBusinessDayAndShift, postOpeningPosition } from './qa1/commands';
import { expectStatus } from './qa1/assertions';

/**
 * Stopping use of a tank that has history (#316). It keeps every past record, and is refused while
 * the tank could still hold fuel or a shift is open.
 */
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for the tank retire tests.');

let client: Sql;
type Ctx = Awaited<ReturnType<typeof createQa1ScenarioContext>>;

describe('retiring a tank that has history', () => {
  beforeAll(() => {
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';
    process.env.AUDIT_SIGNING_KEY_ID ??= 'integration-retire-key';
    process.env.AUDIT_SIGNING_KEY ??= 'integration-retire-secret';
    client = postgres(databaseUrl!, { max: 1, prepare: false });
  });

  afterAll(async () => client?.end());

  const retire = (ctx: Ctx, tankId: string, key: string) =>
    inventory(
      ctx,
      { commandType: 'RetireTank', tenantId: ctx.tenantId, stationId: ctx.stationId, tankId },
      key,
    );
  const text = (body: unknown) => JSON.stringify(body);
  const statusOf = async (tankId: string) =>
    (
      await client.unsafe<{ status: string }[]>(`select status from app.tanks where id='${tankId}'`)
    )[0]?.status;

  async function addTank(ctx: Ctx, tag: string) {
    const created = await inventory(
      ctx,
      {
        commandType: 'CreateTank',
        tenantId: ctx.tenantId,
        stationId: ctx.stationId,
        code: `${tag}-${ctx.runId.slice(0, 6)}`,
        productId: ctx.productId,
        capacityLitres: '10000',
      },
      `${tag}-create`,
    );
    expectStatus(created, 200);
    return created.body.tankId as string;
  }

  const addDip = (ctx: Ctx, tankId: string, litres: string, at: string) =>
    client.unsafe(`
      insert into app.tank_dips
        (tenant_id, station_id, tank_id, measured_at, business_date, physical_litres, recorded_by)
      values ('${ctx.tenantId}', '${ctx.stationId}', '${tankId}', '${at}', '${ctx.businessDate}',
        ${litres}, '${ctx.actors.admin.membershipId}')`);

  it('refuses the last tank of a fuel while the fuel has stock on the books', async () => {
    const ctx = await createQa1ScenarioContext(client, 'ret-stock');
    await postOpeningPosition(client, ctx, 'ret-stock', '1000.000', '1000.0000');
    const refused = await retire(ctx, ctx.tankId, 'ret-stock-a');
    expectStatus(refused, 409);
    expect(text(refused.body)).toMatch(/still holds fuel/);
    expect(await statusOf(ctx.tankId)).toBe('ACTIVE');
  });

  it('retires a tank of a pool once, keeps its history, and a new tank still joins the pool', async () => {
    const ctx = await createQa1ScenarioContext(client, 'ret-pool');
    await postOpeningPosition(client, ctx, 'ret-pool', '1000.000', '1000.0000');
    const tankB = await addTank(ctx, 'RET-B');

    const done = await retire(ctx, tankB, 'ret-pool-b');
    expectStatus(done, 200);
    expect(await statusOf(tankB)).toBe('RETIRED');
    const audit = await client.unsafe<{ event_code: string }[]>(
      `select event_code from platform.security_events
       where tenant_id='${ctx.tenantId}' and details->>'subjectId'='${tankB}'`,
    );
    expect(audit.map((r) => r.event_code)).toContain('INVENTORY.TANK_RETIRED');

    const again = await retire(ctx, tankB, 'ret-pool-b-again');
    expectStatus(again, 409);
    expect(text(again.body)).toMatch(/already no longer in use/);

    // The tank is kept (history), the other tank still stands for the fuel, and a tank added
    // later joins that pool rather than the retired tank's.
    const tankC = await addTank(ctx, 'RET-C');
    const pools = await client.unsafe<{ id: string; pool: string; status: string }[]>(
      `select id, cost_pool_tank_id as pool, status from app.tanks
       where id in ('${ctx.tankId}','${tankB}','${tankC}') order by created_at, id`,
    );
    expect(pools).toEqual([
      { id: ctx.tankId, pool: ctx.tankId, status: 'ACTIVE' },
      { id: tankB, pool: ctx.tankId, status: 'RETIRED' },
      { id: tankC, pool: ctx.tankId, status: 'ACTIVE' },
    ]);
  });

  it('refuses a tank whose latest dip reads fuel, and allows it once a later dip reads none', async () => {
    const ctx = await createQa1ScenarioContext(client, 'ret-dip');
    await postOpeningPosition(client, ctx, 'ret-dip', '1000.000', '1000.0000');
    const tankB = await addTank(ctx, 'RET-DIP');
    await addDip(ctx, tankB, '200.000', '2026-09-26T04:00:00.000Z');
    const refused = await retire(ctx, tankB, 'ret-dip-1');
    expectStatus(refused, 409);
    expect(text(refused.body)).toMatch(/still holds fuel/);
    expect(await statusOf(tankB)).toBe('ACTIVE');

    await addDip(ctx, tankB, '0.000', '2026-09-26T05:00:00.000Z');
    expectStatus(await retire(ctx, tankB, 'ret-dip-2'), 200);
    expect(await statusOf(tankB)).toBe('RETIRED');
  });

  it('retires the last tank of a fuel once the fuel is used up', async () => {
    const ctx = await createQa1ScenarioContext(client, 'ret-empty');
    await postOpeningPosition(client, ctx, 'ret-empty', '1000.000', '1000.0000');
    await client.unsafe(`
      insert into app.inventory_movements
        (tenant_id, station_id, tank_id, product_id, movement_type, quantity_litres, effective_at,
         business_date, source_type, source_id, actor_membership_id, reason)
      values ('${ctx.tenantId}', '${ctx.stationId}', '${ctx.tankId}', '${ctx.productId}',
        'NEGATIVE_ADJUSTMENT', -1000, '${QA1_TIMES.segmentClose}', '${ctx.businessDate}',
        'MANUAL_ADJUSTMENT', gen_random_uuid(), '${ctx.actors.admin.membershipId}', 'used up')`);
    expectStatus(await retire(ctx, ctx.tankId, 'ret-empty-a'), 200);
    expect(await statusOf(ctx.tankId)).toBe('RETIRED');
    // Its opening balance and movements are still there.
    const kept = await client.unsafe<{ n: string }[]>(
      `select count(*)::text as n from app.inventory_movements where tank_id='${ctx.tankId}'`,
    );
    expect(Number(kept[0]!.n)).toBeGreaterThanOrEqual(2);
  });

  it('refuses while a shift is open at the station', async () => {
    const ctx = await createQa1ScenarioContext(client, 'ret-shift');
    await postOpeningPosition(client, ctx, 'ret-shift', '1000.000', '1000.0000');
    const tankB = await addTank(ctx, 'RET-SHIFT');
    await openBusinessDayAndShift(ctx, 'ret-shift');
    const refused = await retire(ctx, tankB, 'ret-shift-b');
    expectStatus(refused, 409);
    expect(text(refused.body)).toMatch(/shift is open/);
    expect(await statusOf(tankB)).toBe('ACTIVE');
  });

  it('does not reach a tank at another tenant', async () => {
    const ctx = await createQa1ScenarioContext(client, 'ret-tenant');
    const other = await createQa1ScenarioContext(client, 'ret-tenant-2');
    const result = await retire(ctx, other.tankId, 'ret-tenant-x');
    expect([403, 404]).toContain(result.response.status);
    expect(await statusOf(other.tankId)).toBe('ACTIVE');
  });
});
