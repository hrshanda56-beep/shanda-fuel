import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { AppError } from '../../../../platform/errors';
import {
  activatePriceChangeFromRequest,
  approvePriceChangeFromRequest,
  approveReconciliationFromRequest,
  lockBusinessDayFromRequest,
  lockReconciliationFromRequest,
  postReconciliationFromRequest,
  sealMeterSegmentFromRequest,
} from '../../../../modules/forecourt/commands';

export async function POST(request: Request): Promise<Response> {
  try {
    const body: unknown = await request.json();
    const commandType =
      typeof body === 'object' && body !== null && 'commandType' in body
        ? body.commandType
        : 'SealSegment';
    const result =
      commandType === 'ApprovePriceChange'
        ? await approvePriceChangeFromRequest(request, body)
        : commandType === 'ActivatePriceChange'
          ? await activatePriceChangeFromRequest(request, body)
          : commandType === 'ApproveReconciliation'
            ? await approveReconciliationFromRequest(request, body)
            : commandType === 'PostReconciliation'
              ? await postReconciliationFromRequest(request, body)
              : commandType === 'LockReconciliation'
                ? await lockReconciliationFromRequest(request, body)
                : commandType === 'LockBusinessDay'
                  ? await lockBusinessDayFromRequest(request, body)
                  : await sealMeterSegmentFromRequest(request, body);
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
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
