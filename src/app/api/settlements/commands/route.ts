import { NextResponse } from 'next/server';
import { requireAuthenticatedActor } from '../../../../modules/identity';
import {
  allocateProviderSettlementFromRequest,
  assertSettlementCommandType,
  configureProviderAccountFromRequest,
  createBankAccountFromRequest,
  createPaymentProviderFromRequest,
  recordProviderSettlementFromRequest,
  reconcileProviderSettlementFromRequest,
  reverseProviderSettlementAllocationFromRequest,
} from '../../../../modules/settlements/commands';
import { apiErrorResponse, withRequestObservability } from '../../../../platform/observability';
import { WRITE_RATE_LIMIT, withPersistentRateLimit } from '../../../../platform/security';

function response(body: unknown, status = 200): Response {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export const POST = withRequestObservability(
  withPersistentRateLimit(async (request: Request): Promise<Response> => {
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
        case 'CreateBankAccount':
          return response(await createBankAccountFromRequest(request, body), 201);
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
      return apiErrorResponse(request, error, {
        includeDetails: true,
        headers: { 'Cache-Control': 'no-store' },
      });
    }
  }, WRITE_RATE_LIMIT),
);
