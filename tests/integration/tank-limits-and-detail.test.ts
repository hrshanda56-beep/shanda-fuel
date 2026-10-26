import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres, { type Sql } from 'postgres';
import { clerkHeaders } from './auth-session-fixtures';
import { queryTankDetail } from '../../src/modules/inventory/tank-detail';
import { createQa1ScenarioContext, QA1_TIMES } from './qa1/fixture';
import { inventory, postOpeningPosition } from './qa1/commands';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for tank limit tests.');
let client: Sql;

describe('tank variance limits and the tank detail (PostgreSQL)', { timeout: 120_000 }, () => {
  beforeAll(() => {
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';
    process.env.AUDIT_SIGNING_KEY_ID ??= 'integration-tank-key';
    process.env.AUDIT_SIGNING_KEY ??= 'integration-tank-secret';
    client = postgres(databaseUrl!, { max: 1, prepare: false });
  });
  afterAll(async () => client?.end());

  it('keeps two limits, refuses a red below yellow, and judges dips with them', async () => {
    const ctx = await createQa1ScenarioContext(client, 'tank-limits');
    await postOpeningPosition(client, ctx, 'tank-limits-opening', '1000.000', '1000.0000');
    const limits = (key: string, extra: Record<string, unknown>) =>
      inventory(
        ctx,
        {
          commandType: 'SetTankVarianceLimits',
          tenantId: ctx.tenantId,
          stationId: ctx.stationId,
          tankId: ctx.tankId,
          ...extra,
        },
        key,
      );

    // Red cannot sit below yellow, and cannot be set without a yellow one.
    expect(
      (await limits('limits-bad-1', { acceptableVarianceLitres: '20', varianceRedLitres: '10' }))
        .response.status,
    ).toBe(400);
    expect(
      (await limits('limits-bad-2', { acceptableVarianceLitres: null, varianceRedLitres: '10' }))
        .response.status,
    ).toBe(400);
    expect(
      (await limits('limits-ok', { acceptableVarianceLitres: '20', varianceRedLitres: '50' }))
        .response.status,
    ).toBe(200);

    // Three dips against 1,000 L of books: 15 short (green), 45 short (yellow), 60 short (red).
    for (const [index, physical] of [985, 955, 940].entries()) {
      const dip = await inventory(
        ctx,
        {
          commandType: 'RecordTankDip',
          tenantId: ctx.tenantId,
          stationId: ctx.stationId,
          tankId: ctx.tankId,
          measuredAt: new Date(
            Date.parse(QA1_TIMES.opening) + (index + 1) * 3_600_000,
          ).toISOString(),
          physicalLitres: String(physical),
        },
        `limits-dip-${index}`,
      );
      expect(dip.response.status, JSON.stringify(dip.body)).toBe(200);
    }

    const request = new Request('http://127.0.0.1:3000/tank', {
      headers: clerkHeaders(ctx.actors.admin.token),
    });
    const detail = await queryTankDetail({
      request,
      tenantId: ctx.tenantId,
      stationId: ctx.stationId,
      tankId: ctx.tankId,
    });
    expect(detail.canManage).toBe(true);
    expect(detail.tank).toMatchObject({ yellowLitres: '20.000', redLitres: '50.000' });
    // Newest first.
    expect(detail.dips.map((dip) => [dip.physicalLitres, dip.signal])).toEqual([
      ['940.000', 'alert'],
      ['955.000', 'watch'],
      ['985.000', 'ok'],
    ]);
    expect(Number(detail.dips[0]!.varianceLitres)).toBe(-60);
    expect(detail.movements.map((movement) => movement.movementType)).toContain('OPENING_BALANCE');
    expect(Number(detail.tank.bookLitres)).toBe(1000);

    // Clearing red falls back to twice yellow (40 L): 60 short is still red, 45 short now too.
    expect(
      (await limits('limits-clear', { acceptableVarianceLitres: '20', varianceRedLitres: null }))
        .response.status,
    ).toBe(200);
    const again = await queryTankDetail({
      request,
      tenantId: ctx.tenantId,
      stationId: ctx.stationId,
      tankId: ctx.tankId,
    });
    expect(again.dips.map((dip) => dip.signal)).toEqual(['alert', 'alert', 'ok']);

    // Another organisation cannot read this tank at all.
    await expect(
      queryTankDetail({
        request: new Request('http://127.0.0.1:3000/tank', {
          headers: clerkHeaders(ctx.actors.otherTenant.token),
        }),
        tenantId: ctx.tenantId,
        stationId: ctx.stationId,
        tankId: ctx.tankId,
      }),
    ).rejects.toMatchObject({ code: expect.stringMatching(/FORBIDDEN|NOT_FOUND|UNAUTHENTICATED/) });
  });
});
