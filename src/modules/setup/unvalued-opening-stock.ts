import 'server-only';

import { sql, type SQL } from 'drizzle-orm';

type Executor = { execute(query: SQL): PromiseLike<readonly Record<string, unknown>[]> };

/** The sentence shown when a station is taken live with opening stock that has no cost. */
export function describeUnvaluedOpeningStock(tankCodes: readonly string[]): string {
  const list = tankCodes.join(', ');
  const subject = tankCodes.length === 1 ? `Tank ${list} has` : `Tanks ${list} have`;
  return `${subject} opening stock but no cost per litre. Enter the cost in Settings, under Opening balances, before this station goes live. Without it the stock cannot be valued and profit will be wrong.`;
}

/**
 * Active tanks at the station that hold an opening quantity but no opening cost. The same rule the
 * readiness page uses to call the stock "unvalued"; going live refuses to leave any behind (B3).
 */
export async function tanksWithUnvaluedOpeningStock(
  transaction: Executor,
  scope: { tenantId: string; stationId: string },
): Promise<string[]> {
  const rows = (await transaction.execute(sql`
    select t.code
    from app.tanks t
    where t.tenant_id = ${scope.tenantId} and t.station_id = ${scope.stationId}
      and t.status = 'ACTIVE'
      and exists (
        select 1 from app.inventory_movements m
         where m.tenant_id = t.tenant_id and m.station_id = t.station_id
           and m.tank_id = t.id and m.movement_type = 'OPENING_BALANCE'
      )
      and not exists (
        select 1 from app.inventory_cost_events e
         where e.tenant_id = t.tenant_id and e.station_id = t.station_id
           and e.tank_id = t.id and e.event_type = 'OPENING_COST'
      )
    order by t.code
  `)) as unknown as { code: string }[];
  return rows.map((row) => row.code);
}
