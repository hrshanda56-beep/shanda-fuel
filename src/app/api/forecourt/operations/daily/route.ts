import { NextResponse } from 'next/server';
import { requireAuthenticatedActor } from '../../../../../modules/identity';
import {
  dailyOperationsQuery,
  getDailyOperationsContextFromRequest,
} from '../../../../../modules/forecourt/daily-operations';
import { apiErrorResponse, withRequestObservability } from '../../../../../platform/observability';

export const GET = withRequestObservability(async (request: Request): Promise<Response> => {
  try {
    await requireAuthenticatedActor(request);
    const url = new URL(request.url);
    const input = dailyOperationsQuery.parse({
      tenantId: url.searchParams.get('tenantId'),
      stationId: url.searchParams.get('stationId'),
      businessDayId: url.searchParams.get('businessDayId'),
      shiftId: url.searchParams.get('shiftId'),
    });
    return NextResponse.json(await getDailyOperationsContextFromRequest(request, input), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return apiErrorResponse(request, error);
  }
});
