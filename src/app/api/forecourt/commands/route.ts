import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { AppError } from '../../../../platform/errors';
import { requireAuthenticatedActor } from '../../../../modules/identity';
import {
  authorizeForecourtCommandPreflight,
  type ForecourtCommandType,
} from '../../../../modules/forecourt/application';
import { loadForecourtStation } from '../../../../modules/forecourt/persistence';
import {
  activatePriceChangeFromRequest,
  approvePriceChangeFromRequest,
  approveReconciliationFromRequest,
  closeMetersFromRequest,
  closeBusinessDayFromRequest,
  completeShiftFromRequest,
  confirmBoundaryFromRequest,
  correctMeterSegmentFromRequest,
  createCorrectedReconciliationRevisionFromRequest,
  createReconciliationFromRequest,
  defineShiftTemplateFromRequest,
  handoverAttendantFromRequest,
  lockBusinessDayFromRequest,
  lockReconciliationFromRequest,
  markNotOperatedFromRequest,
  openBusinessDayFromRequest,
  postReconciliationFromRequest,
  preparePriceActivationFromRequest,
  requestPriceChangeFromRequest,
  replaceMeterFromRequest,
  resetMeterFromRequest,
  returnReconciliationFromRequest,
  sealMeterSegmentFromRequest,
  startShiftFromRequest,
  submitReconciliationFromRequest,
} from '../../../../modules/forecourt/commands';
import {
  approveProductionReconciliationFromRequest,
  createProductionReconciliationFromRequest,
  linkReconciliationDeliveriesFromRequest,
  linkReconciliationDipsFromRequest,
  returnProductionReconciliationFromRequest,
  saveReconciliationCashFromRequest,
  saveReconciliationDraftFromRequest,
  saveReconciliationExplanationsFromRequest,
  saveReconciliationExpensesFromRequest,
  saveReconciliationMeterReadingsFromRequest,
  saveReconciliationPaymentsFromRequest,
  setReconciliationAttendantsFromRequest,
  submitProductionReconciliationFromRequest,
} from '../../../../modules/forecourt/production-reconciliation';

/**
 * The exhaustive set of forecourt command types this route can dispatch.
 * Every literal here MUST have a corresponding `case` in the switch below --
 * the `default` branch's `never` assertion makes the compiler enforce this,
 * so a newly added command type that is not wired into the switch fails to
 * build rather than silently falling through to an unrelated command.
 */
const COMMAND_TYPES = [
  'SealSegment',
  'HandoverAttendant',
  'DefineShiftTemplate',
  'ApprovePriceChange',
  'PreparePriceActivation',
  'ActivatePriceChange',
  'OpenBusinessDay',
  'CloseBusinessDay',
  'StartShift',
  'ConfirmBoundary',
  'ConfirmPriceChangeBoundary',
  'ResetMeter',
  'ReplaceMeter',
  'CorrectMeterSegment',
  'ReportMeterUnavailable',
  'ResolveMeterException',
  'CloseMeters',
  'CompleteShift',
  'MarkNotOperated',
  'RequestPriceChange',
  'CreateReconciliation',
  'SubmitReconciliation',
  'ReturnReconciliation',
  'CreateCorrectedReconciliationRevision',
  'ApproveReconciliation',
  'PostReconciliation',
  'LockReconciliation',
  'LockBusinessDay',
  'CreateProductionReconciliation',
  'SaveReconciliationDraft',
  'SetAttendants',
  'SaveMeterReadings',
  'SavePaymentAllocations',
  'SaveExpenses',
  'LinkDeliveries',
  'LinkTankDips',
  'SaveCashDeclaration',
  'SaveVarianceExplanations',
  'SubmitProductionReconciliation',
  'ReturnProductionReconciliation',
  'ApproveProductionReconciliation',
] as const;

type CommandType = (typeof COMMAND_TYPES)[number];

const COMMAND_TYPE_SET: ReadonlySet<string> = new Set(COMMAND_TYPES);

function isCommandType(value: unknown): value is CommandType {
  return typeof value === 'string' && COMMAND_TYPE_SET.has(value);
}

function readCommandType(body: unknown): unknown {
  return typeof body === 'object' && body !== null && 'commandType' in body
    ? (body as { commandType: unknown }).commandType
    : undefined;
}

