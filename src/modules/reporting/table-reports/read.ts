import 'server-only';

import { sql, type SQL } from 'drizzle-orm';
import type { Database } from '../../../platform/db';
import type { ManagementReportQuery } from '../contracts';
import type { TableReportRow } from './definitions';
import { TABLE_REPORT_ROW_LIMIT } from './definitions';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export type TableReportReader = (
  transaction: Transaction,
  filters: ManagementReportQuery,
) => Promise<TableReportRow[]>;

function stationClause(alias: string, stationIds: readonly string[]): SQL {
  if (stationIds.length === 0) return sql``;
  const ids = sql.join(
    stationIds.map((id) => sql`${id}`),
    sql`, `,
  );
  return sql`and ${sql.raw(`${alias}.station_id`)} in (${ids})`;
}

const limit = sql.raw(String(TABLE_REPORT_ROW_LIMIT + 1));

const utc = (column: string) =>
  sql.raw(`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`);

export const readTankDipHistory: TableReportReader = async (transaction, filters) => {
  const rows = await transaction.execute<{
    business_date: string;
    measured_at: string;
    station: string;
    tank: string;
    product: string;
    physical_litres: string;
    notes: string | null;
  }>(sql`
    select d.business_date, ${utc('d.measured_at')} as measured_at, s.name as station,
      t.code as tank, p.name as product, d.physical_litres::text as physical_litres, d.notes
    from app.tank_dips d
    join app.stations s on s.tenant_id = d.tenant_id and s.id = d.station_id
    join app.tanks t on t.tenant_id = d.tenant_id and t.station_id = d.station_id and t.id = d.tank_id
    join app.products p on p.tenant_id = t.tenant_id and p.id = t.product_id
    where d.tenant_id = ${filters.tenantId}
      and d.business_date between ${filters.fromDate} and ${filters.toDate}
      ${stationClause('d', filters.stationIds)}
    order by d.business_date desc, d.measured_at desc, s.name, t.code
    limit ${limit}
  `);
  return rows.map((row) => ({
    businessDate: row.business_date,
    measuredAt: row.measured_at,
    station: row.station,
    tank: row.tank,
    product: row.product,
    physicalLitres: row.physical_litres,
    notes: row.notes,
  }));
};

const MOVEMENT_LABELS = sql.raw(`case m.movement_type
  when 'OPENING_BALANCE' then 'Opening stock'
  when 'DELIVERY' then 'Delivery received'
  when 'SALE' then 'Fuel sold'
  when 'APPROVED_ISSUE' then 'Approved fuel issued'
  when 'POSITIVE_ADJUSTMENT' then 'Stock added (adjustment)'
  when 'NEGATIVE_ADJUSTMENT' then 'Stock removed (adjustment)'
  when 'TRANSFER_IN' then 'Transferred in'
  when 'TRANSFER_OUT' then 'Transferred out'
  else m.movement_type end`);

export const readStockMovements: TableReportReader = async (transaction, filters) => {
  const rows = await transaction.execute<{
    business_date: string;
    effective_at: string;
    station: string;
    tank: string;
    product: string;
    movement_type: string;
    quantity_litres: string;
    reason: string | null;
  }>(sql`
    select m.business_date, ${utc('m.effective_at')} as effective_at, s.name as station,
      t.code as tank, p.name as product, ${MOVEMENT_LABELS} as movement_type,
      m.quantity_litres::text as quantity_litres, m.reason
    from app.inventory_movements m
    join app.stations s on s.tenant_id = m.tenant_id and s.id = m.station_id
    join app.tanks t on t.tenant_id = m.tenant_id and t.station_id = m.station_id and t.id = m.tank_id
    join app.products p on p.tenant_id = m.tenant_id and p.id = m.product_id
    where m.tenant_id = ${filters.tenantId}
      and m.business_date between ${filters.fromDate} and ${filters.toDate}
      ${stationClause('m', filters.stationIds)}
    order by m.business_date desc, m.effective_at desc, s.name, t.code, m.id
    limit ${limit}
  `);
  return rows.map((row) => ({
    businessDate: row.business_date,
    effectiveAt: row.effective_at,
    station: row.station,
    tank: row.tank,
    product: row.product,
    movementType: row.movement_type,
    quantityLitres: row.quantity_litres,
    reason: row.reason,
  }));
};

export const readDeliveryVariance: TableReportReader = async (transaction, filters) => {
  const rows = await transaction.execute<{
    business_date: string;
    station: string;
    product: string;
    delivery_note: string;
    supplier: string | null;
    note_litres: string;
    actual_litres: string;
    shortage_excess: string;
  }>(sql`
    select f.business_date, s.name as station, p.name as product,
      f.delivery_note_number as delivery_note, sup.legal_name as supplier,
      f.note_quantity_litres::text as note_litres, f.actual_quantity_litres::text as actual_litres,
      f.shortage_excess_litres::text as shortage_excess
    from app.fuel_deliveries f
    join app.stations s on s.tenant_id = f.tenant_id and s.id = f.station_id
    join app.products p on p.tenant_id = f.tenant_id and p.id = f.product_id
    left join app.suppliers sup on sup.tenant_id = f.tenant_id and sup.id = f.supplier_id
    where f.tenant_id = ${filters.tenantId} and f.status = 'CONFIRMED'
      and f.business_date between ${filters.fromDate} and ${filters.toDate}
      ${stationClause('f', filters.stationIds)}
    order by f.business_date desc, s.name, f.delivery_note_number
    limit ${limit}
  `);
  return rows.map((row) => ({
    businessDate: row.business_date,
    station: row.station,
    product: row.product,
    deliveryNote: row.delivery_note,
    supplier: row.supplier,
    noteLitres: row.note_litres,
    actualLitres: row.actual_litres,
    shortageExcessLitres: row.shortage_excess,
  }));
};

export const TABLE_REPORT_READERS: Readonly<Record<string, TableReportReader>> = {
  'tank-dip-history': readTankDipHistory,
  'stock-movements': readStockMovements,
  'delivery-variance': readDeliveryVariance,
};
