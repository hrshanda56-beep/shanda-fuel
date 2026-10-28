import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres, { type Sql } from 'postgres';
import { createQa1ScenarioContext, type Qa1ScenarioContext } from './qa1/fixture';
import { inventory } from './qa1/commands';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for tank calibration tests.');
let client: Sql;

const authority = (ctx: Qa1ScenarioContext) => ({
  tenantId: ctx.tenantId,
  stationId: ctx.stationId,
});

describe('tank calibration charts (PostgreSQL)', { timeout: 120_000 }, () => {
  beforeAll(() => {
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';
    process.env.AUDIT_SIGNING_KEY_ID ??= 'integration-calibration-key';
    process.env.AUDIT_SIGNING_KEY ??= 'integration-calibration-secret';
    client = postgres(databaseUrl!, { max: 1, prepare: false });
  });
  afterAll(async () => client?.end());

  it('turns a dipstick reading into litres, and keeps old dips when the chart is replaced', async () => {
    const ctx = await createQa1ScenarioContext(client, 'calib-a');
    const set = (key: string, points: { measurement: string; litres: string }[], unit = 'cm') =>
      inventory(
        ctx,
        {
          commandType: 'SetTankCalibration',
          ...authority(ctx),
          tankId: ctx.tankId,
          measurementUnit: unit,
          points,
        },
        key,
      );
    const dip = (key: string, body: Record<string, unknown>) =>
      inventory(
        ctx,
        {
          commandType: 'RecordTankDip',
          ...authority(ctx),
          tankId: ctx.tankId,
          measuredAt: '2026-09-26T07:00:00.000Z',
          ...body,
        },
        key,
      );

    const noChart = await dip('calib-a-nochart', { rawMeasurement: '50', measurementUnit: 'cm' });
    expect(noChart.response.status).toBe(400);

    const first = await set('calib-a-v1', [
      { measurement: '0', litres: '0' },
      { measurement: '100', litres: '100' },
    ]);
    expect(first.response.status).toBe(200);
    expect(first.body).toMatchObject({ chartVersion: 1, rows: 2 });

    const byReading = await dip('calib-a-dip1', { rawMeasurement: '37.5', measurementUnit: 'cm' });
    expect(byReading.response.status).toBe(200);
    expect(byReading.body.physicalLitres).toBe('37.5');

    const outside = await dip('calib-a-dip2', { rawMeasurement: '150', measurementUnit: 'cm' });
    expect(outside.response.status).toBe(400);

    const second = await set('calib-a-v2', [
      { measurement: '0', litres: '0' },
      { measurement: '100', litres: '200' },
    ]);
    expect(second.body.chartVersion).toBe(2);
    const reread = await dip('calib-a-dip3', { rawMeasurement: '37.5', measurementUnit: 'cm' });
    expect(reread.body.physicalLitres).toBe('75');

    const dips = await client.unsafe(
      `select physical_litres::text as litres from app.tank_dips
        where tank_id = '${ctx.tankId}' order by created_at`,
    );
    expect(dips.map((row) => row.litres)).toEqual(['37.500', '75.000']);

    const typed = await dip('calib-a-typed', { physicalLitres: '50.000' });
    expect(typed.body.physicalLitres).toBe('50');
  });

  it('refuses a chart that is not sensible', async () => {
    const ctx = await createQa1ScenarioContext(client, 'calib-b');
    const set = (key: string, points: { measurement: string; litres: string }[]) =>
      inventory(
        ctx,
        {
          commandType: 'SetTankCalibration',
          ...authority(ctx),
          tankId: ctx.tankId,
          measurementUnit: 'cm',
          points,
        },
        key,
      );
    const backwards = await set('calib-b-1', [
      { measurement: '0', litres: '500' },
      { measurement: '100', litres: '10' },
    ]);
    expect(backwards.response.status).toBe(400);
    const tooBig = await set('calib-b-2', [
      { measurement: '0', litres: '0' },
      { measurement: '100', litres: '999999999' },
    ]);
    expect(tooBig.response.status).toBe(400);
    const single = await set('calib-b-3', [{ measurement: '0', litres: '0' }]);
    expect(single.response.status).toBe(400);
  });

  it('keeps one tenant from setting another tenant’s tank chart', async () => {
    const mine = await createQa1ScenarioContext(client, 'calib-c');
    const theirs = await createQa1ScenarioContext(client, 'calib-d');
    const attempt = await inventory(
      mine,
      {
        commandType: 'SetTankCalibration',
        tenantId: mine.tenantId,
        stationId: mine.stationId,
        tankId: theirs.tankId,
        measurementUnit: 'cm',
        points: [
          { measurement: '0', litres: '0' },
          { measurement: '10', litres: '10' },
        ],
      },
      'calib-c-cross',
    );
    expect([403, 404]).toContain(attempt.response.status);
    const rows = await client.unsafe(
      `select count(*)::int as n from app.tank_calibration_points where tank_id = '${theirs.tankId}'`,
    );
    expect(rows[0]!.n).toBe(0);
  });

  it('voids an unattached dip once, keeps the reason, and preserves tenant isolation', async () => {
    const mine = await createQa1ScenarioContext(client, 'calib-void-mine');
    const theirs = await createQa1ScenarioContext(client, 'calib-void-theirs');
    const dip = await inventory(
      mine,
      {
        commandType: 'RecordTankDip',
        ...authority(mine),
        tankId: mine.tankId,
        measuredAt: '2026-09-26T07:00:00.000Z',
        physicalLitres: '50.000',
      },
      'calib-void-dip',
    );
    expect(dip.response.status).toBe(200);
    const voided = await inventory(
      mine,
      {
        commandType: 'VoidTankDip',
        ...authority(mine),
        dipId: dip.body.dipId,
        reason: 'Duplicate audit dip',
      },
      'calib-void-command',
    );
    expect(voided.response.status).toBe(200);
    const rows = await client.unsafe<
      { voided_at: Date | null; voided_by: string | null; void_reason: string | null }[]
    >(
      `select voided_at, voided_by, void_reason from app.tank_dips where tenant_id = '${mine.tenantId}' and id = '${dip.body.dipId}'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.voided_at).not.toBeNull();
    expect(rows[0]?.voided_by).toBe(mine.actors.admin.membershipId);
    expect(rows[0]?.void_reason).toBe('Duplicate audit dip');

    const repeat = await inventory(
      mine,
      {
        commandType: 'VoidTankDip',
        ...authority(mine),
        dipId: dip.body.dipId,
        reason: 'Second void attempt',
      },
      'calib-void-repeat',
    );
    expect(repeat.response.status).toBe(409);

    const crossTenant = await inventory(
      theirs,
      {
        commandType: 'VoidTankDip',
        ...authority(theirs),
        dipId: dip.body.dipId,
        reason: 'Cross tenant attempt',
      },
      'calib-void-cross-tenant',
    );
    expect([403, 404]).toContain(crossTenant.response.status);
    const audit = await client.unsafe<{ count: string }[]>(
      `select count(*)::text as count from platform.security_events where tenant_id = '${mine.tenantId}' and event_code = 'INVENTORY.TANK_DIP_VOIDED' and details->>'subjectId' = '${dip.body.dipId}'`,
    );
    expect(audit[0]?.count).toBe('1');
  });
});
