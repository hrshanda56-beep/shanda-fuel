import { NextResponse } from 'next/server';
import { requireAuthenticatedActor } from '../../../../modules/identity';
import { runSettingsCommandFromRequest } from '../../../../modules/settings/commands';
import { AppError } from '../../../../platform/errors';
import { apiErrorResponse, withRequestObservability } from '../../../../platform/observability';
import { WRITE_RATE_LIMIT, withPersistentRateLimit } from '../../../../platform/security';

export const POST = withRequestObservability(
  withPersistentRateLimit(async (request: Request): Promise<Response> => {
    try {
      await requireAuthenticatedActor(request);
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        throw new AppError(
          'VALIDATION_FAILED',
          'The request could not be read. Reload the page and try again.',
        );
      }
      return NextResponse.json(await runSettingsCommandFromRequest(request, body), {
        status: 201,
        headers: { 'Cache-Control': 'no-store' },
      });
    } catch (error) {
      return apiErrorResponse(request, error, {
        includeDetails: true,
        headers: { 'Cache-Control': 'no-store' },
      });
    }
  }, WRITE_RATE_LIMIT),
);
