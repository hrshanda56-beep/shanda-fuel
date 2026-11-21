import 'server-only';

import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getAuditSigningKey } from '../../../platform/config/env';
import { appendSecurityEvent } from '../../audit/contracts';
import { REPORT_EVENT_CODES, buildReportEventMetadata } from '../activity';
import { AppError } from '../../../platform/errors';
import { assertStepUp } from '../../../platform/security';
import { withTenantTransaction } from '../../../platform/db/transaction';
import { createTrustedTenantTransactionContext } from '../../../platform/db/tenant-context';
import {
  executeInventoryCommand,
  requestHash,
  resolveInventoryCommandContext,
} from '../../inventory/application';
import { authorizeManagementReportRequest } from '../queries';
import { loadZeraView, stationToday, zeraQuerySchema } from './read-zera';
import { ZERA_OWNERSHIPS, ZERA_PROVINCES } from './zera-licence';
import { checkLicenceDetails, zeraAnswers } from './zera-wizard-checks';

const text = (max: number) => z.string().trim().min(1).max(max);

const saveSchema = zeraQuerySchema.extend({
  details: z.object({
    licenceHolder: text(240),
    licenceNumber: text(60),
    ownership: z.enum(ZERA_OWNERSHIPS),
    province: z.enum(ZERA_PROVINCES),
    representativeName: text(160),
    representativePhone: z.string().trim().min(5).max(40),
    representativeEmail: z.string().trim().min(3).max(254),
  }),
  /** What the person typed in the notes step. */
  notes: z.string().trim().max(500).default(''),
});

export type SavedZeraReturn = Readonly<{
  id: string;
  version: number;
  month: string;
  answers: readonly { label: string; value: string }[];
}>;

function requireIdempotency(request: Request): string {
  const key = request.headers.get('idempotency-key')?.trim() ?? '';
  if (!key) throw new AppError('VALIDATION_FAILED', 'Idempotency-Key is required');
  return key;
}

/**
 * Keeps the licence details on the station and saves the return as a new version. Figures are worked
 * out again here, in the same transaction, from the database: nothing the browser sends for the
 * figures is trusted. Needs the same permission as viewing the report, at this station.
 */
