import { NextResponse } from 'next/server';
import { requireAuthenticatedActor } from '../../../../modules/identity';
import {
  assertCustomerCommandType,
  authorizeCustomerFuelFromRequest,
  activateCustomerFromRequest,
  cancelCustomerFuelAuthorizationFromRequest,
  completeCustomerFuelTransactionFromRequest,
  createCustomerAccountFromRequest,
  createCustomerFromRequest,
  deactivateCustomerFromRequest,
  expireCustomerFuelAuthorizationFromRequest,
  recordCustomerPaymentFromRequest,
  recordPrepaidTopUpFromRequest,
  requestCustomerFuelAuthorizationFromRequest,
  setCustomerAccountStationsFromRequest,
  setCustomerLegalEntityFromRequest,
  updateCustomerFromRequest,
} from '../../../../modules/customers/commands';
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
      switch (assertCustomerCommandType(commandType)) {
        case 'CreateCustomer':
          return response(await createCustomerFromRequest(request, body), 201);
        case 'UpdateCustomer':
          return response(await updateCustomerFromRequest(request, body));
        case 'ActivateCustomer':
          return response(await activateCustomerFromRequest(request, body));
        case 'DeactivateCustomer':
          return response(await deactivateCustomerFromRequest(request, body));
        case 'CreateCustomerAccount':
          return response(await createCustomerAccountFromRequest(request, body), 201);
        case 'SetCustomerLegalEntity':
          return response(await setCustomerLegalEntityFromRequest(request, body));
        case 'SetCustomerAccountStations':
          return response(await setCustomerAccountStationsFromRequest(request, body));
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
  }, WRITE_RATE_LIMIT),
);
