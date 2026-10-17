import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuthenticatedActor } from '../../../../modules/identity';
import { getRecurringExpenseTemplatesFromRequest } from '../../../../modules/expenses';
import { apiErrorResponse, withRequestObservability } from '../../../../platform/observability';

const querySchema = z.object({
  tenantId: z.string().uuid(),
  legalEntityId: z.string().uuid().optional(),
  stationId: z.string().uuid().optional(),
});

export const GET = withRequestObservability(async (request: Request): Promise<Response> => {
  try {
    await requireAuthenticatedActor(request);
    const url = new URL(request.url);
    return NextResponse.json(
      await getRecurringExpenseTemplatesFromRequest(
        request,
        querySchema.parse({
          tenantId: url.searchParams.get('tenantId'),
          legalEntityId: url.searchParams.get('legalEntityId') ?? undefined,
          stationId: url.searchParams.get('stationId') ?? undefined,
        }),
      ),
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return apiErrorResponse(request, error, { headers: { 'Cache-Control': 'no-store' } });
  }
});
