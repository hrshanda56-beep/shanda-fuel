import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { AppError } from '../../../../platform/errors';
import { sealMeterSegmentFromRequest } from '../../../../modules/forecourt/commands';

export async function POST(request: Request): Promise<Response> {
  try {
    const body: unknown = await request.json();
    const result = await sealMeterSegmentFromRequest(request, body);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: 'VALIDATION_FAILED', issues: error.issues },
        { status: 400 },
      );
    }
    if (error instanceof AppError) {
      return NextResponse.json(
        { error: error.code, message: error.message, details: error.details },
        { status: error.httpStatus },
      );
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
