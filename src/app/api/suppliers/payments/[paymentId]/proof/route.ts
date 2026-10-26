import { NextResponse } from 'next/server';
import { requireAuthenticatedActor } from '../../../../../../modules/identity';
import {
  listSupplierPaymentProofsFromRequest,
  uploadSupplierPaymentProofFromRequest,
} from '../../../../../../modules/creditors/payment-proofs';
import { MAX_DOCUMENT_BYTES } from '../../../../../../modules/documents/catalog';
import { AppError } from '../../../../../../platform/errors';
import {
  apiErrorResponse,
  withRequestObservability,
} from '../../../../../../platform/observability';
import { WRITE_RATE_LIMIT, withPersistentRateLimit } from '../../../../../../platform/security';

type RouteContext = { params: Promise<{ paymentId: string }> };

function json(body: unknown, status = 200): Response {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

const MAX_MULTIPART_REQUEST_BYTES = MAX_DOCUMENT_BYTES + 1024 * 1024;

function rejectDeclaredOversize(request: Request): void {
  const rawLength = request.headers.get('content-length');
  if (!rawLength) return;
  const length = Number(rawLength);
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new AppError('VALIDATION_FAILED', 'The upload size is invalid');
  }
  if (length > MAX_MULTIPART_REQUEST_BYTES) {
    throw new AppError('VALIDATION_FAILED', 'The file is too large. The limit is 10 MB.');
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
            new AppError('VALIDATION_FAILED', 'The file is too large. The limit is 10 MB.'),
          );
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
  return new Request(request, { body: limitedBody, duplex: 'half' } as RequestInit);
}

export const POST = withRequestObservability(
  async (request: Request, { params }: RouteContext): Promise<Response> => {
    const { paymentId } = await params;
    return withPersistentRateLimit(async (request: Request): Promise<Response> => {
      try {
        await requireAuthenticatedActor(request);
        rejectDeclaredOversize(request);
        const limited = limitedMultipartRequest(request);
        return json(
          await uploadSupplierPaymentProofFromRequest(request, paymentId, await limited.formData()),
          201,
        );
      } catch (error) {
        return apiErrorResponse(request, error, {
          includeDetails: true,
          headers: { 'Cache-Control': 'no-store' },
        });
      }
    }, WRITE_RATE_LIMIT)(request);
  },
);

export const GET = withRequestObservability(
  async (request: Request, { params }: RouteContext): Promise<Response> => {
    try {
      const { paymentId } = await params;
      const query = new URL(request.url).searchParams;
      return json(
        await listSupplierPaymentProofsFromRequest(request, paymentId, {
          tenantId: query.get('tenantId'),
          legalEntityId: query.get('legalEntityId'),
        }),
      );
    } catch (error) {
      return apiErrorResponse(request, error, {
        includeDetails: true,
        headers: { 'Cache-Control': 'no-store' },
      });
    }
  },
);
