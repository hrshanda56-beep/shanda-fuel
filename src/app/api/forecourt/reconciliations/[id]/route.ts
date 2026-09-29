import { NextResponse } from 'next/server';
import { getProductionReconciliationFromRequest } from '../../../../../modules/forecourt/production-reconciliation';
import { apiErrorResponse, withRequestObservability } from '../../../../../platform/observability';

export const GET = withRequestObservability(
  async (request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> => {
    try {
      const { id } = await params;
      const url = new URL(request.url);
      const tenantId = url.searchParams.get('tenantId') ?? '';
      const stationId = url.searchParams.get('stationId') ?? '';
      const result = await getProductionReconciliationFromRequest(request, {
        tenantId,
        stationId,
        reconciliationId: id,
      });
      return NextResponse.json(result, {
        headers: { 'Cache-Control': 'no-store' },
      });
    } catch (error) {
      return apiErrorResponse(request, error);
    }
  },
);
