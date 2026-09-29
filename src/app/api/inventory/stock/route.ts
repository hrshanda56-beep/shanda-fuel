import { NextResponse } from 'next/server';
import { requireAuthenticatedActor } from '../../../../modules/identity';
import { queryInventoryStock } from '../../../../modules/inventory';
import { apiErrorResponse, withRequestObservability } from '../../../../platform/observability';

export const GET = withRequestObservability(async (request: Request): Promise<Response> => {
  try {
    await requireAuthenticatedActor(request);
    const url = new URL(request.url);
    const result = await queryInventoryStock({
      request,
      tenantId: url.searchParams.get('tenantId') ?? '',
      stationId: url.searchParams.get('stationId') ?? '',
      tankId: url.searchParams.get('tankId') ?? undefined,
      productId: url.searchParams.get('productId') ?? undefined,
    });
    return NextResponse.json({ data: result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiErrorResponse(request, error, { includeDetails: true });
  }
});
