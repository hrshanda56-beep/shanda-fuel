import 'server-only';

import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { withTenantTransaction } from '../../platform/db/transaction';
import { AppError } from '../../platform/errors';
import { authorize } from '../../platform/security/permissions';
import { resolveForecourtCommandContext } from './application';
import { loadForecourtStation } from './persistence';
import { buildDailyReport, type DailyReport, type DailyReportInput } from './daily-report-model';

export const dailyReportQuery = z.object({
  tenantId: z.string().uuid(),
  stationId: z.string().uuid(),
  reconciliationId: z.string().uuid(),
});

const countedStates = ['APPROVED', 'POSTED', 'LOCKED'];
const takenDropStates = ['SUBMITTED', 'ACCEPTED', 'RESOLVED'];

const iso = (value: Date | string | null): string | null =>
  value === null ? null : new Date(value).toISOString();

/**
 * One shift's report in the layout attendants send on WhatsApp. It only reads: every figure comes
 * from the reconciliation the supervisor already saved, so it cannot disagree with it.
 */
export async function getDailyReportFromRequest(
  request: Request,
  input: z.infer<typeof dailyReportQuery>,
): Promise<DailyReport> {
  const context = await resolveForecourtCommandContext({
    request,
    requestedTenantId: input.tenantId,
    stationId: input.stationId,
    loadStation: loadForecourtStation,
  });
  authorize({
    actor: context.authority.authorization,
    permissionCode: 'reconciliation.view',
    requestedScope: context.scope,
  });
  const { tenantId, stationId } = context;
  const reconciliationId = input.reconciliationId;

  return withTenantTransaction(context.authority.transaction, async (transaction) => {
    const headers = await transaction.execute<{
      state: string;
      businessDate: string;
      supervisorId: string | null;
      stationName: string;
      timezone: string;
      startAt: Date | string | null;
      endAt: Date | string | null;
    }>(sql`
      select c.state, d.business_date as "businessDate", c.supervisor_id as "supervisorId",
             st.name as "stationName", st.timezone,
             s.planned_start_at as "startAt", s.planned_end_at as "endAt"
      from app.reconciliations c
      join app.station_business_days d
        on d.tenant_id = c.tenant_id and d.station_id = c.station_id and d.id = c.business_day_id
      join app.stations st on st.tenant_id = c.tenant_id and st.id = c.station_id
      left join app.shifts s
        on s.tenant_id = c.tenant_id and s.station_id = c.station_id and s.id = c.shift_id
      where c.tenant_id = ${tenantId} and c.station_id = ${stationId} and c.id = ${reconciliationId}
    `);
    const header = headers[0];
    if (!header) throw new AppError('NOT_FOUND', 'Reconciliation was not found');
    const monthStart = `${header.businessDate.slice(0, 7)}-01`;

    const [people, readings, expenses, dips, cash, drops, mtdProducts, mtdExpenses] =
      await Promise.all([
        transaction.execute<{ id: string; name: string; role: 'SUPERVISOR' | 'ATTENDANT' }>(sql`
          select m.id, u.name, 'ATTENDANT' as role
          from app.reconciliation_attendants a
          join app.memberships m on m.tenant_id = a.tenant_id and m.id = a.attendant_id
          join app.users u on u.id = m.identity_id
          where a.tenant_id = ${tenantId} and a.station_id = ${stationId}
            and a.reconciliation_id = ${reconciliationId}
          union all
          select m.id, u.name, 'SUPERVISOR' as role
          from app.memberships m
          join app.users u on u.id = m.identity_id
          where m.tenant_id = ${tenantId} and m.id = ${header.supervisorId}
          order by name
        `),
        transaction.execute<DailyReportInput['readings'][number]>(sql`
          select p.number as "pumpNumber", n.number as "nozzleNumber",
                 r.product_id as "productId", pr.name as "productName",
                 r.opening_reading::text as "openingReading", r.closing_reading::text as "closingReading",
                 r.litres_sold::text as "litresSold", r.unit_price::text as "unitPrice",
                 r.sales_value::text as "salesValue"
          from app.reconciliation_meter_readings r
          join app.nozzles n on n.tenant_id = r.tenant_id and n.station_id = r.station_id and n.id = r.nozzle_id
          join app.pumps p on p.tenant_id = n.tenant_id and p.station_id = n.station_id and p.id = n.pump_id
          join app.products pr on pr.tenant_id = r.tenant_id and pr.id = r.product_id
          where r.tenant_id = ${tenantId} and r.station_id = ${stationId}
            and r.reconciliation_id = ${reconciliationId}
        `),
        transaction.execute<DailyReportInput['expenses'][number]>(sql`
          select category, description, amount::text as amount, payment_method as "paymentMethod"
          from app.reconciliation_expenses
          where tenant_id = ${tenantId} and station_id = ${stationId}
            and reconciliation_id = ${reconciliationId}
          order by id
        `),
        transaction.execute<
          Omit<DailyReportInput['dips'][number], 'measuredAt'> & { measuredAt: Date | string }
        >(sql`
          select t.code as "tankCode", pr.name as "productName", d.measured_at as "measuredAt",
                 d.raw_measurement::text as "rawMeasurement", d.measurement_unit as "measurementUnit",
                 d.physical_litres::text as "physicalLitres"
          from app.reconciliation_dip_refs r
          join app.tank_dips d on d.tenant_id = r.tenant_id and d.station_id = r.station_id and d.id = r.dip_id and d.voided_at is null
          join app.tanks t on t.tenant_id = d.tenant_id and t.station_id = d.station_id and t.id = d.tank_id
          join app.products pr on pr.tenant_id = t.tenant_id and pr.id = t.product_id
          where r.tenant_id = ${tenantId} and r.station_id = ${stationId}
            and r.reconciliation_id = ${reconciliationId}
        `),
        transaction.execute<NonNullable<DailyReportInput['cash']>>(sql`
          select counted_cash::text as "countedCash", net_expected_cash::text as "netExpectedCash",
                 cash_variance::text as "cashVariance"
          from app.reconciliation_cash_declarations
          where tenant_id = ${tenantId} and station_id = ${stationId}
            and reconciliation_id = ${reconciliationId}
        `),
        // Handovers are not tied to a shift, so a drop is every cash handover submitted on the
        // station's own calendar day.
        transaction.execute<DailyReportInput['drops'][number]>(sql`
          select l.name as "toLocation", coalesce(h.counted_amount, h.expected_amount)::text as amount,
                 h.state
          from app.cash_handovers h
          join app.cash_locations l
            on l.tenant_id = h.tenant_id and l.station_id = h.station_id and l.id = h.to_location_id
          where h.tenant_id = ${tenantId} and h.station_id = ${stationId}
            and h.state in (${sql.join(
              takenDropStates.map((state) => sql`${state}`),
              sql`, `,
            )})
            and ((h.submitted_at at time zone ${header.timezone})::date)::text = ${header.businessDate}
          order by h.submitted_at, h.id
        `),
        transaction.execute<{
          productName: string;
          litres: string;
          sales: string;
          shifts: number | string;
        }>(sql`
          select pr.name as "productName", sum(r.litres_sold)::text as litres,
                 sum(r.sales_value)::text as sales, count(distinct c.id) as shifts
          from app.reconciliations c
          join app.station_business_days d
            on d.tenant_id = c.tenant_id and d.station_id = c.station_id and d.id = c.business_day_id
          join app.reconciliation_meter_readings r
            on r.tenant_id = c.tenant_id and r.station_id = c.station_id and r.reconciliation_id = c.id
          join app.products pr on pr.tenant_id = r.tenant_id and pr.id = r.product_id
          where c.tenant_id = ${tenantId} and c.station_id = ${stationId}
            and d.business_date between ${monthStart} and ${header.businessDate}
            and (c.id = ${reconciliationId} or c.state in (${sql.join(
              countedStates.map((state) => sql`${state}`),
              sql`, `,
            )}))
          group by pr.name
          order by pr.name
        `),
        transaction.execute<{ total: string | null }>(sql`
          select sum(e.amount)::text as total
          from app.reconciliations c
          join app.station_business_days d
            on d.tenant_id = c.tenant_id and d.station_id = c.station_id and d.id = c.business_day_id
          join app.reconciliation_expenses e
            on e.tenant_id = c.tenant_id and e.station_id = c.station_id and e.reconciliation_id = c.id
          where c.tenant_id = ${tenantId} and c.station_id = ${stationId}
            and d.business_date between ${monthStart} and ${header.businessDate}
            and (c.id = ${reconciliationId} or c.state in (${sql.join(
              countedStates.map((state) => sql`${state}`),
              sql`, `,
            )}))
        `),
      ]);

    return buildDailyReport({
      stationName: header.stationName,
      timezone: header.timezone,
      businessDate: header.businessDate,
      state: header.state,
      shiftStartAt: iso(header.startAt),
      shiftEndAt: iso(header.endAt),
      supervisorName: people.find((person) => person.role === 'SUPERVISOR')?.name ?? null,
      attendantNames: people.filter((person) => person.role === 'ATTENDANT').map((p) => p.name),
      readings,
      expenses,
      dips: dips.map((dip) => ({ ...dip, measuredAt: iso(dip.measuredAt)! })),
      cash: cash[0] ?? null,
      drops,
      monthToDate: {
        fromDate: monthStart,
        products: mtdProducts.map(({ productName, litres, sales }) => ({
          productName,
          litres,
          sales,
        })),
        expenses: mtdExpenses[0]?.total ?? '0',
        shifts: mtdProducts.reduce((max, row) => Math.max(max, Number(row.shifts)), 0),
      },
    });
  });
}
