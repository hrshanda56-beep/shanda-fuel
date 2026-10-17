import { NextResponse } from 'next/server';
import { requireAuthenticatedActor } from '../../../../modules/identity';
import { getCustomerAccountStatementFromRequest } from '../../../../modules/customers/queries';
import { customerStatementQuerySchema } from '../../../../modules/customers/validation';
import { apiErrorResponse, withRequestObservability } from '../../../../platform/observability';

export const GET = withRequestObservability(async (request: Request): Promise<Response> => {
  try {
    await requireAuthenticatedActor(request);
    const url = new URL(request.url);
    const input = customerStatementQuerySchema.parse({
      tenantId: url.searchParams.get('tenantId'),
      accountId: url.searchParams.get('accountId'),
      asOf: url.searchParams.get('asOf') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
      cursor: url.searchParams.get('cursor') ?? undefined,
    });
    return NextResponse.json(await getCustomerAccountStatementFromRequest(request, input), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return apiErrorResponse(request, error, {
      includeDetails: true,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
});
