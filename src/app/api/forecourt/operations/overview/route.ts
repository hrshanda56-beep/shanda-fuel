import { withReadTiming, markReadTiming } from '../../../../../platform/observability/read-timing';
import { NextResponse } from 'next/server';
import { requireAuthenticatedActor } from '../../../../../modules/identity';
import {
  getOperationsOverviewFromRequest,
  operationsOverviewQuery,
} from '../../../../../modules/forecourt/operations-overview';
import { apiErrorResponse, withRequestObservability } from '../../../../../platform/observability';

export const GET = withRequestObservability((request: Request): Promise<Response> =>
  withReadTiming(
    new URL(request.url).pathname,
    async () => {
      try {
        const actor = await requireAuthenticatedActor(request);
        markReadTiming('identity.ready');
        const url = new URL(request.url);
        const input = operationsOverviewQuery.parse({
          tenantId: url.searchParams.get('tenantId'),
          stationId: url.searchParams.get('stationId'),
          businessDayId: url.searchParams.get('businessDayId') ?? undefined,
        });
        return NextResponse.json(await getOperationsOverviewFromRequest(request, input, actor), {
          headers: { 'Cache-Control': 'no-store' },
        });
      } catch (error) {
        return apiErrorResponse(request, error);
      }
    },
    new URL(request.url).searchParams.get('profileSql') === '1',
  ),
);
