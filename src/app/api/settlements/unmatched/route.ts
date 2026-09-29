import { NextResponse } from 'next/server';
import { requireAuthenticatedActor } from '../../../../modules/identity';
import {
  getUnmatchedProviderPaymentsFromRequest,
  parseSettlementQuery,
} from '../../../../modules/settlements/queries';
import { apiErrorResponse, withRequestObservability } from '../../../../platform/observability';

export const GET = withRequestObservability(async (request: Request): Promise<Response> => {
  try {
    await requireAuthenticatedActor(request);
    const url = new URL(request.url);
    const input = parseSettlementQuery({
      tenantId: url.searchParams.get('tenantId'),
      stationId: url.searchParams.get('stationId'),
    });
    return NextResponse.json(await getUnmatchedProviderPaymentsFromRequest(request, input), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return apiErrorResponse(request, error);
  }
});
