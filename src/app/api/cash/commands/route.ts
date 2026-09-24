import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { AppError } from '../../../../platform/errors';
import { requireAuthenticatedActor } from '../../../../modules/identity';
import {
  assertCashCommandType,
  confirmBankDepositFromRequest,
  createBankDepositFromRequest,
  receiveCashCollectionFromRequest,
  recordCashCollectionFromRequest,
} from '../../../../modules/cash/commands';

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
    switch (assertCashCommandType(commandType)) {
      case 'RecordCashCollection':
        return response(await recordCashCollectionFromRequest(request, body), 201);
      case 'ReceiveCashCollection':
        return response(await receiveCashCollectionFromRequest(request, body));
      case 'CreateBankDeposit':
        return response(await createBankDepositFromRequest(request, body), 201);
      case 'ConfirmBankDeposit':
        return response(await confirmBankDepositFromRequest(request, body));
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
    console.error('cash command failed', error);
    return response({ error: 'INTERNAL_ERROR' }, 500);
  }
}
