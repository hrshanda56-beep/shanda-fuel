import { requireAuthenticatedActor } from '../../../../modules/identity';
import { previewSalesDocumentPdfFromRequest } from '../../../../modules/sales-documents/download';
import { apiErrorResponse, withRequestObservability } from '../../../../platform/observability';
import { WRITE_RATE_LIMIT, withPersistentRateLimit } from '../../../../platform/security';

/**
 * A picture of a quotation or invoice that has not been saved yet, as the PDF it would print as.
 * Nothing is stored. The same permission as saving a draft is needed.
 */
export const POST = withRequestObservability(
  withPersistentRateLimit(async (request: Request): Promise<Response> => {
    try {
      const actor = await requireAuthenticatedActor(request);
      // The page sends its answers as a form (so the browser can aim the reply at a frame); a
      // plain JSON body works too.
      const body: unknown = (request.headers.get('content-type') ?? '').includes('application/json')
        ? await request.json()
        : JSON.parse(String((await request.formData()).get('payload') ?? '{}'));
      const { pdf } = await previewSalesDocumentPdfFromRequest(request, body, actor);
      return new Response(new Uint8Array(pdf) as unknown as BodyInit, {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'inline; filename="preview.pdf"',
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
