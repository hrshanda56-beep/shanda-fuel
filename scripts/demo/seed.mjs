/** DEMO ONLY. Called exclusively by owner-demo.mjs inside its private PG18 cluster. */
import { hashPassword } from 'better-auth/crypto';

export const id = (n) => `d0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
// Public synthetic password, deliberately not a production credential.
export const demoPassword = 'DEMO-ONLY-Local-Fuel-2026!';
export const actors = [
  ['owner', 'OWNER'],
  ['supervisor', 'SUPERVISOR'],
  ['attendant1', 'ATTENDANT'],
  ['attendant2', 'ATTENDANT'],
  ['attendant3', 'ATTENDANT'],
].map(([name, role], i) => ({
  name,
  role,
  userId: id(101 + i),
  membershipId: id(201 + i),
  email: `${name}@owner-demo.example.test`,
}));

export async function seed(client) {
  await client.begin(async (sql) => {
    await sql`select pg_advisory_xact_lock(187640015)`;
    if ((await sql`select id from app.tenants where id=${id(1)}`).length) return;
    const password = await hashPassword(demoPassword);
    await sql`insert into app.tenants (id,name,slug) values (${id(1)},'DEMO ONLY — Fictional Fuel','owner-demo-only')`;
    await sql`insert into app.legal_entities (id,tenant_id,legal_name) values (${id(2)},${id(1)},'DEMO ONLY — Fictional Energy Ltd')`;
    await sql`insert into app.stations (id,tenant_id,legal_entity_id,code,name,status,timezone) values (${id(3)},${id(1)},${id(2)},'DEMO-01','DEMO ONLY — Acacia Station','ACTIVE','Africa/Harare')`;
    for (const a of actors) {
      await sql`insert into auth."user" (id,name,email,email_verified) values (${a.userId},${`DEMO ONLY — ${a.name}`},${a.email},true)`;
      await sql`insert into auth.account (id,account_id,provider_id,user_id,password) values (${id(301 + actors.indexOf(a))},${a.userId},'credential',${a.userId},${password})`;
      await sql`insert into app.memberships (id,tenant_id,identity_id,status) values (${a.membershipId},${id(1)},${a.userId},'ACTIVE')`;
      await sql`insert into app.membership_role_assignments (tenant_id,membership_id,role_code,scope_type,legal_entity_id,station_id) values (${id(1)},${a.membershipId},${a.role},${a.role === 'OWNER' ? 'TENANT' : 'STATION'},${a.role === 'OWNER' ? null : id(2)},${a.role === 'OWNER' ? null : id(3)})`;
    }
    for (const [i, name, price] of [
      [0, 'Diesel', '1.550000'],
      [1, 'Petrol', '1.600000'],
    ]) {
      await sql`insert into app.products (id,tenant_id,code,name) values (${id(401 + i)},${id(1)},${`DEMO-${name.toUpperCase()}`},${`DEMO ONLY — ${name}`})`;
      await sql`insert into app.tanks (id,tenant_id,station_id,code,product_id,capacity_litres,reorder_level_litres,acceptable_variance_litres,status,created_by,updated_by) values (${id(411 + i)},${id(1)},${id(3)},${`DEMO-T${i + 1}`},${id(401 + i)},'20000.000','2000.000','10.000','ACTIVE',${id(201)},${id(201)})`;
      await sql`insert into app.selling_prices (id,tenant_id,station_id,product_id,effective_from,unit_price,state,requested_by) values (${id(421 + i)},${id(1)},${id(3)},${id(401 + i)},'2020-01-01T00:00:00Z',${price},'DRAFT',${id(201)})`;
      for (const state of [
        'PENDING_APPROVAL',
        'APPROVED',
        'PENDING_STATION_ACTIVATION',
        'BOUNDARIES_IN_PROGRESS',
        'ACTIVE',
      ]) {
        await sql`update app.selling_prices set state=${state},approved_by=${id(201)},approved_at=now(),activated_at=now() where id=${id(421 + i)}`;
      }
    }
    const [{ timezone }] = await sql`select timezone from app.stations where id=${id(3)}`;
    const date = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const start = `${date}T04:00:00Z`;
    const end = `${date}T12:00:00Z`;
    await sql`insert into app.shift_templates (id,tenant_id,station_id,code,name,start_time,duration_minutes,created_by) values (${id(701)},${id(1)},${id(3)},'DEMO-DAY','DEMO ONLY — Day shift','06:00',480,${id(201)})`;
    await sql`insert into app.station_business_days (id,tenant_id,station_id,business_date,state,opened_at) values (${id(702)},${id(1)},${id(3)},${date},'NOT_STARTED',${start})`;
    await sql`update app.station_business_days set state='OPEN' where id=${id(702)}`;
    await sql`insert into app.shifts (id,tenant_id,station_id,business_day_id,state,planned_start_at,planned_end_at,shift_template_id,business_date,opened_at) values (${id(703)},${id(1)},${id(3)},${id(702)},'PLANNED',${start},${end},${id(701)},${date},${start})`;
    await sql`update app.shifts set state='OPEN' where id=${id(703)}`;
    for (let i = 0; i < 3; i++) {
      const product = id(401 + (i === 1 ? 1 : 0));
      await sql`insert into app.pumps (id,tenant_id,station_id,number,name) values (${id(501 + i)},${id(1)},${id(3)},${String(i + 1)},${`DEMO ONLY — Pump ${i + 1}`})`;
      await sql`insert into app.nozzles (id,tenant_id,station_id,pump_id,number,product_id) values (${id(511 + i)},${id(1)},${id(3)},${id(501 + i)},'1',${product})`;
      await sql`insert into app.meters (id,tenant_id,serial_number) values (${id(521 + i)},${id(1)},${`DEMO-METER-${i + 1}`})`;
      await sql`insert into app.meter_installations (id,tenant_id,station_id,nozzle_id,meter_id,effective_from,installed_by) values (${id(531 + i)},${id(1)},${id(3)},${id(511 + i)},${id(521 + i)},'2020-01-01T00:00:00Z',${id(201)})`;
      await sql`insert into app.meter_boundaries (id,tenant_id,station_id,nozzle_id,meter_installation_id,business_day_id,shift_id,reason,reading_status,reading_value,effective_at,confirmed_at,confirmed_by,entered_by,attendant_id) values (${id(711 + i)},${id(1)},${id(3)},${id(511 + i)},${id(531 + i)},${id(702)},${id(703)},'SHIFT_OPEN','AVAILABLE',${String((i + 1) * 10000)},${start},${start},${id(203 + i)},${id(203 + i)},${id(203 + i)})`;
    }
    for (const [n, type] of [
      [801, 'STATION_TILL'],
      [802, 'STATION_SAFE'],
    ]) {
      await sql`insert into app.cash_locations (id,tenant_id,station_id,code,name,location_type) values (${id(n)},${id(1)},${id(3)},${`DEMO-${n}`},${`DEMO ONLY — ${type}`},${type})`;
    }
  });
}

export async function manifest(sql) {
  const days =
    await sql`select business_date,state from app.station_business_days where id=${id(702)}`;
  return {
    label: 'DEMO ONLY — independent origin/main fixture; not integrated acceptance evidence',
    tenantId: id(1),
    legalEntityId: id(2),
    stationId: id(3),
    businessDayId: id(702),
    shiftId: id(703),
    days,
    actors,
    products: [id(401), id(402)],
    tanks: [id(411), id(412)],
    prices: [id(421), id(422)],
    pumps: [id(501), id(502), id(503)],
    nozzles: [id(511), id(512), id(513)],
    openingBoundaries: [id(711), id(712), id(713)],
    paymentMethods: ['CASH', 'POS', 'ECOCASH', 'BANK_TRANSFER'],
    cashLocations: [id(801), id(802)],
  };
}
