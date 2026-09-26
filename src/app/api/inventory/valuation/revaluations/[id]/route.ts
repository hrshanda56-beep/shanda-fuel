import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { requireAuthenticatedActor } from '../../../../../../modules/identity';
import { getInventoryRevaluationReadModel } from '../../../../../../modules/costing/queries';
import { AppError } from '../../../../../../platform/errors';

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    await requireAuthenticatedActor(request);
    const { id } = await params;
    const url = new URL(request.url);
    return json(
      await getInventoryRevaluationReadModel(request, {
        tenantId: url.searchParams.get('tenantId'),
        stationId: url.searchParams.get('stationId'),
        revaluationId: id,
      }),
      200,
    );
  } catch (error) {
    if (error instanceof ZodError)
      return json({ error: 'VALIDATION_FAILED', issues: error.issues }, 400);
    if (error instanceof AppError)
      return json(
        { error: error.code, message: error.message, details: error.details },
        error.httpStatus,
      );
    console.error('inventory revaluation read model failed', error);
    return json(
      { error: 'INTERNAL_ERROR', message: 'The revaluation detail could not be loaded.' },
      500,
    );
  }
}
