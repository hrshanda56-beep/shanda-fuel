import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupplierDueScheduleFromRequest } from '../../../../modules/creditors/due-schedule-queries';
import { apiErrorResponse, withRequestObservability } from '../../../../platform/observability';

const querySchema = z.object({
  tenantId: z.string().uuid(),
  legalEntityId: z.string().uuid(),
  supplierId: z.string().uuid().optional(),
  asOf: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export const GET = withRequestObservability(async (request: Request): Promise<Response> => {
  try {
    const url = new URL(request.url);
    const input = querySchema.parse({
      tenantId: url.searchParams.get('tenantId'),
      legalEntityId: url.searchParams.get('legalEntityId'),
      supplierId: url.searchParams.get('supplierId') ?? undefined,
      asOf: url.searchParams.get('asOf') ?? undefined,
    });
    return NextResponse.json(await getSupplierDueScheduleFromRequest(request, input), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return apiErrorResponse(request, error);
  }
});
