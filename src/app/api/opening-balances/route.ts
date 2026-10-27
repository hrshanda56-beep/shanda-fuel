import { NextResponse } from 'next/server';
import { requireAuthenticatedActor } from '../../../modules/identity';
import {
  approveOpeningBalanceBatchFromRequest,
  createOpeningBalanceBatchFromRequest,
  lockOpeningBalanceBatchFromRequest,
  previewOpeningBalanceImportFromRequest,
} from '../../../modules/opening-balances/commands';
import {
  getOpeningBalanceBatchFromRequest,
  listOpeningBalanceBatchesFromRequest,
} from '../../../modules/opening-balances/queries';
import { AppError } from '../../../platform/errors';
import { apiErrorResponse, withRequestObservability } from '../../../platform/observability';
import { WRITE_RATE_LIMIT, withPersistentRateLimit } from '../../../platform/security';

function json(body: unknown, status = 200): Response {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export const GET = withRequestObservability(async (request: Request): Promise<Response> => {
  try {
    await requireAuthenticatedActor(request);
    const params = new URL(request.url).searchParams;
    const tenantId = params.get('tenantId');
    if (!tenantId) throw new AppError('VALIDATION_FAILED', 'tenantId is required');
    const batchId = params.get('batchId');
    return json(
      batchId
        ? await getOpeningBalanceBatchFromRequest(request, tenantId, batchId)
        : await listOpeningBalanceBatchesFromRequest(request, tenantId),
    );
  } catch (error) {
    return apiErrorResponse(request, error, {
      includeDetails: true,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
});

export const POST = withRequestObservability(
  withPersistentRateLimit(async (request: Request): Promise<Response> => {
    try {
      await requireAuthenticatedActor(request);
      let body: unknown;
      const contentType = request.headers.get('content-type') ?? '';
      if (contentType.toLowerCase().startsWith('text/csv')) {
        body = {
          commandType: 'PreviewOpeningBalanceImport',
          tenantId: new URL(request.url).searchParams.get('tenantId'),
          csv: await request.text(),
        };
      } else {
        body = await request.json();
      }
      const commandType =
        typeof body === 'object' && body !== null && 'commandType' in body
          ? (body as { commandType?: unknown }).commandType
          : undefined;
      switch (commandType) {
        case 'PreviewOpeningBalanceImport':
          return json(await previewOpeningBalanceImportFromRequest(request, body));
        case 'CreateOpeningBalanceBatch':
          return json(await createOpeningBalanceBatchFromRequest(request, body), 201);
        case 'ApproveOpeningBalanceBatch':
          return json(await approveOpeningBalanceBatchFromRequest(request, body));
        case 'LockOpeningBalanceBatch':
          return json(await lockOpeningBalanceBatchFromRequest(request, body));
        default:
          throw new AppError(
            'VALIDATION_FAILED',
            'A supported opening balance commandType is required',
          );
      }
    } catch (error) {
      return apiErrorResponse(request, error, {
        includeDetails: true,
        headers: { 'Cache-Control': 'no-store' },
      });
    }
  }, WRITE_RATE_LIMIT),
);
