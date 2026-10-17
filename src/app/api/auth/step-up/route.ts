import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  ClerkReverificationRequiredError,
  establishStepUp,
  requireAuthenticatedActor,
} from '../../../../modules/identity';
import { resolveTenantExecutionContext } from '../../../../modules/tenancy/authority';
import {
  apiErrorResponse,
  classifyError,
  classifyStatus,
  getRequestId,
  withRequestObservability,
} from '../../../../platform/observability';
import { AUTH_RATE_LIMIT, withPersistentRateLimit } from '../../../../platform/security';
import { AppError } from '../../../../platform/errors';
import { createLogger } from '../../../../platform/logging';
import { reverificationErrorResponse } from '@clerk/nextjs/server';
import {
  CLERK_DEACTIVATE_STAFF_ACTION,
  CLERK_STEP_UP_ACTION,
  clerkStepUpCookieClearHeaders,
} from '../../../../platform/auth/clerk-step-up';

export const runtime = 'nodejs';

const stepUpDiagnosticLogger = createLogger({ component: 'auth.step-up' });
const DEACTIVATE_ACTION = CLERK_DEACTIVATE_STAFF_ACTION;

function logDeactivationStepUp(
  request: Request,
  stage: 'received' | 'challenge_required' | 'reverified' | 'rejected' | 'completed',
  status: number | null,
  errorCategory?: string,
): void {
  stepUpDiagnosticLogger.info('auth.step_up.diagnostic', {
    signal: 'step_up_diagnostic',
    requestId: getRequestId(request),
    action: DEACTIVATE_ACTION,
    stage,
    status,
    statusClass: status === null ? 'unknown' : classifyStatus(status),
    ...(errorCategory ? { errorCategory } : {}),
  });
}

const requestSchema = z.object({
  tenantId: z.string().uuid(),
  action: z.enum([CLERK_STEP_UP_ACTION, CLERK_DEACTIVATE_STAFF_ACTION]),
});

function jsonResponse(body: unknown, status: number): Response {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export const POST = withRequestObservability(
  withPersistentRateLimit(async (request: Request): Promise<Response> => {
    let deactivationAction = false;
    try {
      await requireAuthenticatedActor(request);
      const body = requestSchema.parse(await request.json());
      deactivationAction = body.action === DEACTIVATE_ACTION;
      if (deactivationAction) logDeactivationStepUp(request, 'received', null);
      const context = await resolveTenantExecutionContext({
        request,
        requestedTenantId: body.tenantId,
      });
      const result = await establishStepUp({
        request,
        context,
        action: body.action,
      });
      if (deactivationAction) logDeactivationStepUp(request, 'reverified', 200);
      const response = jsonResponse(
        {
          status: 'active',
          stepUpLevel: result.level,
          expiresAt: result.expiresAt,
        },
        200,
      );
      if (result.setCookie) {
        response.headers.append('Set-Cookie', result.setCookie);
        for (const header of clerkStepUpCookieClearHeaders()) {
          response.headers.append('Set-Cookie', header);
        }
      }
      if (deactivationAction) logDeactivationStepUp(request, 'completed', 200);
      return response;
    } catch (error) {
      if (error instanceof ClerkReverificationRequiredError) {
        if (deactivationAction) {
          logDeactivationStepUp(
            request,
            'challenge_required',
            403,
            'CLERK_REVERIFICATION_REQUIRED',
          );
        }
        const clerkResponse = reverificationErrorResponse(error.level);
        const response = jsonResponse(await clerkResponse.json(), 403);
        response.headers.append('Set-Cookie', error.challengeCookie);
        return response;
      }
      if (deactivationAction) {
        const status = error instanceof AppError ? error.httpStatus : 500;
        logDeactivationStepUp(request, 'rejected', status, classifyError(error).toUpperCase());
      }
      return apiErrorResponse(request, error, {
        includeDetails: true,
        headers: { 'Cache-Control': 'no-store' },
      });
    }
  }, AUTH_RATE_LIMIT),
);
