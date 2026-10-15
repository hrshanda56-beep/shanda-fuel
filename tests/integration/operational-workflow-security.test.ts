import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres, { type Sql, type TransactionSql } from 'postgres';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('A disposable PostgreSQL DATABASE_URL is required');
const id = Object.fromEntries(
  [
    'tenant',
    'otherTenant',
    'legal',
    'otherLegal',
    'station',
    'outside',
    'foreignStation',
    'actor',
    'supervisor',
    'attendantActor',
    'attendant',
    'outsideActor',
    'outsideAttendant',
    'expiredActor',
    'expired',
    'disabledActor',
    'disabled',
    'product',
    'pump',
    'nozzle',
    'meter',
    'installation',
    'day',
    'shift',
    'opening',
    'closing',
    'segment',
    'movement',
    'cost',
    'tank',
  ].map((name) => [name, randomUUID()]),
) as Record<string, string>;
let admin: Sql;

async function scoped<T>(
  work: (tx: TransactionSql) => Promise<T>,
  stationId = id.station,
  actorId = id.actor,
  membershipId = id.supervisor,
  tenantId = id.tenant,
) {
  return admin.begin(async (tx) => {
    await tx`set local role app_runtime`;
    await tx`select set_config('app.tenant_id', ${tenantId!}, true),
      set_config('app.actor_id', ${actorId!}, true), set_config('app.membership_id', ${membershipId!}, true),
      set_config('app.station_id', ${stationId!}, true)`;
    expect((await tx`select current_user as role`)[0]?.role).toBe('app_runtime');
    return work(tx);
  });
}

