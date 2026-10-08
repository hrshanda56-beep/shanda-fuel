import { AppError } from '../../../../platform/errors';
import { findReport } from '../../../../modules/reporting/catalog';
import { buildReportCsv, reportCsvFilename } from '../../../../modules/reporting/export-csv';
import { getManagementReportFromRequest } from '../../../../modules/reporting/queries';
import { recordReportEvent } from '../../../../modules/reporting/report-events';
import { apiErrorResponse, withRequestObservability } from '../../../../platform/observability';
import { WRITE_RATE_LIMIT, withPersistentRateLimit } from '../../../../platform/security';

/**
 * CSV of one report for the requested stations and dates. It runs the same
 * authorised report query as viewing, so it can never include more than the
 * signed-in user may see, then records the export in the audit log.
 */
export const GET = withRequestObservability(
  withPersistentRateLimit(async (request: Request): Promise<Response> => {
    try {
      const url = new URL(request.url);
      const query = Object.fromEntries(url.searchParams.entries());
      const slug = query.report ?? '';
      const period = query.period;
      delete query.report;
      delete query.period;
      if (!findReport(slug)) throw new AppError('NOT_FOUND', 'That report does not exist');

      const report = await getManagementReportFromRequest(request, query);
      const csv = buildReportCsv(slug, report);
      await recordReportEvent(request, { kind: 'EXPORTED', slug, period, query });

      const filename = reportCsvFilename(
        slug,
        report.filters.fromDate,
        report.filters.toDate,
        report.filters.stationIds.length,
      );
      return new Response(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    } catch (error) {
      return apiErrorResponse(request, error, {
        includeDetails: true,
        headers: { 'Cache-Control': 'no-store' },
      });
    }
  }, WRITE_RATE_LIMIT),
);
