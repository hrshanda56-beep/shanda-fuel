import { NextResponse } from 'next/server';
import { createExpenseAttachmentDownloadFromRequest } from '../../../../../modules/expenses/attachments';
import { apiErrorResponse, withRequestObservability } from '../../../../../platform/observability';

type AttachmentRouteContext = { params: Promise<{ attachmentId: string }> };

export const GET: (request: Request, context: AttachmentRouteContext) => Promise<Response> =
  withRequestObservability(
    async (request: Request, { params }: AttachmentRouteContext): Promise<Response> => {
      try {
        const { attachmentId } = await params;
        const tenantId = new URL(request.url).searchParams.get('tenantId');
        const result = await createExpenseAttachmentDownloadFromRequest(request, attachmentId, {
          tenantId,
        });
        return NextResponse.json(result, {
          headers: { 'Cache-Control': 'no-store' },
        });
      } catch (error) {
        return apiErrorResponse(request, error, {
          includeDetails: true,
          headers: { 'Cache-Control': 'no-store' },
        });
      }
    },
  );
