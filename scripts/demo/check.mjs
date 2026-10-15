/** DEMO ONLY: verifies fixture integrity without altering operational evidence. */
import assert from 'node:assert/strict';
import { verifyPassword } from 'better-auth/crypto';
import { actors, demoPassword, id } from './seed.mjs';

export async function check(sql) {
  for (const [table, expected] of [
    ['stations', 1],
    ['products', 2],
    ['tanks', 2],
    ['pumps', 3],
    ['nozzles', 3],
    ['meters', 3],
    ['meter_installations', 3],
    ['memberships', 5],
  ]) {
    const [row] = await sql.unsafe(
      `select count(*)::int as count from app.${table} where tenant_id=$1`,
      [id(1)],
    );
    assert.equal(row.count, expected, table);
  }
  for (const a of actors) {
    const [row] =
      await sql`select a.password,r.role_code,r.scope_type,r.station_id from auth.account a join app.memberships m on m.identity_id=a.user_id join app.membership_role_assignments r on r.membership_id=m.id where m.id=${a.membershipId} and m.tenant_id=${id(1)}`;
    assert.equal(row.role_code, a.role);
    assert.equal(row.scope_type, a.role === 'OWNER' ? 'TENANT' : 'STATION');
    assert.equal(row.station_id, a.role === 'OWNER' ? null : id(3));
    assert.equal(await verifyPassword({ hash: row.password, password: demoPassword }), true);
  }
  const readings =
    await sql`select reading_value::text from app.meter_boundaries where id in (${id(711)},${id(712)},${id(713)}) order by id`;
  assert.deepEqual(
    readings.map((r) => r.reading_value),
    ['10000.000', '20000.000', '30000.000'],
  );
  const prices =
    await sql`select unit_price::text,state from app.selling_prices where id in (${id(421)},${id(422)}) order by id`;
  assert.deepEqual(Array.from(prices), [
    { unit_price: '1.550000', state: 'ACTIVE' },
    { unit_price: '1.600000', state: 'ACTIVE' },
  ]);
  const [runtime] =
    await sql`select rolsuper,rolbypassrls,rolcreaterole,rolcreatedb from pg_roles where rolname='app_runtime'`;
  assert.deepEqual(runtime, {
    rolsuper: false,
    rolbypassrls: false,
    rolcreaterole: false,
    rolcreatedb: false,
  });
  const [owner] =
    await sql`select pg_get_userbyid(proowner) as owner from pg_proc where oid='app.create_meter_exception_for_unavailable_boundary()'::regprocedure`;
  assert.equal(owner.owner, 'migration_owner');
  const [rls] =
    await sql`select count(*)::int as total,count(*) filter(where relrowsecurity and relforcerowsecurity)::int as protected from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='app' and c.relkind='r'`;
  assert.ok(rls.total > 0);
  assert.equal(rls.total, rls.protected);
  console.log(
    'PASS: DEMO ONLY fixture identities, role scopes, password hashes, prices, opening readings, runtime role and RLS/FORCE RLS',
  );
}
