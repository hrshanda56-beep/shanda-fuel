import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { AppError } from '../../../../../platform/errors';
import { getProductionReconciliationFromRequest } from '../../../../../modules/forecourt/production-reconciliation';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const url = new URL(request.url);
    const tenantId = url.searchParams.get('tenantId') ?? '';
    const stationId = url.searchParams.get('stationId') ?? '';
    const result = await getProductionReconciliationFromRequest(request, {
      tenantId,
      stationId,
      reconciliationId: id,
    });
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', issues: error.issues },
        { status: 400 },
      );
    }
    if (error instanceof AppError) {
      return NextResponse.json(
        { error: error.code, message: error.message },
        { status: error.httpStatus },
      );
    }
    console.error('reconciliation read failed', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
