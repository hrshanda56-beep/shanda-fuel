import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  ClerkReverificationRequiredError,
  establishStepUp,
  requireAuthenticatedActor,
} from '../../../../modules/identity';
import { resolveTenantExecutionContext } from '../../../../modules/tenancy/authority';
import { apiErrorResponse, withRequestObservability } from '../../../../platform/observability';
import { AUTH_RATE_LIMIT, withPersistentRateLimit } from '../../../../platform/security';
import { getAuthProviderName } from '../../../../platform/auth/provider';
import { AppError } from '../../../../platform/errors';
import { reverificationErrorResponse } from '@clerk/nextjs/server';
import { clerkStepUpCookieClearHeaders } from '../../../../platform/auth/clerk-step-up';

export const runtime = 'nodejs';

const requestSchema = z.object({
  tenantId: z.string().uuid(),
  password: z.string().min(1).max(256).optional(),
  totpCode: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
  action: z.literal('LOCK_BUSINESS_DAY').optional(),
});

function jsonResponse(body: unknown, status: number): Response {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export const POST = withRequestObservability(
  withPersistentRateLimit(async (request: Request): Promise<Response> => {
    try {
      await requireAuthenticatedActor(request);
      const body = requestSchema.parse(await request.json());
      if (getAuthProviderName() === 'BETTER_AUTH' && (!body.password || !body.totpCode)) {
        return apiErrorResponse(
          request,
          new AppError('VALIDATION_FAILED', 'Password and authenticator code are required'),
          { includeDetails: true, headers: { 'Cache-Control': 'no-store' } },
        );
      }
      const context = await resolveTenantExecutionContext({
        request,
        requestedTenantId: body.tenantId,
      });
      const result = await establishStepUp({
        request,
        context,
        password: body.password ?? '',
        totpCode: body.totpCode ?? '',
        action: body.action,
      });
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
      return response;
    } catch (error) {
      if (error instanceof ClerkReverificationRequiredError) {
        const clerkResponse = reverificationErrorResponse(error.level);
        const response = jsonResponse(await clerkResponse.json(), 403);
        response.headers.append('Set-Cookie', error.challengeCookie);
        return response;
      }
      return apiErrorResponse(request, error, {
        includeDetails: true,
        headers: { 'Cache-Control': 'no-store' },
      });
    }
  }, AUTH_RATE_LIMIT),
);
