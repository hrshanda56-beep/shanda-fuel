import { NextResponse } from 'next/server';
import { z, ZodError } from 'zod';
import { AppError } from '../../../../platform/errors';
import { getSupplierSummaryFromRequest } from '../../../../modules/creditors/queries';

const querySchema = z.object({
  tenantId: z.string().uuid(),
  legalEntityId: z.string().uuid(),
  supplierId: z.string().uuid().optional(),
  asOf: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const input = querySchema.parse({
      tenantId: url.searchParams.get('tenantId'),
      legalEntityId: url.searchParams.get('legalEntityId'),
      supplierId: url.searchParams.get('supplierId') ?? undefined,
      asOf: url.searchParams.get('asOf') ?? undefined,
    });
    return NextResponse.json(await getSupplierSummaryFromRequest(request, input), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof ZodError)
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', issues: error.issues },
        { status: 400 },
      );
    if (error instanceof AppError)
      return NextResponse.json(
        { error: error.code, message: error.message },
        { status: error.httpStatus },
      );
    console.error('supplier summary read failed', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
