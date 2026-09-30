import { NextResponse } from 'next/server';
import { requireAuthenticatedActor } from '../../../../modules/identity';
import {
  assertCashCommandType,
  confirmBankDepositFromRequest,
  createBankDepositFromRequest,
  receiveCashCollectionFromRequest,
  recordCashCollectionFromRequest,
} from '../../../../modules/cash/commands';
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
      return apiErrorResponse(request, error, {
        includeDetails: true,
        headers: { 'Cache-Control': 'no-store' },
      });
    }
  }, WRITE_RATE_LIMIT),
);
