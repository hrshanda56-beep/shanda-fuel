import { NextResponse } from 'next/server';
import { requireAuthenticatedActor } from '../../../modules/identity';
import {
  adjustApprovedLiabilityFromRequest,
  recordApprovedLiabilityFromRequest,
} from '../../../modules/liabilities/commands';
import { listApprovedLiabilitiesFromRequest } from '../../../modules/liabilities/queries';
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
    return json(
      await listApprovedLiabilitiesFromRequest(request, {
        tenantId,
        legalEntityId: params.get('legalEntityId') ?? undefined,
        stationId: params.get('stationId') ?? undefined,
        asOfDate: params.get('asOfDate') ?? undefined,
      }),
    );
  } catch (error) {
    return apiErrorResponse(request, error, { includeDetails: true, headers: { 'Cache-Control': 'no-store' } });
  }
});

export const POST = withRequestObservability(
  withPersistentRateLimit(async (request: Request): Promise<Response> => {
    try {
      await requireAuthenticatedActor(request);
      const body = await request.json();
      const commandType =
        typeof body === 'object' && body !== null && 'commandType' in body
          ? (body as { commandType?: unknown }).commandType
          : undefined;
      if (commandType === 'RecordApprovedLiability') {
        return json(await recordApprovedLiabilityFromRequest(request, body), 201);
      }
      if (commandType === 'AdjustApprovedLiability' || commandType === 'ReverseApprovedLiability') {
        return json(await adjustApprovedLiabilityFromRequest(request, body));
      }
      throw new AppError('VALIDATION_FAILED', 'A supported liability commandType is required');
    } catch (error) {
      return apiErrorResponse(request, error, { includeDetails: true, headers: { 'Cache-Control': 'no-store' } });
    }
  }, WRITE_RATE_LIMIT),
);
