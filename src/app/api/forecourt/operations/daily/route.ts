import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { AppError } from '../../../../../platform/errors';
import { requireAuthenticatedActor } from '../../../../../modules/identity';
import {
  dailyOperationsQuery,
  getDailyOperationsContextFromRequest,
} from '../../../../../modules/forecourt/daily-operations';

export async function GET(request: Request): Promise<Response> {
  try {
    await requireAuthenticatedActor(request);
    const url = new URL(request.url);
    const input = dailyOperationsQuery.parse({
      tenantId: url.searchParams.get('tenantId'),
      stationId: url.searchParams.get('stationId'),
      businessDayId: url.searchParams.get('businessDayId'),
      shiftId: url.searchParams.get('shiftId'),
    });
    return NextResponse.json(await getDailyOperationsContextFromRequest(request, input), {
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
    console.error('daily operations context read failed', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
