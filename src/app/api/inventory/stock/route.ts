import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { requireAuthenticatedActor } from '../../../../modules/identity';
import { queryInventoryStock } from '../../../../modules/inventory';
import { AppError } from '../../../../platform/errors';

export async function GET(request: Request): Promise<Response> {
  try {
    await requireAuthenticatedActor(request);
    const url = new URL(request.url);
    const result = await queryInventoryStock({
      request,
      tenantId: url.searchParams.get('tenantId') ?? '',
      stationId: url.searchParams.get('stationId') ?? '',
      tankId: url.searchParams.get('tankId') ?? undefined,
      productId: url.searchParams.get('productId') ?? undefined,
    });
    return NextResponse.json({ data: result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof ZodError)
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', issues: error.issues },
        { status: 400 },
      );
    if (error instanceof AppError)
      return NextResponse.json(
        { error: error.code, message: error.message, details: error.details },
        { status: error.httpStatus },
      );
    console.error('inventory stock query failed', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
