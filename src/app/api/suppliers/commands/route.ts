import { NextResponse } from 'next/server';
import { requireAuthenticatedActor } from '../../../../modules/identity';
import {
  allocateSupplierPaymentFromRequest,
  assertSupplierCommandType,
  createSupplierFromRequest,
  postSupplierDocumentFromRequest,
  postSupplierPaymentFromRequest,
  reverseSupplierDocumentFromRequest,
  reverseSupplierPaymentFromRequest,
  setPurchasingPolicyFromRequest,
  setSupplierCreditLimitFromRequest,
  submitSupplierDocumentFromRequest,
  submitSupplierPaymentFromRequest,
} from '../../../../modules/creditors/commands';
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
      switch (assertSupplierCommandType(commandType)) {
        case 'CreateSupplier':
          return response(await createSupplierFromRequest(request, body), 201);
        case 'SubmitSupplierDocument':
          return response(await submitSupplierDocumentFromRequest(request, body), 201);
        case 'PostSupplierDocument':
          return response(await postSupplierDocumentFromRequest(request, body));
        case 'ReverseSupplierDocument':
          return response(await reverseSupplierDocumentFromRequest(request, body));
        case 'SubmitSupplierPayment':
          return response(await submitSupplierPaymentFromRequest(request, body), 201);
        case 'PostSupplierPayment':
          return response(await postSupplierPaymentFromRequest(request, body));
        case 'AllocateSupplierPayment':
          return response(await allocateSupplierPaymentFromRequest(request, body));
        case 'ReverseSupplierPayment':
          return response(await reverseSupplierPaymentFromRequest(request, body));
        case 'SetPurchasingPolicy':
          return response(await setPurchasingPolicyFromRequest(request, body));
        case 'SetSupplierCreditLimit':
          return response(await setSupplierCreditLimitFromRequest(request, body));
      }
    } catch (error) {
      return apiErrorResponse(request, error, {
        includeDetails: true,
        headers: { 'Cache-Control': 'no-store' },
      });
    }
  }, WRITE_RATE_LIMIT),
);
