import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCashStationSummaryFromRequest } from '../../../../modules/cash/queries';
import { apiErrorResponse, withRequestObservability } from '../../../../platform/observability';

const querySchema = z.object({
  tenantId: z.string().uuid(),
  stationId: z.string().uuid(),
});

export const GET = withRequestObservability(async (request: Request): Promise<Response> => {
  try {
    const url = new URL(request.url);
    const input = querySchema.parse({
      tenantId: url.searchParams.get('tenantId'),
      stationId: url.searchParams.get('stationId'),
    });
    return NextResponse.json(await getCashStationSummaryFromRequest(request, input), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return apiErrorResponse(request, error);
  }
});
