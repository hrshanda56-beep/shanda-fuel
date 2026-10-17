import { NextResponse } from 'next/server';
import { requireAuthenticatedActor } from '../../../../../../modules/identity';
import { getInventoryRevaluationReadModel } from '../../../../../../modules/costing/queries';
import {
  apiErrorResponse,
  withRequestObservability,
} from '../../../../../../platform/observability';

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

type RevaluationRouteContext = { params: Promise<{ id: string }> };

export const GET = withRequestObservability(
  async (request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> => {
    try {
      await requireAuthenticatedActor(request);
      const { id } = await params;
      const url = new URL(request.url);
      return json(
        await getInventoryRevaluationReadModel(request, {
          tenantId: url.searchParams.get('tenantId'),
          stationId: url.searchParams.get('stationId'),
          revaluationId: id,
        }),
        200,
      );
    } catch (error) {
      return apiErrorResponse(request, error, {
        includeDetails: true,
        internalMessage: 'The revaluation detail could not be loaded.',
        headers: { 'Cache-Control': 'no-store' },
      });
    }
  },
) as (request: Request, context: RevaluationRouteContext) => Promise<Response>;
