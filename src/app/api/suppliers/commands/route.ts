import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { AppError } from '../../../../platform/errors';
import { requireAuthenticatedActor } from '../../../../modules/identity';
import {
  allocateSupplierPaymentFromRequest,
  assertSupplierCommandType,
  createSupplierFromRequest,
  postSupplierDocumentFromRequest,
  postSupplierPaymentFromRequest,
  reverseSupplierDocumentFromRequest,
  reverseSupplierPaymentFromRequest,
  submitSupplierDocumentFromRequest,
  submitSupplierPaymentFromRequest,
} from '../../../../modules/creditors/commands';

function response(body: unknown, status = 200): Response {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request): Promise<Response> {
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
    }
  } catch (error) {
    if (error instanceof ZodError)
      return response({ error: 'VALIDATION_FAILED', issues: error.issues }, 400);
    if (error instanceof AppError)
      return response(
        { error: error.code, message: error.message, details: error.details },
        error.httpStatus,
      );
    console.error('supplier command failed', error);
    return response({ error: 'INTERNAL_ERROR' }, 500);
  }
}
