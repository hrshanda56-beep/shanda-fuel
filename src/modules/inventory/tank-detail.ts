import 'server-only';

import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { AppError } from '../../platform/errors';
import { isPermissionGranted } from '../../platform/security/permissions';
import { classifyStockVariance, type StockSignal } from '../approvals/operations-alerts';
import { withInventoryReadContext } from './application';

const scopeInput = z.object({
  tenantId: z.string().uuid(),
  stationId: z.string().uuid(),
  tankId: z.string().uuid(),
});

export type TankDip = Readonly<{
  id: string;
  measuredAt: string;
  businessDate: string;
  physicalLitres: string;
  rawMeasurement: string | null;
  measurementUnit: string | null;
  /** What the books said the tank held at the moment of the dip. */
  bookLitres: string;
  /** Measured less book: negative is short, positive is over. */
  varianceLitres: string;
  signal: StockSignal;
  notes: string | null;
}>;

export type TankMovement = Readonly<{
  id: string;
  effectiveAt: string;
  businessDate: string;
  movementType: string;
  quantityLitres: string;
  sourceType: string;
}>;

export type TankDetail = Readonly<{
  stationTimezone: string;
  canManage: boolean;
  tank: Readonly<{
    id: string;
    code: string;
    status: string;
    productId: string;
    productName: string;
    capacityLitres: string;
    reorderLevelLitres: string | null;
    /** Yellow: a difference above this must be explained. */
    yellowLitres: string | null;
    /** Red: a difference above this is urgent. Empty means twice the yellow one. */
    redLitres: string | null;
    bookLitres: string;
    hasChart: boolean;
  }>;
  /** The current dipstick chart: what each reading means in litres. Null until one is saved. */
  chart: Readonly<{
    unit: string;
    version: number;
    rows: readonly { measurement: string; litres: string }[];
  }> | null;
  dips: readonly TankDip[];
  movements: readonly TankMovement[];
}>;

/** One tank: its limits, the dips with how each compared with the books, and every stock movement. */
export async function queryTankDetail(input: {
  request: Request;
  tenantId: string;
  stationId: string;
  tankId: string;
}): Promise<TankDetail> {
  const parsed = scopeInput.parse(input);
  return withInventoryReadContext(
    input.request,
    parsed.tenantId,
    parsed.stationId,
    async (transaction, context) => {
      const tankRows = await transaction.execute<{
        id: string;
        code: string;
        status: string;
        product_id: string;
        product_name: string;
        capacity: string;
        reorder: string | null;
        yellow: string | null;
        red: string | null;
        book: string;
        has_chart: boolean;
      }>(sql`
        select t.id, t.code, t.status, t.product_id, p.name as product_name,
          t.capacity_litres::text as capacity, t.reorder_level_litres::text as reorder,
          t.acceptable_variance_litres::text as yellow, t.variance_red_litres::text as red,
          coalesce((select sum(m.quantity_litres) from app.inventory_movements m
            where m.tenant_id = t.tenant_id and m.station_id = t.station_id
              and m.tank_id = t.id and m.product_id = t.product_id), 0)::text as book,
          exists (select 1 from app.tank_calibration_points c
            where c.tenant_id = t.tenant_id and c.tank_id = t.id) as has_chart
        from app.tanks t
        join app.products p on p.tenant_id = t.tenant_id and p.id = t.product_id
        where t.tenant_id = ${context.tenantId} and t.station_id = ${context.stationId}
          and t.id = ${parsed.tankId}
      `);
      const tank = tankRows[0];
      if (!tank) throw new AppError('NOT_FOUND', 'That tank was not found at this station');
      const dips = await transaction.execute<{
        id: string;
        measured_at: Date | string;
        business_date: string;
        physical: string;
        raw: string | null;
        unit: string | null;
        book: string;
        variance: string;
        notes: string | null;
      }>(sql`
        select d.id, d.measured_at, d.business_date, d.physical_litres::text as physical,
          d.raw_measurement::text as raw, d.measurement_unit as unit,
          coalesce(b.book, 0)::text as book,
          (d.physical_litres - coalesce(b.book, 0))::text as variance, d.notes
        from app.tank_dips d
        left join lateral (
          select sum(m.quantity_litres) as book from app.inventory_movements m
          where m.tenant_id = d.tenant_id and m.station_id = d.station_id
            and m.tank_id = d.tank_id and m.effective_at <= d.measured_at
        ) b on true
        where d.tenant_id = ${context.tenantId} and d.station_id = ${context.stationId}
          and d.tank_id = ${parsed.tankId}
        order by d.measured_at desc, d.id desc
        limit 60
      `);
      const chartRows = await transaction.execute<{
        unit: string;
        version: number;
        measurement: string;
        litres: string;
      }>(sql`
        select c.measurement_unit as unit, c.chart_version as version,
          c.measurement_value::text as measurement, c.litres::text as litres
        from app.tank_calibration_points c
        where c.tenant_id = ${context.tenantId} and c.station_id = ${context.stationId}
          and c.tank_id = ${parsed.tankId}
          and c.chart_version = (
            select max(chart_version) from app.tank_calibration_points
            where tenant_id = ${context.tenantId} and tank_id = ${parsed.tankId})
        order by c.measurement_value
      `);
      const movements = await transaction.execute<{
        id: string;
        effective_at: Date | string;
        business_date: string;
        movement_type: string;
        quantity: string;
        source_type: string;
      }>(sql`
        select m.id, m.effective_at, m.business_date, m.movement_type,
          m.quantity_litres::text as quantity, m.source_type
        from app.inventory_movements m
        where m.tenant_id = ${context.tenantId} and m.station_id = ${context.stationId}
          and m.tank_id = ${parsed.tankId}
        order by m.effective_at desc, m.id desc
        limit 100
      `);
      return {
        stationTimezone: context.stationTimezone,
        canManage: isPermissionGranted({
          actor: context.authority.authorization,
          permissionCode: 'inventory.tank.manage',
          requestedScope: context.scope,
        }),
        tank: {
          id: tank.id,
          code: tank.code,
          status: tank.status,
          productId: tank.product_id,
          productName: tank.product_name,
          capacityLitres: tank.capacity,
          reorderLevelLitres: tank.reorder,
          yellowLitres: tank.yellow,
          redLitres: tank.red,
          bookLitres: tank.book,
          hasChart: tank.has_chart,
        },
        chart: chartRows[0]
          ? {
              unit: chartRows[0].unit,
              version: Number(chartRows[0].version),
              rows: chartRows.map((row) => ({ measurement: row.measurement, litres: row.litres })),
            }
          : null,
        dips: dips.map((row) => ({
          id: row.id,
          measuredAt: new Date(row.measured_at).toISOString(),
          businessDate: row.business_date,
          physicalLitres: row.physical,
          rawMeasurement: row.raw,
          measurementUnit: row.unit,
          bookLitres: row.book,
          varianceLitres: row.variance,
          signal: classifyStockVariance(row.variance, tank.yellow, tank.red),
          notes: row.notes,
        })),
        movements: movements.map((row) => ({
          id: row.id,
          effectiveAt: new Date(row.effective_at).toISOString(),
          businessDate: row.business_date,
          movementType: row.movement_type,
          quantityLitres: row.quantity,
          sourceType: row.source_type,
        })),
      };
    },
  );
}
