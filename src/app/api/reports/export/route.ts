import { AppError } from '../../../../platform/errors';
import { findReport } from '../../../../modules/reporting/catalog';
import {
  buildExportFromCsv,
  buildReportExport,
  parseReportExportFormat,
  reportExportContentType,
  reportExportFilename,
} from '../../../../modules/reporting/export-documents';
import { getManagementReportFromRequest } from '../../../../modules/reporting/queries';
import { buildTableReportCsv } from '../../../../modules/reporting/table-reports/csv';
import { runTableReport } from '../../../../modules/reporting/table-reports/run';
import { findTableReport } from '../../../../modules/reporting/table-reports/definitions';
import { recordReportEvent } from '../../../../modules/reporting/report-events';
import { apiErrorResponse, withRequestObservability } from '../../../../platform/observability';
import { WRITE_RATE_LIMIT, withPersistentRateLimit } from '../../../../platform/security';

/**
 * Browser download of one report for the requested stations and dates. It runs the same
 * authorised report query as viewing, so it can never include more than the
 * signed-in user may see. Taking data out needs a fresh step-up, and the export is recorded in the
 * audit log only once it has succeeded.
 */
export const GET = withRequestObservability(
  withPersistentRateLimit(async (request: Request): Promise<Response> => {
    try {
      const url = new URL(request.url);
      const query = Object.fromEntries(url.searchParams.entries());
      const slug = query.report ?? '';
      const period = query.period;
      const format = parseReportExportFormat(query.format);
      delete query.report;
      delete query.period;
      delete query.format;
      const definition = findReport(slug);
      if (!definition) throw new AppError('NOT_FOUND', 'That report does not exist');
      if (!definition.exportable) {
        throw new AppError('VALIDATION_FAILED', 'That report is not available as a download');
      }

      let document: string | Buffer;
      let filename: string;
      if (findTableReport(slug)) {
        const result = await runTableReport(request, slug, query, { requireStepUp: true });
        document = buildExportFromCsv(format, buildTableReportCsv(result.definition, result.rows));
        filename = reportExportFilename(
          slug,
          result.fromDate,
          result.toDate,
          result.stationCount,
          format,
        );
      } else {
        const report = await getManagementReportFromRequest(request, query, {
          requireStepUp: true,
        });
        document = buildReportExport(format, slug, report);
        filename = reportExportFilename(
          slug,
          report.filters.fromDate,
          report.filters.toDate,
          report.filters.stationIds.length,
          format,
        );
      }
      await recordReportEvent(request, {
        kind: 'EXPORTED',
        slug,
        period,
        query,
        exportFormat: format,
      });

      const body =
        typeof document === 'string' ? document : (new Uint8Array(document) as unknown as BodyInit);
      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': reportExportContentType(format),
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
