import { NextResponse } from 'next/server';
import { requireAuthenticatedActor } from '../../../../modules/identity';
import {
  assertCashCommandType,
  cancelHandoverFromRequest,
  confirmBankDepositFromRequest,
  countCashFromRequest,
  createBankDepositFromRequest,
  disputeHandoverFromRequest,
  prepareHandoverFromRequest,
  receiverConfirmHandoverFromRequest,
  receiveCashCollectionFromRequest,
  recordCashCollectionFromRequest,
  resolveHandoverDisputeFromRequest,
  senderConfirmHandoverFromRequest,
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
        case 'CountCash':
          return response(await countCashFromRequest(request, body), 201);
        case 'PrepareHandover':
          return response(await prepareHandoverFromRequest(request, body), 201);
        case 'SenderConfirmHandover':
          return response(await senderConfirmHandoverFromRequest(request, body));
        case 'ReceiverConfirmHandover':
          return response(await receiverConfirmHandoverFromRequest(request, body));
        case 'DisputeHandover':
          return response(await disputeHandoverFromRequest(request, body));
        case 'ResolveHandoverDispute':
          return response(await resolveHandoverDisputeFromRequest(request, body));
        case 'CancelHandover':
          return response(await cancelHandoverFromRequest(request, body));
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
