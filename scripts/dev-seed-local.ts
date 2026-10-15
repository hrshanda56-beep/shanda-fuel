// Local-only dev seed. Refuses to run unless the target is localhost.
import postgres from 'postgres';
import { hashPassword } from 'better-auth/crypto';

const url = process.env.DATABASE_DIRECT_URL;
if (!url || !/@?(localhost|127\.0\.0\.1)[:/]/.test(url)) throw new Error('Local DATABASE_DIRECT_URL required');
const sql = postgres(url, { max: 1, prepare: false });
const PASSWORD = 'DevPassword!2026';

const users = [
  { email: 'owner@shandafuel.test', name: 'Dev Owner', role: 'OWNER', scope: 'TENANT' },
  { email: 'admin@shandafuel.test', name: 'Dev Administrator', role: 'ADMINISTRATOR', scope: 'TENANT' },
  { email: 'finance@shandafuel.test', name: 'Dev Finance', role: 'FINANCE', scope: 'TENANT' },
  { email: 'supervisor@shandafuel.test', name: 'Dev Supervisor', role: 'SUPERVISOR', scope: 'STATION' },
  { email: 'attendant@shandafuel.test', name: 'Dev Attendant', role: 'ATTENDANT', scope: 'STATION' },
] as const;

async function main() {
const passwordHash = await hashPassword(PASSWORD);
await sql.begin(async (tx) => {
  const [tenant] = await tx`insert into app.tenants (name, slug) values ('Dev Fuel Co', 'dev-fuel') on conflict (slug) do update set name = excluded.name returning id`;
  const tenantId = tenant!.id as string;
  let [le] = await tx`select id from app.legal_entities where tenant_id = ${tenantId} limit 1`;
  if (!le) [le] = await tx`insert into app.legal_entities (tenant_id, legal_name) values (${tenantId}, 'Dev Fuel Co (Pvt) Ltd') returning id`;
  const leId = le!.id as string;
  const stationIds: string[] = [];
  for (const [code, name] of [['DEV1', 'Dev Station Harare'], ['DEV2', 'Dev Station Bulawayo']]) {
    let [st] = await tx`select id from app.stations where tenant_id = ${tenantId} and code = ${code}`;
    if (!st) [st] = await tx`insert into app.stations (tenant_id, legal_entity_id, code, name, status) values (${tenantId}, ${leId}, ${code}, ${name}, 'ACTIVE') returning id`;
    stationIds.push(st!.id as string);
  }
  for (const u of users) {
    let [user] = await tx`select id from auth."user" where email = ${u.email}`;
    if (!user) [user] = await tx`insert into auth."user" (name, email, email_verified) values (${u.name}, ${u.email}, true) returning id`;
    const userId = user!.id as string;
    await tx`delete from auth.account where user_id = ${userId} and provider_id = 'credential'`;
    await tx`insert into auth.account (account_id, provider_id, user_id, password) values (${userId}, 'credential', ${userId}, ${passwordHash})`;
    let [m] = await tx`select id from app.memberships where tenant_id = ${tenantId} and identity_id = ${userId}`;
    if (!m) [m] = await tx`insert into app.memberships (tenant_id, identity_id) values (${tenantId}, ${userId}) returning id`;
    const has = await tx`select 1 from app.membership_role_assignments where membership_id = ${m!.id}`;
    if (!has.length) {
      if (u.scope === 'TENANT') await tx`insert into app.membership_role_assignments (tenant_id, membership_id, role_code, scope_type) values (${tenantId}, ${m!.id}, ${u.role}, 'TENANT')`;
      else for (const sid of stationIds) await tx`insert into app.membership_role_assignments (tenant_id, membership_id, role_code, scope_type, legal_entity_id, station_id) values (${tenantId}, ${m!.id}, ${u.role}, 'STATION', ${leId}, ${sid})`;
    }
  }

  // Products, tanks, opening stock and dips so the inventory screens have data.
  const [ownerMembership] = await tx`select m.id from app.memberships m join auth."user" u on u.id = m.identity_id where m.tenant_id = ${tenantId} and u.email = 'owner@shandafuel.test'`;
  const actor = ownerMembership!.id as string;
  const productIds = new Map<string, string>();
  for (const [code, name] of [['DIESEL', 'Diesel 50'], ['ULP95', 'Unleaded 95'], ['BLEND', 'Blend']]) {
    let [p] = await tx`select id from app.products where tenant_id = ${tenantId} and code = ${code}`;
    if (!p) [p] = await tx`insert into app.products (tenant_id, code, name) values (${tenantId}, ${code}, ${name}) returning id`;
    productIds.set(code, p!.id as string);
  }
  // station index, code, product, capacity, reorder, book litres, last dip litres (null = none)
  const tanks: [number, string, string, number, number | null, number, number | null][] = [
    [0, 'T1', 'DIESEL', 50000, 8000, 41200, 41050],
    [0, 'T2', 'DIESEL', 30000, 6000, 8400, 8250],
    [0, 'T3', 'ULP95', 40000, 7000, 11200, 11200],
    [0, 'T4', 'ULP95', 20000, 4000, 2900, 2780],
    [0, 'T5', 'BLEND', 15000, null, 6100, null],
    [1, 'T1', 'DIESEL', 40000, 8000, 29800, 29900],
    [1, 'T2', 'ULP95', 30000, 6000, 17500, 17420],
  ];
  for (const [si, code, product, capacity, reorder, book, dip] of tanks) {
    const stationId = stationIds[si]!;
    let [t] = await tx`select id from app.tanks where tenant_id = ${tenantId} and station_id = ${stationId} and code = ${code}`;
    if (t) continue;
    [t] = await tx`insert into app.tanks (tenant_id, station_id, code, product_id, capacity_litres, reorder_level_litres, status, created_by, updated_by) values (${tenantId}, ${stationId}, ${code}, ${productIds.get(product)!}, ${capacity}, ${reorder}, 'ACTIVE', ${actor}, ${actor}) returning id`;
    await tx`insert into app.inventory_movements (tenant_id, station_id, tank_id, product_id, movement_type, quantity_litres, effective_at, business_date, source_type, source_id, actor_membership_id)
      values (${tenantId}, ${stationId}, ${t!.id}, ${productIds.get(product)!}, 'OPENING_BALANCE', ${book}, now() - interval '3 days', to_char(now() - interval '3 days', 'YYYY-MM-DD'), 'OPENING_BALANCE', gen_random_uuid(), ${actor})`;
    if (dip !== null) {
      await tx`insert into app.tank_dips (tenant_id, station_id, tank_id, measured_at, business_date, physical_litres, raw_measurement, measurement_unit, recorded_by)
        values (${tenantId}, ${stationId}, ${t!.id}, now() - interval '2 hours', to_char(now(), 'YYYY-MM-DD'), ${dip}, ${dip}, 'LITRES', ${actor})`;
    }
  }
});
console.log('seeded', users.length, 'users');
await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
