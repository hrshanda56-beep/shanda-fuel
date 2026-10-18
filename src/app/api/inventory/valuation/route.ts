import { withReadTiming, markReadTiming } from '../../../../platform/observability/read-timing';
import { NextResponse } from 'next/server';
import { requireAuthenticatedActor } from '../../../../modules/identity';
import { getInventoryValuationReadModel } from '../../../../modules/costing/queries';
import { apiErrorResponse, withRequestObservability } from '../../../../platform/observability';

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export const GET = withRequestObservability((request: Request): Promise<Response> =>
  withReadTiming(
    new URL(request.url).pathname,
    async () => {
      try {
        const actor = await requireAuthenticatedActor(request);
        markReadTiming('identity.ready');
        const url = new URL(request.url);
        return json(
          await getInventoryValuationReadModel(
            request,
            {
              tenantId: url.searchParams.get('tenantId'),
              stationId: url.searchParams.get('stationId'),
              tankId: url.searchParams.get('tankId') ?? undefined,
              productId: url.searchParams.get('productId') ?? undefined,
            },
            actor,
          ),
          200,
        );
      } catch (error) {
        return apiErrorResponse(request, error, {
          includeDetails: true,
          internalMessage: 'The valuation view could not be loaded.',
          headers: { 'Cache-Control': 'no-store' },
        });
      }
    },
    new URL(request.url).searchParams.get('profileSql') === '1',
  ),
);
