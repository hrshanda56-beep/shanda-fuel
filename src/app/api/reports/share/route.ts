import { NextResponse } from 'next/server';
import { AppError } from '../../../../platform/errors';
import { findReport } from '../../../../modules/reporting/catalog';
import { parseManagementReportQuery } from '../../../../modules/reporting/queries';
import { recordReportEvent } from '../../../../modules/reporting/report-events';
import { privateReportPath } from '../../../../modules/reporting/share';
import { apiErrorResponse, withRequestObservability } from '../../../../platform/observability';
import { WRITE_RATE_LIMIT, withPersistentRateLimit } from '../../../../platform/security';

/**
 * Prepares a private link to a report. The link is only the page address with
 * its filters: it carries no token and grants no access. This confirms the
 * signed-in user may view what they are sharing, and records that they shared it.
 */
export const POST = withRequestObservability(
  withPersistentRateLimit(async (request: Request): Promise<Response> => {
    try {
      const body = (await request.json()) as Record<string, unknown>;
      const { report: slug, period, ...query } = body;
      if (typeof slug !== 'string' || !findReport(slug)) {
        throw new AppError('NOT_FOUND', 'That report does not exist');
      }
      const periodId = typeof period === 'string' ? period : undefined;
      await recordReportEvent(request, { kind: 'SHARED', slug, period: periodId, query });
      const filters = parseManagementReportQuery(query);
      return NextResponse.json(
        {
          path: privateReportPath({
            slug,
            tenantId: filters.tenantId,
            stationIds: filters.stationIds,
            period: periodId,
            fromDate: filters.fromDate,
            toDate: filters.toDate,
          }),
        },
        { headers: { 'Cache-Control': 'no-store' } },
      );
    } catch (error) {
      return apiErrorResponse(request, error, {
        includeDetails: true,
        headers: { 'Cache-Control': 'no-store' },
      });
    }
  }, WRITE_RATE_LIMIT),
);
