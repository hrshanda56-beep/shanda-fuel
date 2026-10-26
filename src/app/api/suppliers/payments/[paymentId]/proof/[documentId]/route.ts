import { NextResponse } from 'next/server';
import { createSupplierPaymentProofDownloadFromRequest } from '../../../../../../../modules/creditors/payment-proofs';
import {
  apiErrorResponse,
  withRequestObservability,
} from '../../../../../../../platform/observability';

type RouteContext = { params: Promise<{ paymentId: string; documentId: string }> };

export const GET = withRequestObservability(
  async (request: Request, { params }: RouteContext): Promise<Response> => {
    try {
      const { paymentId, documentId } = await params;
      const query = new URL(request.url).searchParams;
      return NextResponse.json(
        await createSupplierPaymentProofDownloadFromRequest(request, paymentId, documentId, {
          tenantId: query.get('tenantId'),
          legalEntityId: query.get('legalEntityId'),
        }),
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
