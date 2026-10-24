import { NextResponse } from 'next/server';
import { createDocumentDownloadFromRequest } from '../../../../modules/documents/documents';
import { apiErrorResponse, withRequestObservability } from '../../../../platform/observability';

type DocumentRouteContext = { params: Promise<{ documentId: string }> };

/** A short-lived link to one private file, after the viewer's access to its station is checked. */
export const GET: (request: Request, context: DocumentRouteContext) => Promise<Response> =
  withRequestObservability(
    async (request: Request, { params }: DocumentRouteContext): Promise<Response> => {
      try {
        const { documentId } = await params;
        const tenantId = new URL(request.url).searchParams.get('tenantId');
        return NextResponse.json(
          await createDocumentDownloadFromRequest(request, documentId, { tenantId }),
          { headers: { 'Cache-Control': 'no-store' } },
        );
      } catch (error) {
        return apiErrorResponse(request, error, {
          includeDetails: true,
          headers: { 'Cache-Control': 'no-store' },
        });
      }
    },
  );
