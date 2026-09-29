import { NextResponse } from 'next/server';
import { requireAuthenticatedActor } from '../../../../modules/identity';
import { getCustomerAccountStatementFromRequest } from '../../../../modules/customers/queries';
import { apiErrorResponse, withRequestObservability } from '../../../../platform/observability';

export const GET = withRequestObservability(async (request: Request): Promise<Response> => {
  try {
    await requireAuthenticatedActor(request);
    const url = new URL(request.url);
    const input = Object.fromEntries(url.searchParams.entries());
    return NextResponse.json(await getCustomerAccountStatementFromRequest(request, input), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return apiErrorResponse(request, error, { includeDetails: true });
  }
});
