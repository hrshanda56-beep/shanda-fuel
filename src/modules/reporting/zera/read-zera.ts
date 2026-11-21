import 'server-only';

import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { AppError } from '../../../platform/errors';
import { withTenantTransaction } from '../../../platform/db/transaction';
import { createTrustedTenantTransactionContext } from '../../../platform/db/tenant-context';
import { authorizeManagementReportRequest } from '../queries';
import {
  ZERA_OWNERSHIPS,
  ZERA_PROVINCES,
  missingLicenceDetails,
  type StationZeraDetails,
} from './zera-licence';
import {
  buildZeraReturn,
  findMissingMonthDays,
  type ZeraMovementRow,
  type ZeraProductKind,
  type ZeraReturn,
} from './zera-return';

export const zeraQuerySchema = z.object({
  tenantId: z.string().uuid(),
  stationId: z.string().uuid(),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Choose a month.'),
  /** Picked in the wizard when more than one blend is in use, or none is on record. */
  ethanolPercent: z.coerce
    .number()
    .int()
    .refine((n) => [0, 5, 10, 15, 20].includes(n))
    .optional(),
});

export type ZeraReturnView = Readonly<{
  tenantId: string;
  stationId: string;
  stationName: string;
  /** Needed to save licence details through the station command, which restates both. */
  stationTimezone: string;
  month: string;
  /** Last day of the month, for the form's "period" line. */
  periodEnd: string;
  details: StationZeraDetails;
  missingDetails: readonly string[];
  result: ZeraReturn;
}>;

const KINDS = new Set(['DIESEL', 'D50', 'PETROL', 'BLEND', 'GAS', 'OTHER']);

type MovementDbRow = {
  product_id: string;
  product_name: string;
  kind: string | null;
  blend_percent: number | null;
  unit: string;
  quantity: string;
};

function toMovement(row: MovementDbRow): ZeraMovementRow {
  return {
    productId: row.product_id,
    productName: row.product_name,
    kind: row.kind && KINDS.has(row.kind) ? (row.kind as ZeraProductKind) : null,
    blendPercent: row.blend_percent,
    unit: row.unit === 'KILOGRAMS' ? 'KILOGRAMS' : 'LITRES',
    quantity: row.quantity,
  };
}

