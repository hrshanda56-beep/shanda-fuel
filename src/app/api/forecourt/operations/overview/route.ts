import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { AppError } from '../../../../../platform/errors';
import { requireAuthenticatedActor } from '../../../../../modules/identity';
import {
  getOperationsOverviewFromRequest,
  operationsOverviewQuery,
} from '../../../../../modules/forecourt/operations-overview';

export async function GET(request: Request): Promise<Response> {
  try {
    await requireAuthenticatedActor(request);
    const url = new URL(request.url);
    const input = operationsOverviewQuery.parse({
      tenantId: url.searchParams.get('tenantId'),
      stationId: url.searchParams.get('stationId'),
      businessDayId: url.searchParams.get('businessDayId') ?? undefined,
    });
    return NextResponse.json(await getOperationsOverviewFromRequest(request, input), {
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
    console.error('operations overview read failed', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
