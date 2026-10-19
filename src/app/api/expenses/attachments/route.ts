import { NextResponse } from 'next/server';
import { requireAuthenticatedActor } from '../../../../modules/identity';
import {
  MAX_EXPENSE_ATTACHMENT_BYTES,
  listExpenseAttachmentsFromRequest,
  uploadExpenseAttachmentFromRequest,
} from '../../../../modules/expenses/attachments';
import { AppError } from '../../../../platform/errors';
import { apiErrorResponse, withRequestObservability } from '../../../../platform/observability';
import { WRITE_RATE_LIMIT, withPersistentRateLimit } from '../../../../platform/security';

function json(body: unknown, status = 200): Response {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

const MAX_MULTIPART_REQUEST_BYTES = MAX_EXPENSE_ATTACHMENT_BYTES + 1024 * 1024;

function rejectDeclaredOversize(request: Request): void {
  const rawLength = request.headers.get('content-length');
  if (!rawLength) return;
  const length = Number(rawLength);
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new AppError('VALIDATION_FAILED', 'The attachment request size is invalid');
  }
  if (length > MAX_MULTIPART_REQUEST_BYTES) {
    throw new AppError('VALIDATION_FAILED', 'The attachment request is too large');
  }
}

function limitedMultipartRequest(request: Request): Request {
  if (!request.body) return request;
  let received = 0;
  const limitedBody = request.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        received += chunk.byteLength;
        if (received > MAX_MULTIPART_REQUEST_BYTES) {
          controller.error(
            new AppError('VALIDATION_FAILED', 'The attachment request is too large'),
          );
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
  const requestInit = { body: limitedBody, duplex: 'half' } as RequestInit;
  return new Request(request, requestInit);
}

export const POST = withRequestObservability(
  withPersistentRateLimit(async (request: Request): Promise<Response> => {
    try {
      await requireAuthenticatedActor(request);
      rejectDeclaredOversize(request);
      const limitedRequest = limitedMultipartRequest(request);
      return json(
        await uploadExpenseAttachmentFromRequest(limitedRequest, await limitedRequest.formData()),
        201,
      );
    } catch (error) {
      return apiErrorResponse(request, error, {
        includeDetails: true,
        headers: { 'Cache-Control': 'no-store' },
      });
    }
  }, WRITE_RATE_LIMIT),
);

export const GET = withRequestObservability(async (request: Request): Promise<Response> => {
  try {
    const url = new URL(request.url);
    return json(
      await listExpenseAttachmentsFromRequest(request, {
        tenantId: url.searchParams.get('tenantId'),
        stationId: url.searchParams.get('stationId'),
        expenseId: url.searchParams.get('expenseId'),
      }),
    );
  } catch (error) {
    return apiErrorResponse(request, error, {
      includeDetails: true,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
});
