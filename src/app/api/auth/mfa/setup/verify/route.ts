import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuthenticatedActor } from '../../../../../../modules/identity';
import { getAuth } from '../../../../../../platform/auth';
import {
  apiErrorResponse,
  withRequestObservability,
} from '../../../../../../platform/observability';
import { AUTH_RATE_LIMIT, withPersistentRateLimit } from '../../../../../../platform/security';

export const runtime = 'nodejs';

const requestSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
});

function verificationSucceeded(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false;
  if ('status' in result && (result as { status?: unknown }).status === true) return true;
  return (
    'token' in result &&
    typeof (result as { token?: unknown }).token === 'string' &&
    'user' in result &&
    Boolean((result as { user?: unknown }).user)
  );
}

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
      const result = await getAuth().api.verifyTOTP({
        headers: request.headers,
        body: { code: body.code },
        returnHeaders: true,
      });
      if (!verificationSucceeded(result.response)) {
        return jsonResponse({ error: 'MFA_VERIFICATION_FAILED' }, 400);
      }
      const headers = new Headers(result.headers);
      headers.set('Cache-Control', 'no-store');
      return NextResponse.json({ status: 'enabled' }, { status: 200, headers });
    } catch (error) {
      return apiErrorResponse(request, error, {
        includeDetails: true,
        unknownBody: { error: 'MFA_VERIFICATION_FAILED' },
        unknownStatus: 400,
        headers: { 'Cache-Control': 'no-store' },
      });
    }
  }, AUTH_RATE_LIMIT),
);
