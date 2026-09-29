import { NextResponse } from 'next/server';
import { requireAuthenticatedActor } from '../../../../modules/identity';
import { getInventoryValuationReadModel } from '../../../../modules/costing/queries';
import { apiErrorResponse, withRequestObservability } from '../../../../platform/observability';

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export const GET = withRequestObservability(async (request: Request): Promise<Response> => {
  try {
    await requireAuthenticatedActor(request);
    const url = new URL(request.url);
    return json(
      await getInventoryValuationReadModel(request, {
        tenantId: url.searchParams.get('tenantId'),
        stationId: url.searchParams.get('stationId'),
        tankId: url.searchParams.get('tankId') ?? undefined,
        productId: url.searchParams.get('productId') ?? undefined,
      }),
      200,
    );
  } catch (error) {
    return apiErrorResponse(request, error, {
      includeDetails: true,
      internalMessage: 'The valuation view could not be loaded.',
      headers: { 'Cache-Control': 'no-store' },
    });
  }
});
