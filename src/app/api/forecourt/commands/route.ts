import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { AppError } from '../../../../platform/errors';
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
  handoverAttendantFromRequest,
  lockBusinessDayFromRequest,
  lockReconciliationFromRequest,
  markNotOperatedFromRequest,
  openBusinessDayFromRequest,
  postReconciliationFromRequest,
  requestPriceChangeFromRequest,
  replaceMeterFromRequest,
  resetMeterFromRequest,
  returnReconciliationFromRequest,
  sealMeterSegmentFromRequest,
  startShiftFromRequest,
  submitReconciliationFromRequest,
} from '../../../../modules/forecourt/commands';

export async function POST(request: Request): Promise<Response> {
  try {
    const body: unknown = await request.json();
    const commandType =
      typeof body === 'object' && body !== null && 'commandType' in body
        ? body.commandType
        : 'SealSegment';
    const result =
      commandType === 'HandoverAttendant'
        ? await handoverAttendantFromRequest(request, body)
        : commandType === 'ApprovePriceChange'
          ? await approvePriceChangeFromRequest(request, body)
          : commandType === 'ActivatePriceChange'
            ? await activatePriceChangeFromRequest(request, body)
            : commandType === 'OpenBusinessDay'
              ? await openBusinessDayFromRequest(request, body)
              : commandType === 'CloseBusinessDay'
                ? await closeBusinessDayFromRequest(request, body)
                : commandType === 'StartShift'
                  ? await startShiftFromRequest(request, body)
                  : commandType === 'ConfirmBoundary'
                    ? await confirmBoundaryFromRequest(request, body)
                    : commandType === 'ConfirmPriceChangeBoundary'
                      ? await confirmBoundaryFromRequest(request, body)
                      : commandType === 'ResetMeter'
                        ? await resetMeterFromRequest(request, body)
                        : commandType === 'ReplaceMeter'
                          ? await replaceMeterFromRequest(request, body)
                          : commandType === 'CorrectMeterSegment'
                            ? await correctMeterSegmentFromRequest(request, body)
                            : commandType === 'ReportMeterUnavailable'
                              ? await confirmBoundaryFromRequest(request, body)
                              : commandType === 'ResolveMeterException'
                                ? await confirmBoundaryFromRequest(request, body)
                                : commandType === 'CloseMeters'
                                  ? await closeMetersFromRequest(request, body)
                                  : commandType === 'CompleteShift'
                                    ? await completeShiftFromRequest(request, body)
                                    : commandType === 'MarkNotOperated'
                                      ? await markNotOperatedFromRequest(request, body)
                                      : commandType === 'RequestPriceChange'
                                        ? await requestPriceChangeFromRequest(request, body)
                                        : commandType === 'SubmitReconciliation'
                                          ? await submitReconciliationFromRequest(request, body)
                                          : commandType === 'ReturnReconciliation'
                                            ? await returnReconciliationFromRequest(request, body)
                                            : commandType ===
                                                'CreateCorrectedReconciliationRevision'
                                              ? await createCorrectedReconciliationRevisionFromRequest(
                                                  request,
                                                  body,
                                                )
                                              : commandType === 'ApproveReconciliation'
                                                ? await approveReconciliationFromRequest(
                                                    request,
                                                    body,
                                                  )
                                                : commandType === 'PostReconciliation'
                                                  ? await postReconciliationFromRequest(
                                                      request,
                                                      body,
                                                    )
                                                  : commandType === 'LockReconciliation'
                                                    ? await lockReconciliationFromRequest(
                                                        request,
                                                        body,
                                                      )
                                                    : commandType === 'LockBusinessDay'
                                                      ? await lockBusinessDayFromRequest(
                                                          request,
                                                          body,
                                                        )
                                                      : await sealMeterSegmentFromRequest(
                                                          request,
                                                          body,
                                                        );
    return NextResponse.json(result, { status: commandType === 'SealSegment' ? 201 : 200 });
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
    console.error('forecourt command failed', error);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
