import 'server-only';

import { sql, type SQL } from 'drizzle-orm';

type Executor = { execute(query: SQL): PromiseLike<readonly Record<string, unknown>[]> };

/** The sentence shown when the day's last shift is submitted without every tank measured. */
export function describeMissingDips(tankCodes: readonly string[]): string {
  const list = tankCodes.join(', ');
  return tankCodes.length === 1
    ? `Tank ${list} has no dip reading for this shift. Record a dip for it on the Tank dips step, then submit.`
    : `Tanks ${list} have no dip reading for this shift. Record a dip for each on the Tank dips step, then submit.`;
}

/**
 * The codes of active tanks with no dip linked to this shift's report, when this is the last
 * shift of its business day; an empty list for any other shift. The last shift is the template
 * shift that ends latest on the day (cancelled and not-operated shifts do not count). Shifts opened
 * without a template are ad-hoc records and are not held to this rule.
 */
export async function tanksMissingClosingDip(
  transaction: Executor,
  scope: { tenantId: string; stationId: string; reconciliationId: string },
): Promise<string[]> {
  const rows = (await transaction.execute(sql`
    with this_shift as (
      select s.id, s.business_day_id, s.planned_end_at
      from app.reconciliations r
      join app.shifts s on s.tenant_id = r.tenant_id and s.station_id = r.station_id
        and s.id = r.shift_id
      where r.tenant_id = ${scope.tenantId} and r.station_id = ${scope.stationId}
        and r.id = ${scope.reconciliationId} and s.shift_template_id is not null
    )
    select t.code
    from this_shift ts
    join app.tanks t on t.tenant_id = ${scope.tenantId} and t.station_id = ${scope.stationId}
      and t.status = 'ACTIVE'
    where not exists (
        select 1 from app.shifts later
        where later.tenant_id = ${scope.tenantId} and later.station_id = ${scope.stationId}
          and later.business_day_id = ts.business_day_id and later.id <> ts.id
          and later.shift_template_id is not null
          and later.state not in ('CANCELLED_BEFORE_START', 'NOT_OPERATED')
          and (later.planned_end_at > ts.planned_end_at
               or (later.planned_end_at = ts.planned_end_at and later.id > ts.id))
      )
      and not exists (
        select 1 from app.reconciliation_dip_refs ref
        join app.tank_dips d on d.tenant_id = ref.tenant_id and d.station_id = ref.station_id
          and d.id = ref.dip_id and d.voided_at is null
        where ref.tenant_id = ${scope.tenantId} and ref.station_id = ${scope.stationId}
          and ref.reconciliation_id = ${scope.reconciliationId} and ref.tank_id = t.id
      )
    order by t.code
  `)) as unknown as { code: string }[];
  return rows.map((row) => row.code);
}
