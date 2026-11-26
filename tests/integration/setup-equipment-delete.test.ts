import { seedClerkSession, seedActiveStepUp, clerkHeaders } from './auth-session-fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import postgres, { type Sql } from 'postgres';
import { POST as setupPost } from '../../src/app/api/setup/commands/route';
import { GET as overviewGet } from '../../src/app/api/setup/overview/route';
import { POST as inventoryPost } from '../../src/app/api/inventory/commands/route';

/**
 * #315: a tank, pump or nozzle set up by mistake can be deleted (or a tank moved to another fuel)
 * while nothing has been recorded against it; once it has history it is refused with a plain
 * message. The second block runs the deletes as `app_runtime`, the role production connects as,
 * because every other integration test runs as a superuser and would hide a missing DELETE grant
 * (which is how "Delete this fuel" shipped unable to run).
 */
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for setup integration tests.');

const run = randomUUID().slice(0, 8);
const ids = {
  tenant: randomUUID(),
  legal: randomUUID(),
  station: randomUUID(),
  ownerUser: randomUUID(),
  ownerMembership: randomUUID(),
  ownerSession: randomUUID(),
};
const token = `equip-del-owner-${run}`;
const A = () => ({ tenantId: ids.tenant, stationId: ids.station });

let client: Sql;
let keyCounter = 0;

