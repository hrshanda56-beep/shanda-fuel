import { NextResponse } from 'next/server';
import { requireAuthenticatedActor } from '../../../../modules/identity';
import { getSetupOverview } from '../../../../modules/setup';
import { resolveSetupOverview } from '../../../../modules/setup/readiness-queries';
import { apiErrorResponse, withRequestObservability } from '../../../../platform/observability';

export const GET = withRequestObservability(async (request: Request): Promise<Response> => {
  try {
    await requireAuthenticatedActor(request);
    const url = new URL(request.url);
    const data = await getSetupOverview({
      request,
      tenantId: url.searchParams.get('tenantId') ?? '',
      stationId: url.searchParams.get('stationId') ?? '',
    });
    const readiness = await resolveSetupOverview(request);
    return NextResponse.json({ ...readiness, data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiErrorResponse(request, error, { includeDetails: true });
  }
});
