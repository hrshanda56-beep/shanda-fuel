import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { AppError } from '../../../../platform/errors';
import { requireAuthenticatedActor } from '../../../../modules/identity';
import {
  allocateProviderSettlementFromRequest,
  assertSettlementCommandType,
  configureProviderAccountFromRequest,
  createPaymentProviderFromRequest,
  recordProviderSettlementFromRequest,
  reconcileProviderSettlementFromRequest,
  reverseProviderSettlementAllocationFromRequest,
} from '../../../../modules/settlements/commands';

function response(body: unknown, status = 200): Response {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function POST(request: Request): Promise<Response> {
  try {
    await requireAuthenticatedActor(request);
    const body: unknown = await request.json();
    const commandType =
      typeof body === 'object' && body !== null && 'commandType' in body
        ? (body as { commandType: unknown }).commandType
        : undefined;
    switch (assertSettlementCommandType(commandType)) {
      case 'CreatePaymentProvider':
        return response(await createPaymentProviderFromRequest(request, body), 201);
      case 'ConfigureProviderAccount':
        return response(await configureProviderAccountFromRequest(request, body), 201);
      case 'RecordProviderSettlement':
        return response(await recordProviderSettlementFromRequest(request, body), 201);
      case 'AllocateProviderSettlement':
        return response(await allocateProviderSettlementFromRequest(request, body), 201);
      case 'ReverseProviderSettlementAllocation':
        return response(await reverseProviderSettlementAllocationFromRequest(request, body), 201);
      case 'ReconcileProviderSettlement':
        return response(await reconcileProviderSettlementFromRequest(request, body));
    }
  } catch (error) {
    if (error instanceof ZodError) {
      return response({ error: 'VALIDATION_FAILED', issues: error.issues }, 400);
    }
    if (error instanceof AppError) {
      return response(
        { error: error.code, message: error.message, details: error.details },
        error.httpStatus,
      );
    }
    console.error('settlement command failed', error);
    return response({ error: 'INTERNAL_ERROR' }, 500);
  }
}
