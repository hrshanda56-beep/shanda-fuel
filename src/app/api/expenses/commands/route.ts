import { NextResponse } from 'next/server';
import { requireAuthenticatedActor } from '../../../../modules/identity';
import {
  approveExpenseFromRequest,
  assertExpenseCommandType,
  createRecurringExpenseTemplateFromRequest,
  deactivateRecurringExpenseTemplateFromRequest,
  generateRecurringCostPeriodFromRequest,
  postExpenseFromRequest,
  rejectExpenseFromRequest,
  returnExpenseFromRequest,
  reverseExpenseFromRequest,
  submitExpenseFromRequest,
  updateRecurringExpenseTemplateFromRequest,
} from '../../../../modules/expenses';
import { apiErrorResponse, withRequestObservability } from '../../../../platform/observability';
import { WRITE_RATE_LIMIT, withPersistentRateLimit } from '../../../../platform/security';

function response(body: unknown, status = 200): Response {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
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

      switch (assertExpenseCommandType(commandType)) {
        case 'SubmitExpense':
          return response(await submitExpenseFromRequest(request, body), 201);
        case 'ReturnExpense':
          return response(await returnExpenseFromRequest(request, body));
        case 'ApproveExpense':
          return response(await approveExpenseFromRequest(request, body));
        case 'RejectExpense':
          return response(await rejectExpenseFromRequest(request, body));
        case 'PostExpense':
          return response(await postExpenseFromRequest(request, body));
        case 'ReverseExpense':
          return response(await reverseExpenseFromRequest(request, body));
        case 'CreateRecurringExpenseTemplate':
          return response(await createRecurringExpenseTemplateFromRequest(request, body), 201);
        case 'UpdateRecurringExpenseTemplate':
          return response(await updateRecurringExpenseTemplateFromRequest(request, body));
        case 'DeactivateRecurringExpenseTemplate':
          return response(await deactivateRecurringExpenseTemplateFromRequest(request, body));
        case 'GenerateRecurringCostPeriod':
          return response(await generateRecurringCostPeriodFromRequest(request, body), 201);
      }
    } catch (error) {
      return apiErrorResponse(request, error, {
        includeDetails: true,
        headers: { 'Cache-Control': 'no-store' },
      });
    }
  }, WRITE_RATE_LIMIT),
);
