import { NextResponse } from 'next/server';
import { getProfitabilityFromRequest } from '../../../../modules/profitability/api';
import { apiErrorResponse, withRequestObservability } from '../../../../platform/observability';

export const GET = withRequestObservability(async (request: Request): Promise<Response> => {
  try {
    const url = new URL(request.url);
    return NextResponse.json(
      await getProfitabilityFromRequest(request, Object.fromEntries(url.searchParams.entries())),
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return apiErrorResponse(request, error, { includeDetails: true });
  }
});
