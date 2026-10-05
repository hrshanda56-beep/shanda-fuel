import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCustomerAccountsFromRequest } from '../../../../modules/customers/queries';
import { apiErrorResponse, withRequestObservability } from '../../../../platform/observability';

const querySchema = z.object({
  tenantId: z.string().uuid(),
  customerId: z.string().uuid().optional(),
});

export const GET = withRequestObservability(async (request: Request): Promise<Response> => {
  try {
    const url = new URL(request.url);
    const input = querySchema.parse({
      tenantId: url.searchParams.get('tenantId'),
      customerId: url.searchParams.get('customerId') ?? undefined,
    });
    return NextResponse.json(await getCustomerAccountsFromRequest(request, input), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return apiErrorResponse(request, error);
  }
});
