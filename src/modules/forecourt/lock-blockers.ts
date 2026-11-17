import 'server-only';

import { sql, type SQL } from 'drizzle-orm';
import { describeLockBlockers, type LockBlockerCounts } from './lock-readiness';

type Executor = { execute(query: SQL): PromiseLike<readonly Record<string, unknown>[]> };

/**
 * What stops one business day from being locked: reports still draft, waiting or sent back, and
 * active tanks with no dip reading on the day's date. The lock command refuses with this sentence
 * and the control room shows it beside the disabled button, from this one query.
 */
export async function readLockBlockers(
  transaction: Executor,
  scope: { tenantId: string; stationId: string; businessDayId: string },
): Promise<{ counts: LockBlockerCounts; reason: string | null }> {
  const [row] = (await transaction.execute(sql`
    select
      (select count(*) from app.reconciliations r
        where r.tenant_id = ${scope.tenantId} and r.station_id = ${scope.stationId}
          and r.business_day_id = ${scope.businessDayId} and r.shift_id is not null
          and r.state = 'DRAFT')::int as draft,
      (select count(*) from app.reconciliations r
        where r.tenant_id = ${scope.tenantId} and r.station_id = ${scope.stationId}
          and r.business_day_id = ${scope.businessDayId} and r.shift_id is not null
          and r.state = 'SUBMITTED')::int as submitted,
      (select count(*) from app.reconciliations r
        where r.tenant_id = ${scope.tenantId} and r.station_id = ${scope.stationId}
          and r.business_day_id = ${scope.businessDayId} and r.shift_id is not null
          and r.state = 'RETURNED')::int as returned,
      (select count(*) from app.tanks t
        join app.station_business_days bd
          on bd.tenant_id = t.tenant_id and bd.station_id = t.station_id
         and bd.id = ${scope.businessDayId}
        where t.tenant_id = ${scope.tenantId} and t.station_id = ${scope.stationId}
          and t.status = 'ACTIVE'
          and not exists (
            select 1 from app.tank_dips d
            where d.tenant_id = t.tenant_id and d.station_id = t.station_id
              and d.tank_id = t.id and d.business_date = bd.business_date
              and d.voided_at is null
          ))::int as tanks_without_dip
  `)) as unknown as {
    draft: number;
    submitted: number;
    returned: number;
    tanks_without_dip: number;
  }[];
  const counts: LockBlockerCounts = {
    draft: Number(row?.draft ?? 0),
    submitted: Number(row?.submitted ?? 0),
    returned: Number(row?.returned ?? 0),
    tanksWithoutDip: Number(row?.tanks_without_dip ?? 0),
  };
  return { counts, reason: describeLockBlockers(counts) };
}
