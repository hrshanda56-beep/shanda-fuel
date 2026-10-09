import { NextResponse } from 'next/server';
import { requireAuthenticatedActor } from '@/modules/identity';
import {
  attendantHomeQuery,
  getAttendantHomeFromRequest,
} from '@/modules/forecourt/attendant-home';
import { apiErrorResponse, withRequestObservability } from '@/platform/observability';

export const GET = withRequestObservability(async (request: Request): Promise<Response> => {
  try {
    await requireAuthenticatedActor(request);
    const url = new URL(request.url);
    const input = attendantHomeQuery.parse({
      tenantId: url.searchParams.get('tenantId'),
      stationId: url.searchParams.get('stationId'),
    });
    return NextResponse.json(await getAttendantHomeFromRequest(request, input), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return apiErrorResponse(request, error);
  }
});
