import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupplierVarianceFromRequest } from '../../../../modules/creditors/purchasing-queries';
import { apiErrorResponse, withRequestObservability } from '../../../../platform/observability';

const querySchema = z.object({
  tenantId: z.string().uuid(),
  legalEntityId: z.string().uuid(),
  supplierId: z.union([z.string().uuid(), z.literal('unassigned')]).optional(),
  deliveryId: z.string().uuid().optional(),
  onlyExceptions: z.enum(['true', 'false']).optional(),
  asOf: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

/** Delivery note vs accepted vs invoiced quantity and price, judged by the purchasing policy. */
export const GET = withRequestObservability(async (request: Request): Promise<Response> => {
  try {
    const url = new URL(request.url);
    const input = querySchema.parse({
      tenantId: url.searchParams.get('tenantId'),
      legalEntityId: url.searchParams.get('legalEntityId'),
      supplierId: url.searchParams.get('supplierId') ?? undefined,
      deliveryId: url.searchParams.get('deliveryId') ?? undefined,
      onlyExceptions: url.searchParams.get('onlyExceptions') ?? undefined,
      asOf: url.searchParams.get('asOf') ?? undefined,
    });
    return NextResponse.json(
      await getSupplierVarianceFromRequest(request, {
        ...input,
        onlyExceptions: input.onlyExceptions === 'true',
      }),
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return apiErrorResponse(request, error);
  }
});
