import { NextResponse } from 'next/server';
import { requireAuthenticatedActor } from '../../../modules/identity';
import { MAX_DOCUMENT_BYTES } from '../../../modules/documents/catalog';
import {
  listDocumentsFromRequest,
  uploadDocumentFromRequest,
} from '../../../modules/documents/documents';
import { AppError } from '../../../platform/errors';
import { apiErrorResponse, withRequestObservability } from '../../../platform/observability';
import { WRITE_RATE_LIMIT, withPersistentRateLimit } from '../../../platform/security';

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

/** Counts the bytes as they arrive, so a lying Content-Length cannot get a big file through. */
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
  withPersistentRateLimit(async (request: Request): Promise<Response> => {
    try {
      await requireAuthenticatedActor(request);
      rejectDeclaredOversize(request);
      const limited = limitedMultipartRequest(request);
      return json(await uploadDocumentFromRequest(limited, await limited.formData()), 201);
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
    const params = new URL(request.url).searchParams;
    return json(
      await listDocumentsFromRequest(request, {
        tenantId: params.get('tenantId'),
        stationId: params.get('stationId'),
        subjectType: params.get('subjectType'),
        subjectId: params.get('subjectId'),
      }),
    );
  } catch (error) {
    return apiErrorResponse(request, error, {
      includeDetails: true,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
});
