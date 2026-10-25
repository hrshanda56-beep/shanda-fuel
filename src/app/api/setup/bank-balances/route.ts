import { NextResponse } from 'next/server';
import { getBankBalancesFromRequest } from '../../../../modules/setup/bank-balance-queries';
import { apiErrorResponse, withRequestObservability } from '../../../../platform/observability';

export const GET = withRequestObservability(async (request: Request): Promise<Response> => {
  try {
    const params = Object.fromEntries(new URL(request.url).searchParams.entries());
    return NextResponse.json(await getBankBalancesFromRequest(request, params), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return apiErrorResponse(request, error);
  }
});
