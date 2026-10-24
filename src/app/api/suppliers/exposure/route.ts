import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupplierExposureFromRequest } from '../../../../modules/creditors/purchasing-queries';
import { apiErrorResponse, withRequestObservability } from '../../../../platform/observability';

const querySchema = z.object({
  tenantId: z.string().uuid(),
  legalEntityId: z.string().uuid(),
  supplierId: z.union([z.string().uuid(), z.literal('unassigned')]).optional(),
  state: z.enum(['UNBILLED', 'PARTIALLY_BILLED', 'BILLED', 'OVER_BILLED']).optional(),
  asOf: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

/** Unbilled supplier exposure (ADR-018 D3): a reporting figure, never a ledger balance. */
export const GET = withRequestObservability(async (request: Request): Promise<Response> => {
  try {
    const url = new URL(request.url);
    const input = querySchema.parse({
      tenantId: url.searchParams.get('tenantId'),
      legalEntityId: url.searchParams.get('legalEntityId'),
      supplierId: url.searchParams.get('supplierId') ?? undefined,
      state: url.searchParams.get('state') ?? undefined,
      asOf: url.searchParams.get('asOf') ?? undefined,
    });
    return NextResponse.json(await getSupplierExposureFromRequest(request, input), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return apiErrorResponse(request, error);
  }
});
