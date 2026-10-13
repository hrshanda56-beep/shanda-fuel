import { NextResponse } from 'next/server';
import { requireAuthenticatedActor } from '../../../../modules/identity';
import {
  assertSetupCommandType,
  createNozzleFromRequest,
  createProductFromRequest,
  createPumpFromRequest,
  draftPriceChangeFromRequest,
  updateSupplierFromRequest,
} from '../../../../modules/setup';
import { apiErrorResponse, withRequestObservability } from '../../../../platform/observability';
import { WRITE_RATE_LIMIT, withPersistentRateLimit } from '../../../../platform/security';

export const POST = withRequestObservability(
  withPersistentRateLimit(async (request: Request): Promise<Response> => {
    try {
      await requireAuthenticatedActor(request);
      const body: unknown = await request.json();
      const commandType =
        typeof body === 'object' && body !== null && 'commandType' in body
          ? (body as { commandType?: unknown }).commandType
          : undefined;
      let result: unknown;
      switch (assertSetupCommandType(commandType)) {
        case 'CreateProduct':
          result = await createProductFromRequest(request, body);
          break;
        case 'CreatePump':
          result = await createPumpFromRequest(request, body);
          break;
        case 'CreateNozzle':
          result = await createNozzleFromRequest(request, body);
          break;
        case 'DraftPriceChange':
          result = await draftPriceChangeFromRequest(request, body);
          break;
        case 'UpdateSupplier':
          result = await updateSupplierFromRequest(request, body);
          break;
      }
      return NextResponse.json(result, { status: 200, headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      return apiErrorResponse(request, error, {
        includeDetails: true,
        headers: { 'Cache-Control': 'no-store' },
      });
    }
  }, WRITE_RATE_LIMIT),
);
