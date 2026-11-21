import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres, { type Sql } from 'postgres';
import { GET as readGet } from '../../src/app/api/reports/zera/route';
import { GET as listGet, POST as savePost } from '../../src/app/api/reports/zera/saved/route';
import { GET as downloadGet } from '../../src/app/api/reports/zera/download/route';
import { clerkHeaders } from './auth-session-fixtures';
import { createQa1ScenarioContext, QA1_TIMES, type Qa1ScenarioContext } from './qa1/fixture';
import { confirmDelivery, inventory, postOpeningPosition, supplier } from './qa1/commands';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for the ZERA return tests.');
let client: Sql;

/** The fixture's deliveries land on 26 September 2026, so September is the month under test. */
const MONTH = '2026-09';

const hoursAfterOpening = (hours: number) =>
  new Date(Date.parse(QA1_TIMES.opening) + hours * 3_600_000).toISOString();

type Who = 'admin' | 'supervisor' | 'finance' | 'attendant' | 'otherTenant';

function call(
  handler: (request: Request) => Promise<Response>,
  ctx: Qa1ScenarioContext,
  who: Who,
  url: string,
  init: { method?: string; body?: unknown; key?: string } = {},
) {
  return handler(
    new Request(`http://127.0.0.1:3000${url}`, {
      method: init.method ?? 'GET',
      headers: {
        ...clerkHeaders(ctx.actors[who].token),
        'content-type': 'application/json',
        ...(init.key ? { 'idempotency-key': init.key } : {}),
      },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
    }),
  );
}

const qs = (ctx: Qa1ScenarioContext, extra = '') =>
  `?tenantId=${ctx.tenantId}&stationId=${ctx.stationId}&month=${MONTH}${extra}`;

const details = {
  licenceHolder: 'Triumph Energy (Pvt) Ltd',
  licenceNumber: 'L-2026-77',
  ownership: 'COCO',
  province: 'Harare',
  representativeName: 'Tendai Moyo',
  representativePhone: '+263 77 123 4567',
  representativeEmail: 'tendai@example.com',
};

function saveBody(ctx: Qa1ScenarioContext, extra: Record<string, unknown> = {}) {
  return {
    tenantId: ctx.tenantId,
    stationId: ctx.stationId,
    month: MONTH,
    ethanolPercent: 0,
    notes: 'Pump 2 was offline for a day.',
    details,
    ...extra,
  };
}

async function receive(ctx: Qa1ScenarioContext, key: string, supplierId: string, litres: string) {
  const made = await inventory(
    ctx,
    {
      commandType: 'CreateDelivery',
      tenantId: ctx.tenantId,
      stationId: ctx.stationId,
      productId: ctx.productId,
      supplierId,
      noPoReason: 'EMERGENCY_PURCHASE',
      deliveryNoteNumber: `ZR-DN-${key}`,
      deliveredAt: hoursAfterOpening(3),
      noteQuantityLitres: litres,
      actualQuantityLitres: litres,
      allocations: [{ tankId: ctx.tankId, quantityLitres: litres }],
    },
    `${key}-create`,
  );
  expect(made.response.status, JSON.stringify(made.body)).toBe(200);
  await confirmDelivery(ctx, made.body.deliveryId as string, `${key}-confirm`);
}

