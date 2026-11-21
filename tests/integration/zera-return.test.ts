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

const qs2 = (ctx: Qa1ScenarioContext) =>
  `?tenantId=${ctx.tenantId}&stationId=${ctx.stationId}&month=${MONTH}&ethanolPercent=10`;

describe(
  'ZERA return: sold litres and row-level security (PostgreSQL)',
  { timeout: 180_000 },
  () => {
    let sql2: Sql;
    let ctx: Qa1ScenarioContext;
    let shiftId: string;

    /**
     * Reconciliations are driven by guarded commands (state machine, lineage, locked detail). This test
     * only needs finished reports to read, so it seeds end states with the database's triggers off for
     * this one connection, then turns them back on. What is under test (the ZERA read and save) runs
     * normally.
     */
    async function seeding<T>(work: () => Promise<T>): Promise<T> {
      await sql2.unsafe('set session_replication_role = replica');
      try {
        return await work();
      } finally {
        await sql2.unsafe('set session_replication_role = default');
      }
    }

    async function addReading(reconciliationId: string, litres: string) {
      await sql2`
      insert into app.reconciliation_meter_readings
        (tenant_id, station_id, reconciliation_id, shift_id, nozzle_id, product_id,
         opening_reading, closing_reading, litres_sold, unit_price, sales_value, entered_by)
      values (${ctx.tenantId}, ${ctx.stationId}, ${reconciliationId}, ${shiftId}, ${ctx.nozzleId},
        ${ctx.productId}, 0, ${litres}, ${litres}, 1, ${litres}, ${ctx.actors.admin.membershipId})`;
    }

    /** One day with a report in the given state and one meter reading. */
    function day(date: string, state: string, litres: string) {
      return seeding(async () => {
        const existing = await sql2`
        select id::text as id from app.station_business_days
        where station_id = ${ctx.stationId} and business_date = ${date}`;
        const dayId = (existing[0]?.id as string | undefined) ?? randomUUID();
        if (!existing[0]) {
          await sql2`
          insert into app.station_business_days (id, tenant_id, station_id, business_date, state)
          values (${dayId}, ${ctx.tenantId}, ${ctx.stationId}, ${date}, 'NOT_STARTED')`;
        }
        const reconciliationId = randomUUID();
        await sql2`
        insert into app.reconciliations (id, tenant_id, station_id, business_day_id, state)
        values (${reconciliationId}, ${ctx.tenantId}, ${ctx.stationId}, ${dayId}, ${state})`;
        await addReading(reconciliationId, litres);
        return reconciliationId;
      });
    }

    function approveLater(reconciliationId: string) {
      return seeding(
        () =>
          sql2`update app.reconciliations set state = 'APPROVED' where id = ${reconciliationId}`,
      );
    }

    beforeAll(async () => {
      process.env.APP_ENV ??= 'test';
      process.env.APP_URL ??= 'http://127.0.0.1:3000';
      process.env.AUDIT_SIGNING_KEY_ID ??= 'integration-zera-key';
      process.env.AUDIT_SIGNING_KEY ??= 'integration-zera-secret';
      sql2 = postgres(databaseUrl!, { max: 1, prepare: false });
      ctx = await createQa1ScenarioContext(sql2, 'zera-sold');
      await sql2`update app.products set kind = 'PETROL' where id = ${ctx.productId}`;
      shiftId = randomUUID();
      await sql2`
      insert into app.shifts (id, tenant_id, station_id, business_day_id, state, planned_start_at,
        planned_end_at, business_date)
      values (${shiftId}, ${ctx.tenantId}, ${ctx.stationId}, ${ctx.businessDayId}, 'PLANNED',
        '2026-09-26T06:00:00Z', '2026-09-26T14:00:00Z', '2026-09-26')`;
    });
    afterAll(async () => sql2?.end());

    it('counts only approved, posted and locked days, and marks sold litres m until every day is', async () => {
      // The first business day is 24 September, so every day from then to 30 September needs a report.
      const pendingId = await day('2026-09-24', 'PENDING_APPROVAL', '50.000');
      await day('2026-09-25', 'APPROVED', '100.250');
      await day('2026-09-26', 'POSTED', '100.000');
      await day('2026-09-27', 'LOCKED', '50.000');
      const draftId = await day('2026-09-28', 'DRAFT', '999.000');
      await day('2026-09-29', 'APPROVED', '0.250');
      await day('2026-09-30', 'APPROVED', '0.000');

      type View = {
        result: { petrol: { sold: string }; diesel50: { sold: string }; missingDays: string[] };
      };
      const read = async () =>
        (await (await call(readGet, ctx, 'admin', `/api/reports/zera${qs2(ctx)}`)).json()) as View;

      // The 24th is pending and the 28th is a draft: neither counts as an approved report.
      const before = await read();
      expect(before.result.missingDays).toEqual(['2026-09-24', '2026-09-28']);
      expect(before.result.petrol.sold).toBe('m');
      expect(before.result.diesel50.sold).toBe('m');

      await approveLater(pendingId);
      await approveLater(draftId);
      const after = await read();
      expect(after.result.missingDays).toEqual([]);
      // 50 + 100.25 + 100 + 50 + 999 + 0.25 + 0 = 1299.5 litres exactly: a half rounds up to 1300.
      expect(after.result.petrol.sold).toBe('1300');
      expect(after.result.diesel50.sold).toBe('0');
    });

    it('shows saved returns only to their own organisation, as the application role', async () => {
      const saved = await call(savePost, ctx, 'admin', '/api/reports/zera/saved', {
        method: 'POST',
        body: {
          tenantId: ctx.tenantId,
          stationId: ctx.stationId,
          month: MONTH,
          ethanolPercent: 10,
          notes: '',
          details,
        },
        key: `rls-${randomUUID()}`,
      });
      expect(saved.status).toBe(200);
      const asRuntime = async (tenantId: string, run: () => Promise<void>) => {
        await sql2.unsafe('set role app_runtime');
        try {
          await sql2`select set_config('app.tenant_id', ${tenantId}, false)`;
          await sql2`select set_config('app.actor_id', ${ctx.actors.admin.actorId}, false)`;
          await sql2`select set_config('app.membership_id', ${ctx.actors.admin.membershipId}, false)`;
          await run();
        } finally {
          await sql2.unsafe('reset role');
        }
      };
      await asRuntime(ctx.tenantId, async () => {
        const own = await sql2`select count(*)::int as n from app.zera_returns`;
        expect(own[0]!.n).toBeGreaterThanOrEqual(1);
        await expect(sql2`update app.zera_returns set month = '2026-08'`).rejects.toThrow();
        await expect(sql2`delete from app.zera_returns`).rejects.toThrow();
      });
      await asRuntime(ctx.otherTenantId, async () => {
        const foreign = await sql2`select count(*)::int as n from app.zera_returns`;
        expect(foreign[0]!.n).toBe(0);
      });
      await sql2.unsafe('set role app_runtime');
      try {
        await sql2`select set_config('app.tenant_id', '', false)`;
        const noContext = await sql2`select count(*)::int as n from app.zera_returns`;
        expect(noContext[0]!.n).toBe(0);
      } finally {
        await sql2.unsafe('reset role');
      }
    });
  },
);
