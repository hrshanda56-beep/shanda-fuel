import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getPurchasingPolicyFromRequest } from '../../../../modules/creditors/purchasing-queries';
import { apiErrorResponse, withRequestObservability } from '../../../../platform/observability';

const querySchema = z.object({
  tenantId: z.string().uuid(),
  legalEntityId: z.string().uuid(),
  supplierId: z.string().uuid().optional(),
});

/** Reads the purchasing policy. Changing it is the SetPurchasingPolicy command. */
export const GET = withRequestObservability(async (request: Request): Promise<Response> => {
  try {
    const url = new URL(request.url);
    const input = querySchema.parse({
      tenantId: url.searchParams.get('tenantId'),
      legalEntityId: url.searchParams.get('legalEntityId'),
      supplierId: url.searchParams.get('supplierId') ?? undefined,
    });
    return NextResponse.json(await getPurchasingPolicyFromRequest(request, input), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return apiErrorResponse(request, error);
  }
});
