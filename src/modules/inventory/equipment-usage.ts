import 'server-only';

import { sql, type SQL } from 'drizzle-orm';

/**
 * Whether a tank, nozzle or pump has ever been used (#315): anything recorded against it means it
 * is part of the station's history and can only be retired, never deleted. An unused one was set up
 * by mistake and may be deleted or, for a tank, moved to another fuel.
 *
 * These lists are every table that refers to the item through a foreign key (checked against the
 * migrated schema), less the item's own setup rows (a tank's calibration points; a nozzle's first
 * meter installation and meter), which are removed with it. The foreign keys are NO ACTION, so the
 * database refuses a delete these checks miss; the checks are here to give a plain answer first and
 * to tell the setup screens which items may show "Delete".
 *
 * Each helper takes the SQL alias of an `app.tanks` / `app.nozzles` / `app.pumps` row.
 */

const TANK_HISTORY = [
  'tank_dips',
  'fuel_delivery_allocations',
  'inventory_movements',
  'inventory_cost_events',
  'inventory_cost_revaluations',
  'inventory_cost_revaluation_lines',
  'inventory_cost_stream_state',
  'inventory_sale_cost_attributions',
  'sale_recognition_movements',
  'reconciliation_delivery_refs',
  'reconciliation_dip_refs',
  'opening_balance_lines',
] as const;

const NOZZLE_HISTORY = [
  'meter_boundaries',
  'meter_segments',
  'meter_exceptions',
  'reconciliation_meter_readings',
  'sale_recognition_movements',
] as const;

function alias(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Unsafe SQL alias: ${name}`);
  return name;
}

/** True when anything has been recorded against the tank. */
export function tankInUseSql(tankAlias: string): SQL {
  const t = alias(tankAlias);
  return sql.raw(
    `(${TANK_HISTORY.map(
      (table) =>
        `exists (select 1 from app.${table} h where h.tenant_id = ${t}.tenant_id and h.station_id = ${t}.station_id and h.tank_id = ${t}.id)`,
    ).join(' or ')})`,
  );
}

/**
 * True when anything has been recorded against the nozzle, or its meter has been replaced (a second
 * installation is itself history).
 */
export function nozzleInUseSql(nozzleAlias: string): SQL {
  const n = alias(nozzleAlias);
  const direct = NOZZLE_HISTORY.map(
    (table) =>
      `exists (select 1 from app.${table} h where h.tenant_id = ${n}.tenant_id and h.station_id = ${n}.station_id and h.nozzle_id = ${n}.id)`,
  );
  const replaced = `(select count(*) from app.meter_installations i where i.tenant_id = ${n}.tenant_id and i.station_id = ${n}.station_id and i.nozzle_id = ${n}.id) > 1`;
  const resolved = `exists (select 1 from app.meter_exception_resolutions r join app.meter_installations i on i.tenant_id = r.tenant_id and i.station_id = r.station_id and i.id = r.replacement_installation_id where i.tenant_id = ${n}.tenant_id and i.station_id = ${n}.station_id and i.nozzle_id = ${n}.id)`;
  return sql.raw(`(${[...direct, replaced, resolved].join(' or ')})`);
}

/** True when any nozzle on the pump, active or not, has been used. */
export function pumpInUseSql(pumpAlias: string): SQL {
  const p = alias(pumpAlias);
  return sql`exists (select 1 from app.nozzles pn where pn.tenant_id = ${sql.raw(p)}.tenant_id and pn.station_id = ${sql.raw(p)}.station_id and pn.pump_id = ${sql.raw(p)}.id and ${nozzleInUseSql('pn')})`;
}
