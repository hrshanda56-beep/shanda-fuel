import { sql, type SQL } from 'drizzle-orm';

/**
 * SQL pieces for reading tanks that share one cost pool (DEC-058).
 *
 * The tanks of one fuel at a station are one stock and one cost: a sale is not taken from a named
 * tank, so one tank can be empty while another holds the fuel. Each tank names the tank its pool is
 * kept on (`cost_pool_tank_id`). A tank on its own is its own pool, so every piece below gives the
 * answer it always did for a tank on its own.
 *
 * Every piece takes the alias of an `app.tanks` row in the query. The alias is code, never input.
 */

/** Which tanks of a pool count: those in use today (active), or all that are not retired. */
export type PoolInUse = 'ACTIVE' | 'NOT_RETIRED';

function inUseSql(alias: string, inUse: PoolInUse): string {
  return inUse === 'ACTIVE' ? `${alias}.status = 'ACTIVE'` : `${alias}.status <> 'RETIRED'`;
}

function assertAlias(alias: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(alias)) throw new Error('A table alias is required');
  return alias;
}

/** The ids of every tank in the pool of `alias`, the tank itself included. */
export function poolTankIdsSql(alias: string): SQL {
  const t = assertAlias(alias);
  return sql.raw(`(
    select pt.id from app.tanks pt
    where pt.tenant_id = ${t}.tenant_id and pt.station_id = ${t}.station_id
      and pt.cost_pool_tank_id = ${t}.cost_pool_tank_id
  )`);
}

/**
 * True for the one tank of a pool that stands for it in a list: the first tank that is still in use
 * (active, or any that is not retired). A pool of one tank is always represented by that tank.
 */
export function isPoolRepresentativeSql(alias: string, inUse: PoolInUse = 'ACTIVE'): SQL {
  const t = assertAlias(alias);
  const status = inUseSql('pf', inUse);
  return sql.raw(`${t}.id = (
    select pf.id from app.tanks pf
    where pf.tenant_id = ${t}.tenant_id and pf.station_id = ${t}.station_id
      and pf.cost_pool_tank_id = ${t}.cost_pool_tank_id and ${status}
    order by pf.created_at, pf.id
    limit 1
  )`);
}

/** The names of the pool's active tanks, joined for display ("T1 + T2"). A lone tank is its name. */
export function poolTankCodesSql(alias: string, inUse: PoolInUse = 'ACTIVE'): SQL {
  const t = assertAlias(alias);
  return sql.raw(`(
    select string_agg(pt.code, ' + ' order by pt.created_at, pt.id) from app.tanks pt
    where pt.tenant_id = ${t}.tenant_id and pt.station_id = ${t}.station_id
      and pt.cost_pool_tank_id = ${t}.cost_pool_tank_id and ${inUseSql('pt', inUse)}
  )`);
}

/**
 * A number of a tank column added up over the pool's active tanks, or nothing when any of them has
 * none (a limit that is missing on one tank is missing for the pool).
 */
export function poolSumSql(alias: string, column: string, inUse: PoolInUse = 'ACTIVE'): SQL {
  const t = assertAlias(alias);
  const c = assertAlias(column);
  return sql.raw(`(
    select case when count(pt.${c}) = count(*) then sum(pt.${c}) end from app.tanks pt
    where pt.tenant_id = ${t}.tenant_id and pt.station_id = ${t}.station_id
      and pt.cost_pool_tank_id = ${t}.cost_pool_tank_id and ${inUseSql('pt', inUse)}
  )`);
}
