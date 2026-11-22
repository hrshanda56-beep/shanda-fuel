import 'server-only';

import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { withTenantTransaction } from '../../platform/db/transaction';
import { AppError } from '../../platform/errors';
import { authorize, isPermissionGranted } from '../../platform/security/permissions';
import { deriveBusinessDate } from '../../platform/domain/business-time';
import { createTrustedTenantTransactionContext } from '../../platform/db/tenant-context';
import { type AuthenticatedActorContext } from '../identity';
import { resolveStationReadAuthority } from '../context/read-authority';
import { createForecourtCommandContext } from './application';
import { loadForecourtStationInTransaction } from './persistence';
import { addDays, missingPastDays, PAST_DAY_WINDOW_DAYS } from './past-day-rules';

const uuid = z.string().uuid();

export const pastDaysQuery = z.object({ tenantId: uuid, stationId: uuid });

export type PastDaysData = {
  stationName: string;
  /** The station-local business date today. */
  today: string;
  goLiveDate: string | null;
  /** The station's IANA timezone, used to place a shift's start on the chosen day. */
  timezone: string;
  /** The station's active shifts, so the person can say which one they are recording. */
  shiftTemplates: { id: string; name: string; startTime: string | null; durationMinutes: number }[];
  /** The person may open a past day at all (supervisor and above). */
  canRecord: boolean;
  /** The person may go back the full window, not just a week (owner level). */
  canGoBack: boolean;
  /** Dates with no record yet, oldest first, within the person's reach. */
  missing: string[];
  /** Days already recorded late, newest first. */
  recorded: { id: string; date: string; state: string; version: number }[];
};

/** What the "Record a past day" screen needs: the gaps, the person's reach, and days already added. */
export async function getPastDaysFromRequest(
  request: Request,
  input: z.infer<typeof pastDaysQuery>,
  authenticatedActor?: AuthenticatedActorContext,
): Promise<PastDaysData> {
  const { authority, station: snapshotStation } = await resolveStationReadAuthority({
    request,
    tenantId: input.tenantId,
    stationId: input.stationId,
    ...(authenticatedActor ? { authenticatedActor } : {}),
  });
  const transactionContext = snapshotStation
    ? createTrustedTenantTransactionContext({
        ...authority.transaction,
        legalEntityId: snapshotStation.legalEntityId,
        stationId: snapshotStation.id,
      })
    : authority.transaction;
  return withTenantTransaction(transactionContext, async (transaction) => {
    const station =
      snapshotStation ??
      (await loadForecourtStationInTransaction(transaction, authority, input.stationId));
    if (!station) throw new AppError('NOT_FOUND', 'The requested station was not found');
    const context = createForecourtCommandContext({
      authority: {
        ...authority,
        transaction: createTrustedTenantTransactionContext({
          ...authority.transaction,
          legalEntityId: station.legalEntityId,
          stationId: station.id,
        }),
      },
      station,
    });
    authorize({
      actor: context.authority.authorization,
      permissionCode: 'business_day.view',
      requestedScope: context.scope,
    });
    const canRecord = isPermissionGranted({
      actor: context.authority.authorization,
      permissionCode: 'business_day.open',
      requestedScope: context.scope,
    });
    const canGoBack = isPermissionGranted({
      actor: context.authority.authorization,
      permissionCode: 'business_day.lock',
      requestedScope: context.scope,
    });

    const stationRows = await transaction.execute<{
      name: string;
      timezone: string;
      go_live_date: string | null;
      now: Date | string;
    }>(sql`
      select name, timezone, go_live_date, clock_timestamp() as now
      from app.stations
      where tenant_id = ${context.tenantId} and id = ${context.stationId}
    `);
    const row = stationRows[0];
    if (!row) throw new AppError('NOT_FOUND', 'The requested station was not found');
    const today = deriveBusinessDate(
      row.now instanceof Date ? row.now.toISOString() : new Date(row.now).toISOString(),
      row.timezone,
    );
    const since = addDays(today, -(PAST_DAY_WINDOW_DAYS + 1));
    const days = await transaction.execute<{
      id: string;
      date: string;
      state: string;
      version: number;
      entered_late: boolean;
    }>(sql`
      select id, business_date as date, state, version, entered_late
      from app.station_business_days
      where tenant_id = ${context.tenantId} and station_id = ${context.stationId}
        and business_date >= ${since}
      order by business_date desc
    `);
    const existingDates = new Set(days.map((day) => day.date));
    const templates = await transaction.execute<{
      id: string;
      name: string;
      startTime: string | null;
      durationMinutes: number;
    }>(sql`
      select t.id, t.name, t.start_time::text as "startTime", t.duration_minutes as "durationMinutes"
      from app.shift_templates t
      where t.tenant_id = ${context.tenantId} and t.station_id = ${context.stationId} and t.active
      order by t.start_time nulls last, t.code
    `);
    return {
      stationName: row.name,
      timezone: row.timezone,
      shiftTemplates: templates.map((t) => ({
        id: t.id,
        name: t.name,
        startTime: t.startTime,
        durationMinutes: Number(t.durationMinutes),
      })),
      today,
      goLiveDate: row.go_live_date ?? null,
      canRecord,
      canGoBack,
      missing: canRecord
        ? missingPastDays({
            today,
            goLiveDate: row.go_live_date ?? null,
            existingDates,
            canGoBeyondSupervisorWindow: canGoBack,
          })
        : [],
      recorded: days
        .filter((day) => day.entered_late)
        .map((day) => ({
          id: day.id,
          date: day.date,
          state: day.state,
          version: Number(day.version),
        })),
    };
  });
}