function jsonResponse(body: unknown, status: number): Response {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function POST(request: Request): Promise<Response> {
  try {
    await requireAuthenticatedActor(request);
    const body: unknown = await request.json();
    const rawCommandType = readCommandType(body);
    if (!isCommandType(rawCommandType)) {
      throw new AppError(
        'VALIDATION_FAILED',
        'commandType is required and must reference a supported forecourt command',
        { commandType: rawCommandType ?? null },
      );
    }
    const commandType = rawCommandType;
    await authorizeForecourtCommandPreflight({
      request,
      commandType: commandType as ForecourtCommandType,
      body,
      loadStation: loadForecourtStation,
    });
    let result: unknown;
    switch (commandType) {
      case 'SealSegment':
        result = await sealMeterSegmentFromRequest(request, body);
        break;
      case 'HandoverAttendant':
        result = await handoverAttendantFromRequest(request, body);
        break;
      case 'DefineShiftTemplate':
        result = await defineShiftTemplateFromRequest(request, body);
        break;
      case 'ApprovePriceChange':
        result = await approvePriceChangeFromRequest(request, body);
        break;
      case 'PreparePriceActivation':
        result = await preparePriceActivationFromRequest(request, body);
        break;
      case 'ActivatePriceChange':
        result = await activatePriceChangeFromRequest(request, body);
        break;
      case 'OpenBusinessDay':
        result = await openBusinessDayFromRequest(request, body);
        break;
      case 'CloseBusinessDay':
        result = await closeBusinessDayFromRequest(request, body);
        break;
      case 'StartShift':
        result = await startShiftFromRequest(request, body);
        break;
      case 'ConfirmBoundary':
        result = await confirmBoundaryFromRequest(request, body);
        break;
      case 'ConfirmPriceChangeBoundary':
        result = await confirmBoundaryFromRequest(request, body);
        break;
      case 'ResetMeter':
        result = await resetMeterFromRequest(request, body);
        break;
      case 'ReplaceMeter':
        result = await replaceMeterFromRequest(request, body);
        break;
      case 'CorrectMeterSegment':
        result = await correctMeterSegmentFromRequest(request, body);
        break;
      case 'ReportMeterUnavailable':
        result = await confirmBoundaryFromRequest(request, body);
        break;
      case 'ResolveMeterException':
        result = await confirmBoundaryFromRequest(request, body);
        break;
      case 'CloseMeters':
        result = await closeMetersFromRequest(request, body);
        break;
      case 'CompleteShift':
        result = await completeShiftFromRequest(request, body);
        break;
      case 'MarkNotOperated':
        result = await markNotOperatedFromRequest(request, body);
        break;
      case 'RequestPriceChange':
        result = await requestPriceChangeFromRequest(request, body);
        break;
      case 'CreateReconciliation':
        result = await createReconciliationFromRequest(request, body);
        break;
      case 'SubmitReconciliation':
        result = await submitReconciliationFromRequest(request, body);
        break;
      case 'ReturnReconciliation':
        result = await returnReconciliationFromRequest(request, body);
        break;
      case 'CreateCorrectedReconciliationRevision':
        result = await createCorrectedReconciliationRevisionFromRequest(request, body);
        break;
      case 'ApproveReconciliation':
        result = await approveReconciliationFromRequest(request, body);
        break;
      case 'PostReconciliation':
        result = await postReconciliationFromRequest(request, body);
        break;
      case 'LockReconciliation':
        result = await lockReconciliationFromRequest(request, body);
        break;
      case 'LockBusinessDay':
        result = await lockBusinessDayFromRequest(request, body);
        break;
      case 'CreateProductionReconciliation':
        result = await createProductionReconciliationFromRequest(request, body);
        break;
      case 'SaveReconciliationDraft':
        result = await saveReconciliationDraftFromRequest(request, body);
        break;
      case 'SetAttendants':
        result = await setReconciliationAttendantsFromRequest(request, body);
        break;
      case 'SaveMeterReadings':
        result = await saveReconciliationMeterReadingsFromRequest(request, body);
        break;
      case 'SavePaymentAllocations':
        result = await saveReconciliationPaymentsFromRequest(request, body);
        break;
      case 'SaveExpenses':
        result = await saveReconciliationExpensesFromRequest(request, body);
        break;
      case 'LinkDeliveries':
        result = await linkReconciliationDeliveriesFromRequest(request, body);
        break;
      case 'LinkTankDips':
        result = await linkReconciliationDipsFromRequest(request, body);
        break;
      case 'SaveCashDeclaration':
        result = await saveReconciliationCashFromRequest(request, body);
        break;
      case 'SaveVarianceExplanations':
        result = await saveReconciliationExplanationsFromRequest(request, body);
        break;
      case 'SubmitProductionReconciliation':
        result = await submitProductionReconciliationFromRequest(request, body);
        break;
      case 'ReturnProductionReconciliation':
        result = await returnProductionReconciliationFromRequest(request, body);
        break;
      case 'ApproveProductionReconciliation':
        result = await approveProductionReconciliationFromRequest(request, body);
        break;
      default: {
        const exhaustiveCheck: never = commandType;
        throw new AppError(
          'VALIDATION_FAILED',
          `Unsupported commandType: ${String(exhaustiveCheck)}`,
        );
      }
    }
    return jsonResponse(result, commandType === 'SealSegment' ? 201 : 200);
  } catch (error) {
    if (error instanceof ZodError) {
      return jsonResponse({ error: 'VALIDATION_FAILED', issues: error.issues }, 400);
    }
    if (error instanceof AppError) {
      return jsonResponse(
        { error: error.code, message: error.message, details: error.details },
        error.httpStatus,
      );
    }
    console.error('forecourt command failed', error);
    return jsonResponse({ error: 'INTERNAL_ERROR' }, 500);
  }
}