async function post(handler: (r: Request) => Promise<Response>, body: Record<string, unknown>) {
  keyCounter += 1;
  const res = await handler(
    new Request('http://127.0.0.1:3000/api/x', {
      method: 'POST',
      headers: {
        ...clerkHeaders(token),
        'content-type': 'application/json',
        'idempotency-key': `equip-del-${run}-${keyCounter}`,
      },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

async function overview() {
  const res = await overviewGet(
    new Request(
      `http://127.0.0.1:3000/api/setup/overview?tenantId=${ids.tenant}&stationId=${ids.station}`,
      { headers: { ...clerkHeaders(token) } },
    ),
  );
  return (await res.json()) as { data: Record<string, any[]> };
}

const tankBody = (code: string, productId: string) => ({
  commandType: 'CreateTank',
  ...A(),
  code,
  productId,
  capacityLitres: '10000',
});

describe('deleting unused tanks, pumps and nozzles (#315)', { timeout: 60_000 }, () => {
  const state: Record<string, string> = {};

  beforeAll(async () => {
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';
    process.env.AUDIT_SIGNING_KEY_ID ??= 'integration-setup-key';
    process.env.AUDIT_SIGNING_KEY ??= 'integration-setup-secret';
    client = postgres(databaseUrl, { max: 1, prepare: false });
    await client.unsafe(`
      insert into app.tenants (id, name, slug) values
        ('${ids.tenant}', 'Equipment Tenant', 'equip-del-${run}');
      insert into app.users (id, name, email) values
        ('${ids.ownerUser}', 'Equipment Owner', 'equip-del-${run}@example.test');
      insert into app.memberships (id, tenant_id, identity_id, status) values
        ('${ids.ownerMembership}', '${ids.tenant}', '${ids.ownerUser}', 'ACTIVE');
      insert into app.legal_entities (id, tenant_id, legal_name) values
        ('${ids.legal}', '${ids.tenant}', 'Equipment Legal');
      insert into app.stations (id, tenant_id, legal_entity_id, code, name, status) values
        ('${ids.station}', '${ids.tenant}', '${ids.legal}', 'E${run}', 'Equipment Station', 'ONBOARDING');
      insert into app.membership_role_assignments (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id) values
        ('${ids.tenant}', '${ids.ownerMembership}', 'OWNER', 'TENANT', null, null);
    `);
    await seedClerkSession(client, ids.ownerSession, token, ids.ownerUser, true);
    await seedActiveStepUp(client, ids.ownerSession, ids.tenant);

    for (const [key, code, name] of [
      ['diesel', 'DSL', 'Diesel'],
      ['petrol', 'PET', 'Petrol'],
    ] as const) {
      const created = await post(setupPost, { commandType: 'CreateProduct', ...A(), code, name });
      expect(created.status).toBe(200);
      state[key] = created.body.productId;
    }
  });

  afterAll(async () => {
    await client?.end();
  });

  it('marks new equipment as unused in the setup overview', async () => {
    const tank = await post(inventoryPost, tankBody('PETROL1', state.diesel!));
    expect(tank.status).toBe(200);
    state.wrongTank = tank.body.tankId;
    const pump = await post(setupPost, { commandType: 'CreatePump', ...A(), number: '1' });
    expect(pump.status).toBe(200);
    state.pump = pump.body.pumpId;
    const nozzle = await post(setupPost, {
      commandType: 'CreateNozzle',
      ...A(),
      pumpId: state.pump,
      number: '1',
      productId: state.diesel,
      meterSerialNumber: `M-${run}-1`,
    });
    expect(nozzle.status).toBe(200);
    state.nozzle = nozzle.body.nozzleId;
    state.meter = nozzle.body.meterId;

    const { data } = await overview();
    expect(data.tanks!.find((t) => t.id === state.wrongTank)).toMatchObject({ unused: true });
    expect(data.pumps!.find((p) => p.id === state.pump)).toMatchObject({ unused: true });
    expect(data.nozzles!.find((n) => n.id === state.nozzle)).toMatchObject({ unused: true });
  });

  it('moves an unused tank to the fuel it really holds', async () => {
    const moved = await post(inventoryPost, {
      commandType: 'UpdateTank',
      ...A(),
      tankId: state.wrongTank,
      code: 'PETROL1',
      capacityLitres: '10000',
      reorderLevelLitres: null,
      acceptableVarianceLitres: null,
      varianceRedLitres: null,
      productId: state.petrol,
    });
    expect(moved.status).toBe(200);
    const [row] = await client`select product_id from app.tanks where id = ${state.wrongTank!}`;
    expect(row?.product_id).toBe(state.petrol);
  });

  it('refuses a fuel change and a delete once the tank has a dip', async () => {
    const tank = await post(inventoryPost, tankBody('DIESEL1', state.diesel!));
    expect(tank.status).toBe(200);
    state.usedTank = tank.body.tankId;
    await client`
      insert into app.tank_dips (tenant_id, station_id, tank_id, measured_at, business_date, physical_litres, recorded_by)
      values (${ids.tenant}, ${ids.station}, ${state.usedTank!}, now(), '2026-11-26', 5000, ${ids.ownerMembership})
    `;
    const { data } = await overview();
    expect(data.tanks!.find((t) => t.id === state.usedTank)).toMatchObject({ unused: false });

    const move = await post(inventoryPost, {
      commandType: 'UpdateTank',
      ...A(),
      tankId: state.usedTank,
      code: 'DIESEL1',
      capacityLitres: '10000',
      reorderLevelLitres: null,
      acceptableVarianceLitres: null,
      varianceRedLitres: null,
      productId: state.petrol,
    });
    expect(move.status).toBe(409);
    expect(move.body.message ?? move.body.error?.message ?? JSON.stringify(move.body)).toMatch(
      /fuel cannot be changed/,
    );
    const del = await post(inventoryPost, {
      commandType: 'DeleteTank',
      ...A(),
      tankId: state.usedTank,
    });
    expect(del.status).toBe(409);
    const [still] = await client`select id from app.tanks where id = ${state.usedTank!}`;
    expect(still?.id).toBe(state.usedTank);
  });

  it('deletes an unused tank and records it in the audit log', async () => {
    const del = await post(inventoryPost, {
      commandType: 'DeleteTank',
      ...A(),
      tankId: state.wrongTank,
    });
    expect(del.status).toBe(200);
    expect(await client`select id from app.tanks where id = ${state.wrongTank!}`).toEqual([]);
    const audit = await client`
      select event_code from platform.security_events
      where tenant_id = ${ids.tenant} and details->>'subjectId' = ${state.wrongTank!}
    `;
    expect(audit.map((r) => r.event_code)).toContain('INVENTORY.TANK_DELETED');
  });

  it('deletes an unused nozzle with its meter', async () => {
    const del = await post(setupPost, {
      commandType: 'DeleteNozzle',
      ...A(),
      nozzleId: state.nozzle,
    });
    expect(del.status).toBe(200);
    expect(await client`select id from app.nozzles where id = ${state.nozzle!}`).toEqual([]);
    expect(await client`select id from app.meters where id = ${state.meter!}`).toEqual([]);
  });

  it('refuses to delete a nozzle whose meter was replaced, and its pump', async () => {
    const nozzle = await post(setupPost, {
      commandType: 'CreateNozzle',
      ...A(),
      pumpId: state.pump,
      number: '2',
      productId: state.diesel,
      meterSerialNumber: `M-${run}-2`,
    });
    expect(nozzle.status).toBe(200);
    state.usedNozzle = nozzle.body.nozzleId;
    const second = randomUUID();
    await client`
      insert into app.meters (id, tenant_id, serial_number, status)
      values (${second}, ${ids.tenant}, ${`M-${run}-2b`}, 'ACTIVE')
    `;
    await client`
      update app.meter_installations set effective_to = effective_from + interval '1 hour'
      where nozzle_id = ${state.usedNozzle!}
    `;
    await client`
      insert into app.meter_installations
        (id, tenant_id, station_id, nozzle_id, meter_id, effective_from, installed_by, replacement_reason)
      select ${randomUUID()}, tenant_id, station_id, nozzle_id, ${second}, effective_to,
        ${ids.ownerMembership}, 'Replaced in test'
      from app.meter_installations where nozzle_id = ${state.usedNozzle!}
    `;
    const { data } = await overview();
    expect(data.nozzles!.find((n) => n.id === state.usedNozzle)).toMatchObject({ unused: false });
    expect(data.pumps!.find((p) => p.id === state.pump)).toMatchObject({ unused: false });

    const nozzleDel = await post(setupPost, {
      commandType: 'DeleteNozzle',
      ...A(),
      nozzleId: state.usedNozzle,
    });
    expect(nozzleDel.status).toBe(409);
    const pumpDel = await post(setupPost, {
      commandType: 'DeletePump',
      ...A(),
      pumpId: state.pump,
    });
    expect(pumpDel.status).toBe(409);
    expect(await client`select id from app.pumps where id = ${state.pump!}`).toHaveLength(1);
  });

  it('deletes an unused pump together with its unused nozzles', async () => {
    const pump = await post(setupPost, { commandType: 'CreatePump', ...A(), number: '2' });
    expect(pump.status).toBe(200);
    for (const number of ['1', '2']) {
      const nozzle = await post(setupPost, {
        commandType: 'CreateNozzle',
        ...A(),
        pumpId: pump.body.pumpId,
        number,
        productId: state.diesel,
        meterSerialNumber: `M-${run}-p2-${number}`,
      });
      expect(nozzle.status).toBe(200);
    }
    const del = await post(setupPost, {
      commandType: 'DeletePump',
      ...A(),
      pumpId: pump.body.pumpId,
    });
    expect(del.status).toBe(200);
    expect(del.body.nozzlesDeleted).toBe(2);
    expect(await client`select id from app.nozzles where pump_id = ${pump.body.pumpId}`).toEqual(
      [],
    );
  });
});

describe('stopping use of equipment that has history (#316)', { timeout: 60_000 }, () => {
  const state: Record<string, string> = {};
  const tokenR = `equip-ret-owner-${run}`;
  const r = {
    tenant: randomUUID(),
    legal: randomUUID(),
    station: randomUUID(),
    user: randomUUID(),
    member: randomUUID(),
    session: randomUUID(),
  };
  const AR = () => ({ tenantId: r.tenant, stationId: r.station });
  let c: Sql;
  let n = 0;
  async function postR(body: Record<string, unknown>) {
    n += 1;
    const res = await setupPost(
      new Request('http://127.0.0.1:3000/api/x', {
        method: 'POST',
        headers: {
          ...clerkHeaders(tokenR),
          'content-type': 'application/json',
          'idempotency-key': `equip-ret-${run}-${n}`,
        },
        body: JSON.stringify(body),
      }),
    );
    return { status: res.status, body: (await res.json()) as Record<string, any> };
  }

  beforeAll(async () => {
    process.env.APP_ENV ??= 'test';
    process.env.APP_URL ??= 'http://127.0.0.1:3000';
    process.env.AUDIT_SIGNING_KEY_ID ??= 'integration-setup-key';
    process.env.AUDIT_SIGNING_KEY ??= 'integration-setup-secret';
    c = postgres(databaseUrl!, { max: 1, prepare: false });
    await c.unsafe(`
      insert into app.tenants (id, name, slug) values ('${r.tenant}', 'Retire Tenant', 'equip-ret-${run}');
      insert into app.users (id, name, email) values ('${r.user}', 'Retire Owner', 'equip-ret-${run}@example.test');
      insert into app.memberships (id, tenant_id, identity_id, status) values ('${r.member}', '${r.tenant}', '${r.user}', 'ACTIVE');
      insert into app.legal_entities (id, tenant_id, legal_name) values ('${r.legal}', '${r.tenant}', 'Retire Legal');
      insert into app.stations (id, tenant_id, legal_entity_id, code, name, status) values
        ('${r.station}', '${r.tenant}', '${r.legal}', 'X${run}', 'Retire Station', 'ONBOARDING');
      insert into app.membership_role_assignments (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id) values
        ('${r.tenant}', '${r.member}', 'OWNER', 'TENANT', null, null);
    `);
    await seedClerkSession(c, r.session, tokenR, r.user, true);
    await seedActiveStepUp(c, r.session, r.tenant);
    const fuel = await postR({
      commandType: 'CreateProduct',
      ...AR(),
      code: 'DSL',
      name: 'Diesel',
    });
    state.fuel = fuel.body.productId;
    const pump = await postR({ commandType: 'CreatePump', ...AR(), number: '1' });
    state.pump = pump.body.pumpId;
    for (const number of ['1', '2']) {
      const nozzle = await postR({
        commandType: 'CreateNozzle',
        ...AR(),
        pumpId: state.pump,
        number,
        productId: state.fuel,
        meterSerialNumber: `M-${run}-r${number}`,
      });
      expect(nozzle.status).toBe(200);
      state[`nozzle${number}`] = nozzle.body.nozzleId;
    }
  });

  afterAll(async () => {
    await c?.end();
  });

  it('refuses while a shift is open at that station, and changes nothing', async () => {
    const station2 = randomUUID();
    await c`insert into app.stations (id, tenant_id, legal_entity_id, code, name, status)
      values (${station2}, ${r.tenant}, ${r.legal}, ${'Y' + run}, 'Second Station', 'ONBOARDING')`;
    const where = { tenantId: r.tenant, stationId: station2 };
    const pump = await postR({ commandType: 'CreatePump', ...where, number: '1' });
    expect(pump.status, JSON.stringify(pump.body)).toBe(200);
    const nozzle = await postR({
      commandType: 'CreateNozzle',
      ...where,
      pumpId: pump.body.pumpId,
      number: '1',
      productId: state.fuel,
      meterSerialNumber: `M-${run}-s2`,
    });
    expect(nozzle.status, JSON.stringify(nozzle.body)).toBe(200);
    const day = randomUUID();
    const shift = randomUUID();
    await c`insert into app.station_business_days (id, tenant_id, station_id, business_date)
      values (${day}, ${r.tenant}, ${station2}, '2026-11-26')`;
    await c`insert into app.shifts (id, tenant_id, station_id, business_day_id, planned_start_at, planned_end_at, business_date)
      values (${shift}, ${r.tenant}, ${station2}, ${day}, now(), now() + interval '8 hours', '2026-11-26')`;
    await c`update app.shifts set state = 'OPEN', opened_at = now() where id = ${shift}`;
    for (const body of [
      { commandType: 'RetireNozzle', nozzleId: nozzle.body.nozzleId },
      { commandType: 'RetirePump', pumpId: pump.body.pumpId },
    ]) {
      const refused = await postR({ ...body, ...where });
      expect(refused.status).toBe(409);
      expect(JSON.stringify(refused.body)).toContain('A shift is open');
    }
    const [row] = await c`select status from app.nozzles where id = ${nozzle.body.nozzleId}`;
    expect(row?.status).toBe('ACTIVE');
  });

  it('stops using one nozzle and keeps the rest and the history', async () => {
    const done = await postR({ commandType: 'RetireNozzle', ...AR(), nozzleId: state.nozzle1 });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    const rows = await c`select id, status from app.nozzles where pump_id = ${state.pump!}`;
    expect(rows.find((x) => x.id === state.nozzle1)?.status).toBe('INACTIVE');
    expect(rows.find((x) => x.id === state.nozzle2)?.status).toBe('ACTIVE');
    expect(
      await c`select 1 from app.meter_installations where nozzle_id = ${state.nozzle1!}`,
    ).toHaveLength(1);
    const again = await postR({ commandType: 'RetireNozzle', ...AR(), nozzleId: state.nozzle1 });
    expect(again.status).toBe(404);
  });

  it('stops using a pump with all its nozzles, and audits it', async () => {
    const done = await postR({ commandType: 'RetirePump', ...AR(), pumpId: state.pump });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    const nozzles = await c`select status from app.nozzles where pump_id = ${state.pump!}`;
    expect(nozzles.every((x) => x.status === 'INACTIVE')).toBe(true);
    const [pump] = await c`select status from app.pumps where id = ${state.pump!}`;
    expect(pump?.status).toBe('INACTIVE');
    const audit = await c`
      select event_code from platform.security_events
      where tenant_id = ${r.tenant} and details->>'subjectId' = ${state.pump!}
    `;
    expect(audit.map((x) => x.event_code)).toContain('SETUP.PUMP_RETIRED');
  });
});

describe('the delete statements, as the application role (#315)', { timeout: 60_000 }, () => {
  let runtime: Sql;
  const t = {
    tenant: randomUUID(),
    legal: randomUUID(),
    station: randomUUID(),
    member: randomUUID(),
  };
  const user = randomUUID();

  beforeAll(async () => {
    runtime = postgres(databaseUrl!, { max: 1, prepare: false });
    await runtime.unsafe(`
      insert into app.tenants (id, name, slug) values ('${t.tenant}', 'Runtime Equip', 'rt-equip-${run}');
      insert into app.users (id, name, email) values ('${user}', 'Runtime Owner', 'rt-equip-${run}@example.test');
      insert into app.memberships (id, tenant_id, identity_id, status) values ('${t.member}', '${t.tenant}', '${user}', 'ACTIVE');
      insert into app.legal_entities (id, tenant_id, legal_name) values ('${t.legal}', '${t.tenant}', 'Runtime Legal');
      insert into app.stations (id, tenant_id, legal_entity_id, code, name, status) values
        ('${t.station}', '${t.tenant}', '${t.legal}', 'R${run}', 'Runtime Station', 'ONBOARDING');
    `);
  });

  afterAll(async () => {
    await runtime?.end();
  });

  /** Runs `work` as app_runtime in the tenant, then rolls back. Returns the SQLSTATE, if any. */
  async function asRuntime(work: (sql: postgres.TransactionSql) => Promise<unknown>) {
    let code: string | undefined;
    try {
      await runtime.begin(async (sql) => {
        await sql.unsafe('set local role app_runtime');
        await sql`select set_config('app.tenant_id', ${t.tenant}, true),
          set_config('app.membership_id', ${t.member}, true),
          set_config('app.actor_id', ${user}, true)`;
        await work(sql);
        throw new Error('rollback');
      });
    } catch (error) {
      if ((error as Error).message !== 'rollback')
        code = (error as { code?: string }).code ?? 'ERR';
    }
    return code;
  }

  async function seed() {
    const product = randomUUID();
    const tank = randomUUID();
    const pump = randomUUID();
    const nozzle = randomUUID();
    const meter = randomUUID();
    const suffix = randomUUID().slice(0, 6);
    await runtime.unsafe(`
      insert into app.products (id, tenant_id, code, name, status) values ('${product}', '${t.tenant}', 'P${suffix}', 'Fuel ${suffix}', 'ACTIVE');
      insert into app.tanks (id, tenant_id, station_id, code, product_id, capacity_litres, status, created_by, updated_by)
        values ('${tank}', '${t.tenant}', '${t.station}', 'T${suffix}', '${product}', 1000, 'ACTIVE', '${t.member}', '${t.member}');
      insert into app.pumps (id, tenant_id, station_id, number, status) values ('${pump}', '${t.tenant}', '${t.station}', '${suffix}', 'ACTIVE');
      insert into app.nozzles (id, tenant_id, station_id, pump_id, number, product_id, status)
        values ('${nozzle}', '${t.tenant}', '${t.station}', '${pump}', '1', '${product}', 'ACTIVE');
      insert into app.meters (id, tenant_id, serial_number, status) values ('${meter}', '${t.tenant}', 'RT-${suffix}', 'ACTIVE');
      insert into app.meter_installations (id, tenant_id, station_id, nozzle_id, meter_id, effective_from, installed_by)
        values ('${randomUUID()}', '${t.tenant}', '${t.station}', '${nozzle}', '${meter}', now(), '${t.member}');
    `);
    return { product, tank, pump, nozzle, meter };
  }

  it('may delete never-used equipment', async () => {
    const s = await seed();
    const code = await asRuntime(async (sql) => {
      await sql`delete from app.tank_calibration_points where tank_id = ${s.tank}`;
      await sql`delete from app.tanks where id = ${s.tank}`;
      await sql`delete from app.meter_installations where nozzle_id = ${s.nozzle}`;
      await sql`delete from app.nozzles where id = ${s.nozzle}`;
      await sql`delete from app.meters where id = ${s.meter}`;
      await sql`delete from app.pumps where id = ${s.pump}`;
      await sql`delete from app.products where id = ${s.product}`;
    });
    expect(code).toBeUndefined();
  });

  it('is refused by the database, not by permissions, once a tank has history', async () => {
    const s = await seed();
    await runtime`
      insert into app.tank_dips (tenant_id, station_id, tank_id, measured_at, business_date, physical_litres, recorded_by)
      values (${t.tenant}, ${t.station}, ${s.tank}, now(), '2026-11-26', 100, ${t.member})
    `;
    const code = await asRuntime((sql) => sql`delete from app.tanks where id = ${s.tank}`);
    expect(code).not.toBe('42501');
    expect(['23503', 'P0001']).toContain(code);
  });

  it('still has no DELETE on history tables', async () => {
    const rows = await runtime`
      select c.relname, has_table_privilege('app_runtime', c.oid, 'DELETE') as can_delete
      from pg_class c where c.relnamespace = 'app'::regnamespace
        and c.relname in ('tank_dips', 'inventory_movements', 'meter_boundaries', 'meter_segments')
    `;
    expect(rows.every((r) => r.can_delete === false)).toBe(true);
  });
});
