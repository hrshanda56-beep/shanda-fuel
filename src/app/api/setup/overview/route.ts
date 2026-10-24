import { NextResponse } from 'next/server';
import { requireAuthenticatedActor } from '../../../../modules/identity';
import { getSetupOverview } from '../../../../modules/setup';
import { resolveSetupOverview } from '../../../../modules/setup/readiness-queries';
import { apiErrorResponse, withRequestObservability } from '../../../../platform/observability';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET = withRequestObservability(async (request: Request): Promise<Response> => {
  try {
    await requireAuthenticatedActor(request);
    const url = new URL(request.url);
    const tenantId = url.searchParams.get('tenantId') ?? '';
    const stationId = url.searchParams.get('stationId') ?? '';
    // Station configuration is only read when a station is chosen; readiness works without one.
    const data =
      UUID.test(tenantId) && UUID.test(stationId)
        ? await getSetupOverview({ request, tenantId, stationId })
        : null;
    const readiness = await resolveSetupOverview(request);
    return NextResponse.json({ ...readiness, data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiErrorResponse(request, error, { includeDetails: true });
  }
});
