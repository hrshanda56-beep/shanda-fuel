import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuthenticatedActor } from '../../../modules/identity';
import { getExpensesFromRequest } from '../../../modules/expenses';
import { apiErrorResponse, withRequestObservability } from '../../../platform/observability';

const querySchema = z.object({
  tenantId: z.string().uuid(),
  legalEntityId: z.string().uuid().optional(),
  stationId: z.string().uuid().optional(),
  state: z.string().optional(),
  fromBusinessDate: z.string().optional(),
  toBusinessDate: z.string().optional(),
});

export const GET = withRequestObservability(async (request: Request): Promise<Response> => {
  try {
    await requireAuthenticatedActor(request);
    const url = new URL(request.url);
    const input = querySchema.parse({
      tenantId: url.searchParams.get('tenantId'),
      legalEntityId: url.searchParams.get('legalEntityId') ?? undefined,
      stationId: url.searchParams.get('stationId') ?? undefined,
      state: url.searchParams.get('state') ?? undefined,
      fromBusinessDate: url.searchParams.get('fromBusinessDate') ?? undefined,
      toBusinessDate: url.searchParams.get('toBusinessDate') ?? undefined,
    });
    return NextResponse.json(await getExpensesFromRequest(request, input), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return apiErrorResponse(request, error, { headers: { 'Cache-Control': 'no-store' } });
  }
});
