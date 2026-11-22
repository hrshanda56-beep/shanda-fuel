import { requireAuthenticatedActor } from '../../../../modules/identity';
import { downloadSalesDocumentPdfFromRequest } from '../../../../modules/sales-documents/download';
import { apiErrorResponse, withRequestObservability } from '../../../../platform/observability';
import { WRITE_RATE_LIMIT, withPersistentRateLimit } from '../../../../platform/security';

/**
 * Browser download of one quotation, invoice or receipt as a PDF. The same authorised read as
 * viewing it runs first, and the download is recorded in the signed audit log.
 */
export const GET = withRequestObservability(
  withPersistentRateLimit(async (request: Request): Promise<Response> => {
    try {
      const actor = await requireAuthenticatedActor(request);
      const query = Object.fromEntries(new URL(request.url).searchParams.entries());
      const { filename, pdf } = await downloadSalesDocumentPdfFromRequest(request, query, actor);
      return new Response(new Uint8Array(pdf) as unknown as BodyInit, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          // `inline=1` lets the page show the PDF in a frame instead of saving it.
          'Content-Disposition': `${
            new URL(request.url).searchParams.get('inline') === '1' ? 'inline' : 'attachment'
          }; filename="${filename}"`,
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