describe('operational workflow runtime privilege and station isolation regression', () => {
  beforeAll(async () => {
    admin = postgres(databaseUrl, { max: 1, prepare: false });
    await admin.unsafe(`
      insert into app.tenants(id,name,slug) values
        ('${id.tenant}','Synthetic demo security','demo-security-${id.tenant}'),
        ('${id.otherTenant}','Other synthetic tenant','demo-security-${id.otherTenant}');
      insert into app.legal_entities(id,tenant_id,legal_name) values
        ('${id.legal}','${id.tenant}','Synthetic legal'), ('${id.otherLegal}','${id.otherTenant}','Other synthetic legal');
      insert into app.stations(id,tenant_id,legal_entity_id,code,name,status,timezone) values
        ('${id.station}','${id.tenant}','${id.legal}','DEMO','Synthetic station','ACTIVE','Africa/Harare'),
        ('${id.outside}','${id.tenant}','${id.legal}','OUT','Outside station','ACTIVE','Africa/Harare'),
        ('${id.foreignStation}','${id.otherTenant}','${id.otherLegal}','OTHER','Other tenant station','ACTIVE','Africa/Harare');
      insert into auth."user"(id,name,email) values
        ('${id.actor}','Demo Supervisor','${id.actor}@example.test'),
        ('${id.attendantActor}','Demo Attendant','${id.attendantActor}@example.test'),
        ('${id.outsideActor}','Outside Attendant','${id.outsideActor}@example.test'),
        ('${id.expiredActor}','Expired Attendant','${id.expiredActor}@example.test'),
        ('${id.disabledActor}','Disabled Attendant','${id.disabledActor}@example.test');
      insert into app.memberships(id,tenant_id,identity_id,status) values
        ('${id.supervisor}','${id.tenant}','${id.actor}','ACTIVE'),
        ('${id.attendant}','${id.tenant}','${id.attendantActor}','ACTIVE'),
        ('${id.outsideAttendant}','${id.tenant}','${id.outsideActor}','ACTIVE'),
        ('${id.expired}','${id.tenant}','${id.expiredActor}','ACTIVE'),
        ('${id.disabled}','${id.tenant}','${id.disabledActor}','DISABLED');
      insert into app.membership_role_assignments(tenant_id,membership_id,role_code,scope_type,legal_entity_id,station_id,expires_at) values
        ('${id.tenant}','${id.supervisor}','SUPERVISOR','STATION','${id.legal}','${id.station}',null),
        ('${id.tenant}','${id.attendant}','ATTENDANT','STATION','${id.legal}','${id.station}',null),
        ('${id.tenant}','${id.outsideAttendant}','ATTENDANT','STATION','${id.legal}','${id.outside}',null),
        ('${id.tenant}','${id.expired}','ATTENDANT','STATION','${id.legal}','${id.station}',now()-interval '1 day'),
        ('${id.tenant}','${id.disabled}','ATTENDANT','STATION','${id.legal}','${id.station}',null);
      insert into app.products(id,tenant_id,code,name) values ('${id.product}','${id.tenant}','DEMO','Synthetic diesel');
      insert into app.pumps(id,tenant_id,station_id,number) values ('${id.pump}','${id.tenant}','${id.station}','1');
      insert into app.nozzles(id,tenant_id,station_id,pump_id,number,product_id) values
        ('${id.nozzle}','${id.tenant}','${id.station}','${id.pump}','1','${id.product}');
      insert into app.meters(id,tenant_id,serial_number) values ('${id.meter}','${id.tenant}','DEMO-SECURITY');
      insert into app.meter_installations(id,tenant_id,station_id,nozzle_id,meter_id,effective_from,installed_by) values
        ('${id.installation}','${id.tenant}','${id.station}','${id.nozzle}','${id.meter}','2020-01-01','${id.supervisor}');
      insert into app.station_business_days(id,tenant_id,station_id,business_date) values
        ('${id.day}','${id.tenant}','${id.station}','2026-10-15');
      insert into app.shifts(id,tenant_id,station_id,business_day_id,planned_start_at,planned_end_at,business_date) values
        ('${id.shift}','${id.tenant}','${id.station}','${id.day}','2026-10-15T06:00Z','2026-10-15T14:00Z','2026-10-15');
      insert into app.meter_boundaries(id,tenant_id,station_id,nozzle_id,meter_installation_id,business_day_id,shift_id,reason,reading_status,reading_value,effective_at,confirmed_at,confirmed_by,entered_by,attendant_id) values
        ('${id.opening}','${id.tenant}','${id.station}','${id.nozzle}','${id.installation}','${id.day}','${id.shift}','SHIFT_OPEN','AVAILABLE',0,'2026-10-15T06:00Z','2026-10-15T06:00Z','${id.supervisor}','${id.supervisor}','${id.attendant}'),
        ('${id.closing}','${id.tenant}','${id.station}','${id.nozzle}','${id.installation}','${id.day}','${id.shift}','SHIFT_CLOSE','AVAILABLE',100,'2026-10-15T14:00Z','2026-10-15T14:00Z','${id.supervisor}','${id.supervisor}','${id.attendant}');
      insert into app.meter_segments(id,tenant_id,station_id,nozzle_id,meter_installation_id,business_day_id,shift_id,opening_boundary_id,closing_boundary_id,product_id,attendant_id,entered_by,opening_reading,closing_reading,litres,unit_price,expected_sale_value,boundary_reason,segment_start_at,segment_end_at,sealed_at) values
        ('${id.segment}','${id.tenant}','${id.station}','${id.nozzle}','${id.installation}','${id.day}','${id.shift}','${id.opening}','${id.closing}','${id.product}','${id.attendant}','${id.supervisor}',0,100,100,1.5,150,'SHIFT_CLOSE','2026-10-15T06:00Z','2026-10-15T14:00Z','2026-10-15T14:00Z');
      insert into app.tanks(id,tenant_id,station_id,code,product_id,capacity_litres,status,created_by,updated_by) values
        ('${id.tank}','${id.tenant}','${id.station}','DEMO','${id.product}',10000,'ACTIVE','${id.supervisor}','${id.supervisor}');
      insert into app.inventory_movements(id,tenant_id,station_id,tank_id,product_id,movement_type,quantity_litres,effective_at,business_date,source_type,source_id,actor_membership_id) values
        ('${id.movement}','${id.tenant}','${id.station}','${id.tank}','${id.product}','OPENING_BALANCE',1000,'2026-10-15T06:00Z','2026-10-15','CUTOVER','${id.movement}','${id.supervisor}');
      insert into app.inventory_cost_events(id,tenant_id,station_id,tank_id,product_id,event_type,source_type,source_id,effective_at,business_date,amount,currency,actor_membership_id) values
        ('${id.cost}','${id.tenant}','${id.station}','${id.tank}','${id.product}','OPENING_COST','CUTOVER','${id.movement}','2026-10-15T06:00Z','2026-10-15',1000,'USD','${id.supervisor}');
    `);
  });
  afterAll(async () => {
    await admin?.end();
  });

  it('exposes only active current-station attendants on an unprimed runtime context', async () => {
    const visible = await scoped(
      (tx) => tx`select id from app.memberships where id <> ${id.supervisor!}`,
    );
    expect(visible.map((row) => row.id)).toEqual([id.attendant]);
    for (const stationId of [id.outside, id.foreignStation, '']) {
      expect(
        await scoped(
          (tx) => tx`select id from app.memberships where id <> ${id.supervisor!}`,
          stationId,
        ),
      ).toEqual([]);
    }
    expect(
      await scoped(
        (tx) => tx`select id from app.memberships where id = ${id.attendant!}`,
        id.station,
        id.disabledActor,
        id.disabled,
      ),
    ).toEqual([]);
    await admin`update app.membership_role_assignments set expires_at=now()-interval '1 second' where membership_id=${id.supervisor!}`;
    expect(
      await scoped((tx) => tx`select id from app.memberships where id = ${id.attendant!}`),
    ).toEqual([]);
    await admin`update app.membership_role_assignments set expires_at=null where membership_id=${id.supervisor!}`;
  });

  it('grants only identifier UPDATE, retaining forced RLS and no table UPDATE/DELETE', async () => {
    for (const table of [
      'meter_segments',
      'inventory_movements',
      'inventory_cost_events',
      'inventory_sale_cost_attributions',
    ]) {
      const acl =
        await admin`select has_table_privilege('app_runtime', ${'app.' + table}, 'UPDATE') as table_update,
        has_table_privilege('app_runtime', ${'app.' + table}, 'DELETE') as table_delete,
        has_column_privilege('app_runtime', ${'app.' + table}, 'id', 'UPDATE') as id_update`;
      expect(acl[0]).toEqual({ table_update: false, table_delete: false, id_update: true });
      const other =
        await admin`select column_name from information_schema.columns where table_schema='app' and table_name=${table}
        and column_name <> 'id' and has_column_privilege('app_runtime', ${'app.' + table}, column_name, 'UPDATE')`;
      expect(other).toEqual([]);
      const rls =
        await admin`select relrowsecurity,relforcerowsecurity from pg_class where oid=${'app.' + table}::regclass`;
      expect(rls[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    }
  });

  it('allows row locks but rejects direct segment mutation in OPEN and SEALED states', async () => {
    for (const state of ['OPEN', 'SEALED']) {
      expect(
        (
          await scoped(
            (tx) => tx`select state from app.meter_segments where id=${id.segment!} for update`,
          )
        )[0]?.state,
      ).toBe(state);
      for (const expression of ['id', 'gen_random_uuid()']) {
        await expect(
          scoped((tx) =>
            tx.unsafe(`update app.meter_segments set id=${expression} where id='${id.segment}'`),
          ),
        ).rejects.toThrow(/OPEN to SEALED/);
      }
      await expect(
        scoped(
          (tx) =>
            tx`update app.meter_segments set state='SEALED',version=version+1 where id=${id.segment!}`,
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(
        scoped(
          (tx) =>
            tx`insert into app.meter_segments select * from app.meter_segments where id=${id.segment!} on conflict(id) do update set id=excluded.id`,
        ),
      ).rejects.toThrow(/OPEN to SEALED|must be inserted as OPEN/);
      if (state === 'OPEN') {
        const sealed = await scoped(
          (tx) =>
            tx`select app.seal_meter_segment(${id.tenant!}::uuid,${id.station!}::uuid,${id.segment!}::uuid,0) as id`,
        );
        expect(sealed[0]?.id).toBe(id.segment);
      }
    }
    expect(
      await scoped(
        (tx) =>
          tx`select id from app.meter_segments where id=${id.segment!} and station_id=app.current_station_id() for update`,
        id.outside,
      ),
    ).toEqual([]);
    expect(
      await scoped(
        (tx) => tx`select id from app.meter_segments where id=${id.segment!} for update`,
        id.foreignStation,
        id.actor,
        id.supervisor,
        id.otherTenant,
      ),
    ).toEqual([]);
    for (const [table, rowId] of [
      ['inventory_movements', id.movement],
      ['inventory_cost_events', id.cost],
    ]) {
      expect(
        await scoped((tx) =>
          tx.unsafe(`select id from app.${table} where id='${rowId}' for share`),
        ),
      ).toHaveLength(1);
      await expect(
        scoped((tx) => tx.unsafe(`update app.${table} set id=id where id='${rowId}'`)),
      ).rejects.toThrow(/immutable|append-only/);
      await expect(
        scoped((tx) =>
          tx.unsafe(`update app.${table} set id=gen_random_uuid() where id='${rowId}'`),
        ),
      ).rejects.toThrow(/immutable|append-only/);
    }
  });
  it('reverses the catalog-only repair transactionally without changing evidence', async () => {
    const rollback = new Error('rollback local privilege reversal proof');
    await expect(
      admin.begin(async (tx) => {
        await tx.unsafe(`REVOKE UPDATE(id) ON app.meter_segments, app.inventory_movements,
        app.inventory_cost_events, app.inventory_sale_cost_attributions FROM app_runtime;
        DROP POLICY memberships_station_attendants ON app.memberships;`);
        const privileges =
          await tx`select has_column_privilege('app_runtime','app.meter_segments','id','UPDATE') as can_lock`;
        expect(privileges[0]?.can_lock).toBe(false);
        const history =
          await tx`select state,version from app.meter_segments where id=${id.segment!}`;
        expect(history[0]).toEqual({ state: 'SEALED', version: 1 });
        throw rollback;
      }),
    ).rejects.toBe(rollback);
    const restored =
      await admin`select has_column_privilege('app_runtime','app.meter_segments','id','UPDATE') as can_lock`;
    expect(restored[0]?.can_lock).toBe(true);
    expect(
      await scoped((tx) => tx`select id from app.memberships where id=${id.attendant!}`),
    ).toHaveLength(1);
  });
});
