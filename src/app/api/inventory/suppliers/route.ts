import { NextResponse } from 'next/server';
import { requireAuthenticatedActor } from '../../../../modules/identity';
import { queryDeliverySuppliers } from '../../../../modules/inventory';
import { apiErrorResponse, withRequestObservability } from '../../../../platform/observability';

export const GET = withRequestObservability(async (request: Request): Promise<Response> => {
  try {
    await requireAuthenticatedActor(request);
    const url = new URL(request.url);
    const data = await queryDeliverySuppliers({
      request,
      tenantId: url.searchParams.get('tenantId') ?? '',
      stationId: url.searchParams.get('stationId') ?? '',
    });
    return NextResponse.json({ data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiErrorResponse(request, error, { includeDetails: true });
  }
});
