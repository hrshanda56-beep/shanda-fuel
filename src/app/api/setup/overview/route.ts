import { NextResponse } from 'next/server';
import { requireAuthenticatedActor } from '../../../../modules/identity';
import { resolveSetupOverview } from '../../../../modules/setup/queries';
import { apiErrorResponse, withRequestObservability } from '../../../../platform/observability';

/**
 * Per-station setup readiness and payment setup for Settings. Read-only; every
 * query runs inside the tenant transaction and is gated by existing permissions.
 */
export const GET = withRequestObservability(async (request: Request): Promise<Response> => {
  try {
    await requireAuthenticatedActor(request);
    const overview = await resolveSetupOverview(request);
    return NextResponse.json(overview, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiErrorResponse(request, error);
  }
});
