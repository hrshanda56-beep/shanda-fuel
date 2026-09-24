import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { AppError } from '../../../../platform/errors';
import { getManagementReportFromRequest } from '../../../../modules/reporting/queries';

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    return NextResponse.json(
      await getManagementReportFromRequest(request, Object.fromEntries(url.searchParams.entries())),
      { headers: { 'Cache-Control': 'no-store' } },
    );
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
    console.error('management report read failed', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
