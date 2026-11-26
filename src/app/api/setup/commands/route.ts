import { NextResponse } from 'next/server';
import { requireAuthenticatedActor } from '../../../../modules/identity';
import {
  assertSetupCommandType,
  createCashLocationFromRequest,
  createNozzleFromRequest,
  createProductFromRequest,
  deleteProductFromRequest,
  deleteNozzleFromRequest,
  deletePumpFromRequest,
  renameProductFromRequest,
  setProductUnitFromRequest,
  setProductStatusFromRequest,
  createPumpFromRequest,
  draftPriceChangeFromRequest,
  recordBankBalanceFromRequest,
  setAlertSettingsFromRequest,
  setMeterWorkingSinceFromRequest,
  setProductKindFromRequest,
  setResponsibleSupervisorFromRequest,
  updateNozzleFromRequest,
  updatePumpFromRequest,
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
        case 'RenameProduct':
          result = await renameProductFromRequest(request, body);
          break;
        case 'SetProductUnit':
          result = await setProductUnitFromRequest(request, body);
          break;
        case 'SetProductStatus':
          result = await setProductStatusFromRequest(request, body);
          break;
        case 'DeleteProduct':
          result = await deleteProductFromRequest(request, body);
          break;
        case 'CreateCashLocation':
          result = await createCashLocationFromRequest(request, body);
          break;
        case 'SetProductKind':
          result = await setProductKindFromRequest(request, body);
          break;
        case 'CreatePump':
          result = await createPumpFromRequest(request, body);
          break;
        case 'CreateNozzle':
          result = await createNozzleFromRequest(request, body);
          break;
        case 'UpdatePump':
          result = await updatePumpFromRequest(request, body);
          break;
        case 'UpdateNozzle':
          result = await updateNozzleFromRequest(request, body);
          break;
        case 'DeletePump':
          result = await deletePumpFromRequest(request, body);
          break;
        case 'DeleteNozzle':
          result = await deleteNozzleFromRequest(request, body);
          break;
        case 'SetMeterWorkingSince':
          result = await setMeterWorkingSinceFromRequest(request, body);
          break;
        case 'DraftPriceChange':
          result = await draftPriceChangeFromRequest(request, body);
          break;
        case 'UpdateSupplier':
          result = await updateSupplierFromRequest(request, body);
          break;
        case 'SetResponsibleSupervisor':
          result = await setResponsibleSupervisorFromRequest(request, body);
          break;
        case 'SetAlertSettings':
          result = await setAlertSettingsFromRequest(request, body);
          break;
        case 'RecordBankBalance':
          result = await recordBankBalanceFromRequest(request, body);
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
