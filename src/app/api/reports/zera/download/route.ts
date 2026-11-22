import { AppError } from '../../../../../platform/errors';
import { buildZeraPdf } from '../../../../../modules/reporting/zera/zera-pdf';
import { readSavedZeraReturnFromRequest } from '../../../../../modules/reporting/zera/save-zera';
import { monthName, zeraCsv } from '../../../../../modules/reporting/zera/zera-wizard-checks';
import { apiErrorResponse, withRequestObservability } from '../../../../../platform/observability';
import { WRITE_RATE_LIMIT, withPersistentRateLimit } from '../../../../../platform/security';

/**
 * Download of a saved ZERA return as CSV or PDF. It reads the saved version with the same permission
 * as viewing the report, needs a fresh identity check because data leaves the application, and is
 * written to the signed audit log together with the read.
 */
export const GET = withRequestObservability(
  withPersistentRateLimit(async (request: Request): Promise<Response> => {
    try {
      const query = Object.fromEntries(new URL(request.url).searchParams.entries());
      const format = query.format === 'pdf' ? 'pdf' : query.format === 'csv' ? 'csv' : null;
      if (!format) throw new AppError('VALIDATION_FAILED', 'Choose CSV or PDF.');
      const saved = await readSavedZeraReturnFromRequest(request, query, format);
      const csv = zeraCsv(saved.answers);
      const stem = `zera-return-${saved.month}-v${saved.version}`;
      const body =
        format === 'csv'
          ? csv
          : (new Uint8Array(
              buildZeraPdf({
                answers: saved.answers,
                periodLabel: `${monthName(saved.month)} ${saved.month.slice(0, 4)}`,
                stationName: saved.stationName,
                version: saved.version,
                savedAt: saved.savedAt,
              }),
            ) as unknown as BodyInit);
      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': format === 'csv' ? 'text/csv; charset=utf-8' : 'application/pdf',
          'Content-Disposition': `attachment; filename="${stem}.${format}"`,
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
