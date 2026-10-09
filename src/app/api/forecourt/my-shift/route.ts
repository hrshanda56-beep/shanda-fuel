import { NextResponse } from 'next/server';
import { requireAuthenticatedActor } from '../../../../modules/identity';
import { getMyShiftFromRequest, myShiftQuery } from '../../../../modules/forecourt/my-shift';
import { apiErrorResponse, withRequestObservability } from '../../../../platform/observability';

export const GET = withRequestObservability(async (request: Request): Promise<Response> => {
  try {
    await requireAuthenticatedActor(request);
    const url = new URL(request.url);
    const input = myShiftQuery.parse({
      tenantId: url.searchParams.get('tenantId'),
      stationId: url.searchParams.get('stationId'),
    });
    return NextResponse.json(await getMyShiftFromRequest(request, input), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return apiErrorResponse(request, error);
  }
});
