import 'server-only';

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { getAuditSigningKey } from '../../platform/config/env';
import { AppError } from '../../platform/errors';
import { withTenantTransaction } from '../../platform/db/transaction';
import { isPermissionGranted } from '../../platform/security/permissions';
import { appendSecurityEvent } from '../audit/contracts';
import { resolveTenantExecutionContext } from '../tenancy/authority';
import {
  REPORT_EVENT_CODES,
  buildReportEventMetadata,
  toActivityItem,
  type ReportActivityItem,
  type ReportEventKind,
} from './activity';
import { findReport } from './catalog';
import { authorizeManagementReportRequest } from './queries';

/**
 * Records that the signed-in user shared or exported a report, in the existing
 * signed audit log. The same authorisation as viewing runs first, so an event is
 * never written for something the user could not open. Fails closed: if the
 * audit entry cannot be written, the action does not go ahead.
 */
export async function recordReportEvent(
  request: Request,
  input: {
    kind: ReportEventKind;
    slug: string;
    period?: string;
    query: unknown;
    exportFormat?: 'csv' | 'pdf' | 'xlsx';
  },
): Promise<void> {
  if (!findReport(input.slug)) return;
  const { filters, authority } = await authorizeManagementReportRequest(request, input.query);
  await withTenantTransaction(authority.transaction, async (transaction) => {
    const names =
      filters.stationIds.length === 0
        ? []
        : (
            await transaction.execute<{ name: string }>(sql`
              select name from app.stations
              where tenant_id = ${filters.tenantId}
                and id in (${sql.join(
                  filters.stationIds.map((id) => sql`${id}::uuid`),
                  sql`, `,
                )})
            `)
          ).map((row) => row.name);
    await appendSecurityEvent(
      {
        eventId: randomUUID(),
        tenantId: filters.tenantId,
        membershipId: authority.authorization.membershipId,
        actorId: authority.authorization.userId,
        actorType: 'HUMAN',
        actionCode: REPORT_EVENT_CODES[input.kind],
        subjectType: 'REPORT',
        subjectId: input.slug,
        requestId: authority.transaction.requestId ?? randomUUID(),
        occurredAt: new Date().toISOString(),
        metadata: buildReportEventMetadata({
          slug: input.slug,
          period: input.period,
          fromDate: filters.fromDate ?? '',
          toDate: filters.toDate ?? '',
          stationNames: names,
          exportFormat: input.exportFormat,
        }),
      },
      getAuditSigningKey(),
      transaction,
    );
  });
}

/** The signed-in user's own recent share and export actions, newest first. */
export async function listRecentReportActivity(
  request: Request,
  input: { tenantId: string; limit?: number },
): Promise<ReportActivityItem[]> {
  const authority = await resolveTenantExecutionContext({
    request,
    requestedTenantId: input.tenantId,
  });
  // Only someone who may view reports at some scope sees report activity, even their own.
  const mayViewReports = authority.authorization.roleAssignments.some((assignment) =>
    isPermissionGranted({
      actor: authority.authorization,
      permissionCode: 'report.view',
      requestedScope: assignment,
    }),
  );
  if (!mayViewReports) {
    throw new AppError('FORBIDDEN', 'You do not have access to report activity');
  }
  const limit = Math.min(Math.max(input.limit ?? 6, 1), 20);
  const rows = await withTenantTransaction(authority.transaction, (transaction) =>
    transaction.execute<{
      id: string;
      event_code: string;
      occurred_at: Date | string;
      details: { metadata?: Record<string, unknown> } | null;
    }>(sql`
      select id, event_code, occurred_at, details
      from platform.security_events
      where tenant_id = ${input.tenantId}
        and actor_id = ${authority.authorization.userId}
        and event_code in (${REPORT_EVENT_CODES.SHARED}, ${REPORT_EVENT_CODES.EXPORTED})
      order by occurred_at desc, id desc
      limit ${limit}
    `),
  );
  return rows.flatMap((row) => {
    const item = toActivityItem({
      id: row.id,
      eventCode: row.event_code,
      occurredAt: new Date(row.occurred_at).toISOString(),
      metadata: row.details?.metadata as never,
    });
    return item ? [item] : [];
  });
}