describe('ZERA monthly return (PostgreSQL)', { timeout: 180_000 }, () => {
  let ctx: Qa1ScenarioContext;

  beforeAll(async () => {
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';
    process.env.AUDIT_SIGNING_KEY_ID ??= 'integration-zera-key';
    process.env.AUDIT_SIGNING_KEY ??= 'integration-zera-secret';
    client = postgres(databaseUrl!, { max: 1, prepare: false });
    ctx = await createQa1ScenarioContext(client, 'zera');
    await postOpeningPosition(client, ctx, 'zera-opening', '1000.000', '1000.0000');
    const created = await supplier(
      ctx,
      {
        commandType: 'CreateSupplier',
        tenantId: ctx.tenantId,
        legalEntityId: ctx.legalEntityId,
        code: `ZR-${ctx.runId.slice(0, 6)}`,
        legalName: 'ZERA test supplier',
      },
      'zera-supplier',
    );
    const supplierId = created.body.supplierId as string;
    await client`update app.products set kind = 'PETROL' where id = ${ctx.productId}`;
    // Two receipts of 1000.4 and 500.4 litres: 1500.8 in total, which is 1501 to the nearest litre.
    // Rounding each receipt first would give 1000 + 500 = 1500, so this catches rounding too early.
    await receive(ctx, 'zera-a', supplierId, '1000.4');
    await receive(ctx, 'zera-b', supplierId, '500.4');
  });
  afterAll(async () => client?.end());

  it('works the month out from the database to the nearest litre, rounding once', async () => {
    const response = await call(readGet, ctx, 'admin', `/api/reports/zera${qs(ctx)}`);
    expect(response.status).toBe(200);
    const view = (await response.json()) as {
      result: { petrol: { supplied: string; sold: string }; diesel50: { supplied: string } };
    };
    expect(view.result.petrol.supplied).toBe('1501');
    expect(view.result.diesel50.supplied).toBe('0');
    // No day of September has an approved report, so sold litres are missing, not zero.
    expect(view.result.petrol.sold).toBe('m');
  });

  it('refuses a product with no fuel type instead of guessing, then accepts it once set', async () => {
    await client`update app.products set kind = null where id = ${ctx.productId}`;
    try {
      const blocked = await call(savePost, ctx, 'admin', '/api/reports/zera/saved', {
        method: 'POST',
        body: saveBody(ctx),
        key: `blocked-${randomUUID()}`,
      });
      expect(blocked.status).toBe(400);
      expect(JSON.stringify(await blocked.json())).toContain('no fuel type');
    } finally {
      await client`update app.products set kind = 'PETROL' where id = ${ctx.productId}`;
    }
    const rows = await client`
      select count(*)::int as n from app.zera_returns where tenant_id = ${ctx.tenantId}`;
    expect(rows[0]!.n).toBe(0);
  });

  it('asks for the ethanol percentage when petrol moved and none is on record', async () => {
    const { ethanolPercent: _omit, ...withoutEthanol } = saveBody(ctx);
    const response = await call(savePost, ctx, 'admin', '/api/reports/zera/saved', {
      method: 'POST',
      body: withoutEthanol,
      key: `ethanol-${randomUUID()}`,
    });
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).toContain('ethanol');
  });

  it('rejects licence details that are missing or malformed', async () => {
    const bad = await call(savePost, ctx, 'admin', '/api/reports/zera/saved', {
      method: 'POST',
      body: saveBody(ctx, { details: { ...details, representativeEmail: 'not-an-email' } }),
      key: `bad-email-${randomUUID()}`,
    });
    expect(bad.status).toBe(400);
    const province = await call(savePost, ctx, 'admin', '/api/reports/zera/saved', {
      method: 'POST',
      body: saveBody(ctx, { details: { ...details, province: 'Atlantis' } }),
      key: `bad-province-${randomUUID()}`,
    });
    expect(province.status).toBe(400);
    const noKey = await call(savePost, ctx, 'admin', '/api/reports/zera/saved', {
      method: 'POST',
      body: saveBody(ctx),
    });
    expect(noKey.status).toBe(400);
  });

  it('saves the return, keeps the licence details, and saves a correction as a new version', async () => {
    const first = await call(savePost, ctx, 'admin', '/api/reports/zera/saved', {
      method: 'POST',
      body: saveBody(ctx),
      key: `save-1-${randomUUID()}`,
    });
    expect(first.status).toBe(200);
    const saved = (await first.json()) as {
      version: number;
      answers: { label: string; value: string }[];
    };
    expect(saved.version).toBe(1);
    expect(saved.answers).toHaveLength(14);
    expect(saved.answers.map((a) => a.value).slice(0, 8)).toEqual([
      'Tendai Moyo',
      '+263 77 123 4567',
      'tendai@example.com',
      'Triumph Energy (Pvt) Ltd',
      'COCO',
      'L-2026-77',
      'September',
      'Harare',
    ]);
    expect(saved.answers.slice(8, 13).map((a) => a.value)).toEqual(['0', '1501', '0', 'm', 'm']);
    expect(saved.answers[13]!.value).toContain('Pump 2 was offline for a day.');

    const station = await client`
      select zera_licence_number, zera_representative_email from app.stations
      where id = ${ctx.stationId}`;
    expect(station[0]).toMatchObject({
      zera_licence_number: 'L-2026-77',
      zera_representative_email: 'tendai@example.com',
    });

    const second = await call(savePost, ctx, 'admin', '/api/reports/zera/saved', {
      method: 'POST',
      body: saveBody(ctx, { notes: 'Corrected note.' }),
      key: `save-2-${randomUUID()}`,
    });
    expect(((await second.json()) as { version: number }).version).toBe(2);

    const list = await call(listGet, ctx, 'admin', `/api/reports/zera/saved${qs(ctx)}`);
    const versions = (await list.json()) as { version: number; month: string }[];
    expect(versions.map((v) => `${v.month}:${v.version}`)).toEqual([`${MONTH}:2`, `${MONTH}:1`]);
  });

  it('refuses to save a month that has not finished', async () => {
    const now = new Date();
    const running = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const res = await call(savePost, ctx, 'admin', '/api/reports/zera/saved', {
      method: 'POST',
      body: saveBody(ctx, { month: running }),
      key: `running-${randomUUID()}`,
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('has not finished');
  });

  it('gives simultaneous saves of one month their own version numbers', async () => {
    const results = await Promise.all(
      [1, 2, 3].map((n) =>
        call(savePost, ctx, 'admin', '/api/reports/zera/saved', {
          method: 'POST',
          body: saveBody(ctx, { notes: `Parallel ${n}.` }),
          key: `parallel-${n}-${randomUUID()}`,
        }),
      ),
    );
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    const versions = (await Promise.all(results.map((r) => r.json()))) as { version: number }[];
    expect(new Set(versions.map((v) => v.version)).size).toBe(3);
  });

  it('repeats the same save safely when the same idempotency key is sent again', async () => {
    const key = `same-${randomUUID()}`;
    const before = await client`
      select count(*)::int as n from app.zera_returns where tenant_id = ${ctx.tenantId}`;
    const one = await call(savePost, ctx, 'admin', '/api/reports/zera/saved', {
      method: 'POST',
      body: saveBody(ctx, { notes: 'Retry test.' }),
      key,
    });
    const two = await call(savePost, ctx, 'admin', '/api/reports/zera/saved', {
      method: 'POST',
      body: saveBody(ctx, { notes: 'Retry test.' }),
      key,
    });
    expect(one.status).toBe(200);
    expect(two.status).toBe(200);
    expect(((await one.json()) as { id: string }).id).toBe(
      ((await two.json()) as { id: string }).id,
    );
    const after = await client`
      select count(*)::int as n from app.zera_returns where tenant_id = ${ctx.tenantId}`;
    expect(after[0]!.n).toBe(before[0]!.n + 1);
    // The same key with different content is refused, not silently reused.
    const clash = await call(savePost, ctx, 'admin', '/api/reports/zera/saved', {
      method: 'POST',
      body: saveBody(ctx, { notes: 'Different.' }),
      key,
    });
    expect(clash.status).toBeGreaterThanOrEqual(400);
  });

  it('keeps a saved return exactly as it was when the books change afterwards', async () => {
    const created = await supplier(
      ctx,
      {
        commandType: 'CreateSupplier',
        tenantId: ctx.tenantId,
        legalEntityId: ctx.legalEntityId,
        code: `ZR2-${ctx.runId.slice(0, 5)}`,
        legalName: 'ZERA late supplier',
      },
      'zera-supplier-late',
    );
    await receive(ctx, 'zera-late', created.body.supplierId as string, '2000');
    const live = (await (
      await call(readGet, ctx, 'admin', `/api/reports/zera${qs(ctx)}`)
    ).json()) as {
      result: { petrol: { supplied: string } };
    };
    expect(live.result.petrol.supplied).toBe('3501');
    const download = await call(
      downloadGet,
      ctx,
      'admin',
      `/api/reports/zera/download${qs(ctx, '&version=1&format=csv')}`,
    );
    expect(download.status).toBe(200);
    expect(download.headers.get('content-type')).toContain('text/csv');
    const csv = await download.text();
    expect(csv).toContain('"1501"');
    expect(csv).not.toContain('3501');
  });

  it('downloads a PDF and records the download in the signed audit log', async () => {
    const before = await client`
      select count(*)::int as n from platform.security_events
      where tenant_id = ${ctx.tenantId} and event_code = 'REPORT.EXPORTED'`;
    const pdf = await call(
      downloadGet,
      ctx,
      'admin',
      `/api/reports/zera/download${qs(ctx, '&version=2&format=pdf')}`,
    );
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
    expect(
      Buffer.from(await pdf.arrayBuffer())
        .subarray(0, 4)
        .toString(),
    ).toBe('%PDF');
    const after = await client`
      select count(*)::int as n from platform.security_events
      where tenant_id = ${ctx.tenantId} and event_code = 'REPORT.EXPORTED'`;
    expect(after[0]!.n).toBe(before[0]!.n + 1);
    const saves = await client`
      select count(*)::int as n from platform.security_events
      where tenant_id = ${ctx.tenantId} and event_code = 'REPORT.ZERA_RETURN_SAVED'`;
    expect(saves[0]!.n).toBeGreaterThanOrEqual(3);
  });

  it('refuses a download without a format, or for a return that was never saved', async () => {
    const noFormat = await call(
      downloadGet,
      ctx,
      'admin',
      `/api/reports/zera/download${qs(ctx, '&format=xlsx')}`,
    );
    expect(noFormat.status).toBe(400);
    const never = await call(
      downloadGet,
      ctx,
      'admin',
      `/api/reports/zera/download?tenantId=${ctx.tenantId}&stationId=${ctx.stationId}&month=2025-01&format=csv`,
    );
    expect(never.status).toBe(404);
  });

  it('lets only people who may view reports see or save returns', async () => {
    const attempts: [Who, boolean][] = [
      ['admin', true],
      ['finance', true],
      ['supervisor', true],
      ['attendant', false],
      ['otherTenant', false],
    ];
    for (const [who, allowed] of attempts) {
      const read = await call(readGet, ctx, who, `/api/reports/zera${qs(ctx)}`);
      const list = await call(listGet, ctx, who, `/api/reports/zera/saved${qs(ctx)}`);
      const save = await call(savePost, ctx, who, '/api/reports/zera/saved', {
        method: 'POST',
        body: saveBody(ctx, { notes: `By ${who}.` }),
        key: `perm-${who}-${randomUUID()}`,
      });
      const download = await call(
        downloadGet,
        ctx,
        who,
        `/api/reports/zera/download${qs(ctx, '&version=1&format=csv')}`,
      );
      for (const response of [read, list, save, download]) {
        if (allowed) expect(response.status, `${who} should be allowed`).toBe(200);
        else expect(response.status, `${who} should be refused`).toBeGreaterThanOrEqual(401);
      }
    }
    const attendantRows = await client`
      select count(*)::int as n from app.zera_returns
      where tenant_id = ${ctx.tenantId} and answers::text like '%By attendant.%'`;
    expect(attendantRows[0]!.n).toBe(0);
  });

  it('keeps one organisation from reaching another’s station', async () => {
    const response = await call(
      readGet,
      ctx,
      'otherTenant',
      `/api/reports/zera?tenantId=${ctx.otherTenantId}&stationId=${ctx.stationId}&month=${MONTH}`,
    );
    expect(response.status).toBe(404);
    const crossSave = await call(savePost, ctx, 'otherTenant', '/api/reports/zera/saved', {
      method: 'POST',
      body: { ...saveBody(ctx), tenantId: ctx.otherTenantId },
      key: `cross-${randomUUID()}`,
    });
    expect(crossSave.status).toBeGreaterThanOrEqual(400);
    const leaked = await client`
      select count(*)::int as n from app.zera_returns where tenant_id = ${ctx.otherTenantId}`;
    expect(leaked[0]!.n).toBe(0);
  });

  it('does not let a supervisor reach a station that is not theirs', async () => {
    const response = await call(
      readGet,
      ctx,
      'supervisor',
      `/api/reports/zera?tenantId=${ctx.tenantId}&stationId=${ctx.outsideStationId}&month=${MONTH}`,
    );
    expect(response.status).toBeGreaterThanOrEqual(403);
  });

  it('never lets the application role change or remove a saved return', async () => {
    const rows = await client`
      select has_table_privilege('app_runtime', 'app.zera_returns', 'SELECT') as can_read,
             has_table_privilege('app_runtime', 'app.zera_returns', 'INSERT') as can_add,
             has_table_privilege('app_runtime', 'app.zera_returns', 'UPDATE') as can_change,
             has_table_privilege('app_runtime', 'app.zera_returns', 'DELETE') as can_remove`;
    expect(rows[0]).toEqual({
      can_read: true,
      can_add: true,
      can_change: false,
      can_remove: false,
    });
    const policy = await client`
      select relrowsecurity, relforcerowsecurity from pg_class
      where oid = 'app.zera_returns'::regclass`;
    expect(policy[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });
});
