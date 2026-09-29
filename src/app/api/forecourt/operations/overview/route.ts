import { NextResponse } from 'next/server';
import { requireAuthenticatedActor } from '../../../../../modules/identity';
import {
  getOperationsOverviewFromRequest,
  operationsOverviewQuery,
} from '../../../../../modules/forecourt/operations-overview';
import { apiErrorResponse, withRequestObservability } from '../../../../../platform/observability';

export const GET = withRequestObservability(async (request: Request): Promise<Response> => {
  try {
    await requireAuthenticatedActor(request);
    const url = new URL(request.url);
    const input = operationsOverviewQuery.parse({
      tenantId: url.searchParams.get('tenantId'),
      stationId: url.searchParams.get('stationId'),
      businessDayId: url.searchParams.get('businessDayId') ?? undefined,
    });
    return NextResponse.json(await getOperationsOverviewFromRequest(request, input), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return apiErrorResponse(request, error);
  }
});
