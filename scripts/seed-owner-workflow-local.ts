/** Synthetic local rehearsal only. Never reads a deployment URL or credentials file. */
import postgres from 'postgres';
import { ids, seedOwnerWorkflow, seedSecondNozzle } from '../tests/fixtures/owner-workflow';

const target = process.env.DATABASE_DIRECT_URL;
if (!target || process.env.APP_ENV !== 'test')
  throw new Error('APP_ENV=test and a local database URL are required');
const url = new URL(target);
if (
  !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
  !/^\/shanda_owner_[a-z0-9_]+$/.test(url.pathname)
) {
  throw new Error('Only a named shanda_owner_* disposable loopback database is permitted');
}
async function main() {
  const client = postgres(target, { max: 1, prepare: false });
  try {
    const [version] = await client`select current_setting('server_version_num')::int as version`;
    if (version!.version < 180000 || version!.version >= 190000)
      throw new Error('PostgreSQL 18 required');
    const [migrations] =
      await client`select count(*)::int as count from drizzle.__drizzle_migrations`;
    if (migrations!.count !== 31) throw new Error('Apply canonical migrations 0000–0030 first');
    const [existing] = await client`select 1 from app.tenants where id=${ids.tenant}`;
    if (existing)
      throw new Error('Fixture already exists: use a fresh database for a new rehearsal');
    await seedOwnerWorkflow(client);
    await seedSecondNozzle(client);
    // The manual rehearsal starts through real password sign-in, not fixture sessions.
    await client`delete from auth.session where id in (${ids.supervisorSession},${ids.managerSession})`;
    await client`update app.shifts set planned_start_at=now()-interval '5 minutes',planned_end_at=now()+interval '15 minutes' where id=${ids.a11RetryShift}`;
    console.log(
      `Synthetic station ready: /operations/daily?tenantId=${ids.tenant}&stationId=${ids.station}&businessDayId=${ids.day}&shiftId=${ids.a11RetryShift}`,
    );
    console.log(
      'Use the synthetic rehearsal credentials documented in docs/runbooks/OWNER_WORKFLOW_LOCAL_REHEARSAL.md.',
    );
  } finally {
    await client.end();
  }
}
void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Local seed failed');
  process.exitCode = 1;
});
