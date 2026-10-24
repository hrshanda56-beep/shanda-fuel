import { NextResponse } from 'next/server';
import { requireAuthenticatedActor } from '../../../../modules/identity';
import {
  getSettlementOverviewFromRequest,
  parseSettlementQuery,
} from '../../../../modules/settlements/queries';
import { apiErrorResponse, withRequestObservability } from '../../../../platform/observability';
export const GET = withRequestObservability(async (request: Request): Promise<Response> => {
  try {
    const actor = await requireAuthenticatedActor(request);
    const url = new URL(request.url);
    const input = parseSettlementQuery({
      tenantId: url.searchParams.get('tenantId'),
      stationId: url.searchParams.get('stationId'),
    });
    return NextResponse.json(await getSettlementOverviewFromRequest(request, input, actor), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return apiErrorResponse(request, error);
  }
});
