import { NextResponse } from 'next/server';
import { requireAuthenticatedActor } from '../../../../modules/identity';
import {
  assertCustomerCommandType,
  authorizeCustomerFuelFromRequest,
  cancelCustomerFuelAuthorizationFromRequest,
  completeCustomerFuelTransactionFromRequest,
  createCustomerAccountFromRequest,
  createCustomerFromRequest,
  expireCustomerFuelAuthorizationFromRequest,
  recordCustomerPaymentFromRequest,
  recordPrepaidTopUpFromRequest,
  requestCustomerFuelAuthorizationFromRequest,
} from '../../../../modules/customers/commands';
import { apiErrorResponse, withRequestObservability } from '../../../../platform/observability';

function response(body: unknown, status = 200): Response {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export const POST = withRequestObservability(async (request: Request): Promise<Response> => {
  try {
    await requireAuthenticatedActor(request);
    const body: unknown = await request.json();
    const commandType =
      typeof body === 'object' && body !== null && 'commandType' in body
        ? (body as { commandType: unknown }).commandType
        : undefined;
    switch (assertCustomerCommandType(commandType)) {
      case 'CreateCustomer':
        return response(await createCustomerFromRequest(request, body), 201);
      case 'CreateCustomerAccount':
        return response(await createCustomerAccountFromRequest(request, body), 201);
      case 'RecordCustomerPayment':
        return response(await recordCustomerPaymentFromRequest(request, body), 201);
      case 'RecordPrepaidTopUp':
        return response(await recordPrepaidTopUpFromRequest(request, body), 201);
      case 'RequestCustomerFuelAuthorization':
        return response(await requestCustomerFuelAuthorizationFromRequest(request, body), 201);
      case 'AuthorizeCustomerFuel':
        return response(await authorizeCustomerFuelFromRequest(request, body));
      case 'CompleteCustomerFuelTransaction':
        return response(await completeCustomerFuelTransactionFromRequest(request, body));
      case 'CancelCustomerFuelAuthorization':
        return response(await cancelCustomerFuelAuthorizationFromRequest(request, body));
      case 'ExpireCustomerFuelAuthorization':
        return response(await expireCustomerFuelAuthorizationFromRequest(request, body));
    }
  } catch (error) {
    return apiErrorResponse(request, error, {
      includeDetails: true,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
});
