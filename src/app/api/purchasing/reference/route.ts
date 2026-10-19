import { NextResponse } from 'next/server';
import { getPurchaseOrderReferenceFromRequest } from '../../../../modules/purchasing/queries';
import { apiErrorResponse, withRequestObservability } from '../../../../platform/observability';

export const GET = withRequestObservability(async (request: Request): Promise<Response> => {
  try {
    const params = Object.fromEntries(new URL(request.url).searchParams.entries());
    return NextResponse.json(await getPurchaseOrderReferenceFromRequest(request, params), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return apiErrorResponse(request, error);
  }
});