/** The station-local calendar date today (never the browser's). */
export function stationToday(timezone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function monthBounds(month: string): { from: string; to: string } {
  const [year, mon] = month.split('-').map(Number);
  const last = new Date(Date.UTC(year!, mon!, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

/**
 * One station's ZERA figures for one month. Reading needs the same permission as the operational
 * reports; the station and month are checked, never trusted. Supplied litres are confirmed
 * deliveries by the station's business date; sold litres are meter litres on approved days.
 */
export async function readZeraReturnFromRequest(
  request: Request,
  input: unknown,
): Promise<ZeraReturnView> {
  const parsed = zeraQuerySchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError(
      'VALIDATION_FAILED',
      parsed.error.issues[0]?.message ?? 'Choose a station and month.',
    );
  }
  const query = parsed.data;
  const { from, to } = monthBounds(query.month);
  const { authority, stations } = await authorizeManagementReportRequest(
    request,
    {
      tenantId: query.tenantId,
      stationIds: query.stationId,
      fromDate: from,
      toDate: to,
    },
    'report.view',
  );
  const station = stations.find((candidate) => candidate.id === query.stationId);
  if (!station || stations.length !== 1) {
    throw new AppError('NOT_FOUND', 'That station was not found.');
  }
  const context = createTrustedTenantTransactionContext({
    ...authority.transaction,
    legalEntityId: station.legalEntityId,
    stationId: station.id,
  });

  return withTenantTransaction(context, (transaction) => loadZeraView(transaction, query));
}

type ZeraQuery = z.infer<typeof zeraQuerySchema>;
type ZeraTransaction = Parameters<Parameters<typeof withTenantTransaction>[1]>[0];

/** Reads one station's figures inside a transaction already scoped to that station. */
export async function loadZeraView(
  transaction: ZeraTransaction,
  query: ZeraQuery,
): Promise<ZeraReturnView> {
  const { from, to } = monthBounds(query.month);
  {
    const [stationRow] = await transaction.execute<{
      name: string;
      timezone: string;
      licence_number: string | null;
      licence_holder: string | null;
      ownership: string | null;
      province: string | null;
      representative_name: string | null;
      representative_phone: string | null;
      representative_email: string | null;
    }>(sql`
      select name, timezone, zera_licence_number as licence_number,
        zera_licence_holder as licence_holder, zera_ownership as ownership,
        zera_province as province, zera_representative_name as representative_name,
        zera_representative_phone as representative_phone,
        zera_representative_email as representative_email
      from app.stations
      where tenant_id = ${query.tenantId} and id = ${query.stationId}
    `);
    if (!stationRow) throw new AppError('NOT_FOUND', 'That station was not found.');

    const suppliedRows = await transaction.execute<MovementDbRow>(sql`
      select p.id::text as product_id, p.name as product_name, p.kind, p.blend_percent,
        p.unit, sum(d.actual_quantity_litres)::text as quantity
      from app.fuel_deliveries d
      join app.products p on p.tenant_id = d.tenant_id and p.id = d.product_id
      where d.tenant_id = ${query.tenantId} and d.station_id = ${query.stationId}
        and d.status = 'CONFIRMED'
        and d.business_date between ${from} and ${to}
      group by p.id, p.name, p.kind, p.blend_percent, p.unit
    `);

    const soldRows = await transaction.execute<MovementDbRow>(sql`
      select p.id::text as product_id, p.name as product_name, p.kind, p.blend_percent,
        p.unit, sum(mr.litres_sold)::text as quantity
      from app.reconciliation_meter_readings mr
      join app.reconciliations r
        on r.tenant_id = mr.tenant_id and r.station_id = mr.station_id and r.id = mr.reconciliation_id
      join app.station_business_days bd
        on bd.tenant_id = r.tenant_id and bd.station_id = r.station_id and bd.id = r.business_day_id
      join app.products p on p.tenant_id = mr.tenant_id and p.id = mr.product_id
      where r.tenant_id = ${query.tenantId} and r.station_id = ${query.stationId}
        and r.state in ('APPROVED', 'POSTED', 'LOCKED')
        and bd.business_date between ${from} and ${to}
      group by p.id, p.name, p.kind, p.blend_percent, p.unit
    `);

    const approvedDays = await transaction.execute<{ business_date: string }>(sql`
      select distinct bd.business_date::text as business_date
      from app.reconciliations r
      join app.station_business_days bd
        on bd.tenant_id = r.tenant_id and bd.station_id = r.station_id and bd.id = r.business_day_id
      where r.tenant_id = ${query.tenantId} and r.station_id = ${query.stationId}
        and r.state in ('APPROVED', 'POSTED', 'LOCKED')
        and bd.business_date between ${from} and ${to}
    `);

    const [first] = await transaction.execute<{ first_date: string | null }>(sql`
      select min(business_date)::text as first_date
      from app.station_business_days
      where tenant_id = ${query.tenantId} and station_id = ${query.stationId}
    `);

    const missingDays = findMissingMonthDays({
      month: query.month,
      today: stationToday(stationRow.timezone),
      firstBusinessDate: first?.first_date ?? null,
      approvedDates: approvedDays.map((day) => day.business_date),
    });

    const details: StationZeraDetails = {
      licenceNumber: stationRow.licence_number,
      licenceHolder: stationRow.licence_holder,
      ownership: (ZERA_OWNERSHIPS as readonly string[]).includes(stationRow.ownership ?? '')
        ? (stationRow.ownership as StationZeraDetails['ownership'])
        : null,
      province: (ZERA_PROVINCES as readonly string[]).includes(stationRow.province ?? '')
        ? (stationRow.province as StationZeraDetails['province'])
        : null,
      representativeName: stationRow.representative_name,
      representativePhone: stationRow.representative_phone,
      representativeEmail: stationRow.representative_email,
    };

    return {
      tenantId: query.tenantId,
      stationId: query.stationId,
      stationName: stationRow.name,
      stationTimezone: stationRow.timezone,
      month: query.month,
      periodEnd: to,
      details,
      missingDetails: missingLicenceDetails(details),
      result: buildZeraReturn({
        supplied: suppliedRows.map(toMovement),
        sold: soldRows.map(toMovement),
        missingDays,
        chosenEthanolPercent: query.ethanolPercent ?? null,
      }),
    };
  }
}