export async function saveZeraReturnFromRequest(
  request: Request,
  input: unknown,
): Promise<SavedZeraReturn> {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) {
    throw new AppError(
      'VALIDATION_FAILED',
      parsed.error.issues[0]?.message ?? 'Check the licence details and try again.',
    );
  }
  const payload = parsed.data;
  const problems = checkLicenceDetails(payload.details);
  const firstProblem = Object.values(problems)[0];
  if (firstProblem) throw new AppError('VALIDATION_FAILED', firstProblem);
  const key = requireIdempotency(request);
  const context = await resolveInventoryCommandContext({
    request,
    requestedTenantId: payload.tenantId,
    stationId: payload.stationId,
  });

  return executeInventoryCommand({
    context,
    commandType: 'SaveZeraReturn',
    permissionCode: 'report.view',
    idempotencyKey: key,
    requestHash: requestHash(payload),
    audit: {
      actionCode: 'REPORT.ZERA_RETURN_SAVED',
      subjectType: 'Station',
      subjectId: payload.stationId,
      metadata: { month: payload.month },
    },
    execute: async (transaction) => {
      const d = payload.details;
      await transaction.execute(sql`
        update app.stations
        set zera_licence_number = ${d.licenceNumber}, zera_licence_holder = ${d.licenceHolder},
            zera_ownership = ${d.ownership}, zera_province = ${d.province},
            zera_representative_name = ${d.representativeName},
            zera_representative_phone = ${d.representativePhone},
            zera_representative_email = ${d.representativeEmail}, updated_at = now()
        where tenant_id = ${payload.tenantId} and id = ${payload.stationId}
      `);
      const view = await loadZeraView(transaction, payload);
      // A return is for a month that has finished; the figures of a running month are not final.
      if (payload.month >= stationToday(view.stationTimezone).slice(0, 7)) {
        throw new AppError(
          'VALIDATION_FAILED',
          'That month has not finished yet. Save the return once the month is over.',
        );
      }
      if (view.result.blockers.length > 0) {
        throw new AppError(
          'VALIDATION_FAILED',
          'Some products have no fuel type, so the return cannot be saved yet.',
        );
      }
      const petrolInUse = view.result.petrol.supplied !== '0' || view.result.petrol.sold !== '0';
      if (petrolInUse && view.result.ethanolPercent === null) {
        throw new AppError('VALIDATION_FAILED', 'Choose the ethanol percentage.');
      }
      const answers = zeraAnswers({
        month: payload.month,
        details: view.details,
        ethanolPercent: view.result.ethanolPercent,
        result: view.result,
        extraNotes: payload.notes,
      });
      // Two saves for the same station and month at once must take turns, so each gets its own
      // version number instead of one failing on the unique version.
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`zera:${payload.stationId}:${payload.month}`}, 0))`,
      );
      const [next] = await transaction.execute<{ version: number }>(sql`
        select coalesce(max(version), 0)::int + 1 as version
        from app.zera_returns
        where tenant_id = ${payload.tenantId} and station_id = ${payload.stationId}
          and month = ${payload.month}
      `);
      const version = next?.version ?? 1;
      const [row] = await transaction.execute<{ id: string }>(sql`
        insert into app.zera_returns
          (tenant_id, station_id, month, version, answers, figures, created_by)
        values (${payload.tenantId}, ${payload.stationId}, ${payload.month}, ${version},
          ${JSON.stringify(answers)}::jsonb, ${JSON.stringify(view.result)}::jsonb,
          ${context.authority.membership.membershipId})
        returning id::text as id
      `);
      return { id: row!.id, version, month: payload.month, answers };
    },
  });
}

const listSchema = z.object({
  tenantId: z.string().uuid(),
  stationId: z.string().uuid(),
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional(),
  version: z.coerce.number().int().min(1).optional(),
});

export type SavedZeraSummary = Readonly<{
  id: string;
  month: string;
  version: number;
  savedAt: string;
}>;

async function authorizeStationRead(request: Request, tenantId: string, stationId: string) {
  const { authority, stations } = await authorizeManagementReportRequest(
    request,
    { tenantId, stationIds: stationId, fromDate: '2000-01-01', toDate: '2000-01-31' },
    'report.view',
  );
  const station = stations.find((candidate) => candidate.id === stationId);
  if (!station || stations.length !== 1) {
    throw new AppError('NOT_FOUND', 'That station was not found.');
  }
  return { authority, station };
}

/** The returns already saved for a station, newest first. Same permission as viewing the report. */
export async function listZeraReturnsFromRequest(
  request: Request,
  input: unknown,
): Promise<SavedZeraSummary[]> {
  const parsed = listSchema.safeParse(input);
  if (!parsed.success) throw new AppError('VALIDATION_FAILED', 'Choose a station.');
  const query = parsed.data;
  const { authority, station } = await authorizeStationRead(
    request,
    query.tenantId,
    query.stationId,
  );
  const context = createTrustedTenantTransactionContext({
    ...authority.transaction,
    legalEntityId: station.legalEntityId,
    stationId: station.id,
  });
  return withTenantTransaction(context, async (transaction) => {
    const rows = await transaction.execute<{
      id: string;
      month: string;
      version: number;
      saved_at: string;
    }>(sql`
      select id::text as id, month, version, created_at::text as saved_at
      from app.zera_returns
      where tenant_id = ${query.tenantId} and station_id = ${query.stationId}
      order by month desc, version desc
      limit 60
    `);
    return rows.map((row) => ({
      id: row.id,
      month: row.month,
      version: row.version,
      savedAt: row.saved_at,
    }));
  });
}

/**
 * One saved return's answers, for the download. Taking data out needs a fresh identity check, and
 * the download is written to the signed audit log in the same transaction as the read.
 */
export async function readSavedZeraReturnFromRequest(
  request: Request,
  input: unknown,
  format: 'csv' | 'pdf',
): Promise<{ month: string; version: number; answers: { label: string; value: string }[] }> {
  const parsed = listSchema.safeParse(input);
  if (!parsed.success || !parsed.data.month) {
    throw new AppError('VALIDATION_FAILED', 'Choose a month.');
  }
  const query = parsed.data;
  const { authority, station } = await authorizeStationRead(
    request,
    query.tenantId,
    query.stationId,
  );
  assertStepUp(authority.actor.session, 1, new Date(), query.tenantId);
  const context = createTrustedTenantTransactionContext({
    ...authority.transaction,
    legalEntityId: station.legalEntityId,
    stationId: station.id,
  });
  return withTenantTransaction(context, async (transaction) => {
    const [row] = await transaction.execute<{
      month: string;
      version: number;
      answers: { label: string; value: string }[];
    }>(sql`
      select month, version, answers
      from app.zera_returns
      where tenant_id = ${query.tenantId} and station_id = ${query.stationId}
        and month = ${query.month}
        ${query.version ? sql`and version = ${query.version}` : sql``}
      order by version desc
      limit 1
    `);
    if (!row) throw new AppError('NOT_FOUND', 'That return has not been saved.');
    const [named] = await transaction.execute<{ name: string }>(sql`
      select name from app.stations where tenant_id = ${query.tenantId} and id = ${query.stationId}
    `);
    await appendSecurityEvent(
      {
        eventId: randomUUID(),
        tenantId: query.tenantId,
        membershipId: authority.authorization.membershipId,
        actorId: authority.authorization.userId,
        actorType: 'HUMAN',
        actionCode: REPORT_EVENT_CODES.EXPORTED,
        subjectType: 'REPORT',
        subjectId: 'zera-return',
        requestId: authority.transaction.requestId ?? randomUUID(),
        occurredAt: new Date().toISOString(),
        metadata: buildReportEventMetadata({
          slug: 'zera-return',
          period: row.month,
          fromDate: `${row.month}-01`,
          toDate: `${row.month}-01`,
          stationNames: named ? [named.name] : [],
          exportFormat: format,
        }),
      },
      getAuditSigningKey(),
      transaction,
    );
    return row;
  });
}
