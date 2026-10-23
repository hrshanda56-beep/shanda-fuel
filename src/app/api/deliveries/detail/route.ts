import { NextResponse } from 'next/server';
import { requireAuthenticatedActor } from '../../../../modules/identity';
import { queryDeliveryDetail, queryDeliveryList } from '../../../../modules/deliveries';
import { apiErrorResponse, withRequestObservability } from '../../../../platform/observability';

/** GET ?tenantId&stationId lists recent deliveries; add &deliveryId for one delivery's detail. */
export const GET = withRequestObservability(async (request: Request): Promise<Response> => {
  try {
    await requireAuthenticatedActor(request);
    const url = new URL(request.url);
    const tenantId = url.searchParams.get('tenantId') ?? '';
    const stationId = url.searchParams.get('stationId') ?? '';
    const deliveryId = url.searchParams.get('deliveryId');
    const data = deliveryId
      ? await queryDeliveryDetail({ request, tenantId, stationId, deliveryId })
      : await queryDeliveryList({ request, tenantId, stationId });
    return NextResponse.json({ data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiErrorResponse(request, error, { includeDetails: true });
  }
});
