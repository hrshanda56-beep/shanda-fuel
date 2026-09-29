import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuthenticatedActor } from '../../../../../modules/identity';
import { getAuth } from '../../../../../platform/auth';
import { apiErrorResponse, withRequestObservability } from '../../../../../platform/observability';

export const runtime = 'nodejs';

const startSchema = z.object({
  password: z.string().min(1).max(256),
});

function jsonResponse(body: unknown, status: number): Response {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export const GET = withRequestObservability(async (request: Request): Promise<Response> => {
  try {
    await requireAuthenticatedActor(request);
    const result = await getAuth().api.getSession({
      headers: request.headers,
      query: { disableCookieCache: true },
    });
    const user = result?.user as { twoFactorEnabled?: boolean } | undefined;
    return jsonResponse({ enabled: user?.twoFactorEnabled === true }, 200);
  } catch (error) {
    return apiErrorResponse(request, error, {
      includeDetails: true,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
});

export const POST = withRequestObservability(async (request: Request): Promise<Response> => {
  try {
    await requireAuthenticatedActor(request);
    const input = startSchema.parse(await request.json());
    const result = await getAuth().api.enableTwoFactor({
      headers: request.headers,
      body: { password: input.password, method: 'totp', issuer: 'Shanda Fuel' },
    });
    if (result.method !== 'totp') {
      return jsonResponse({ error: 'MFA_METHOD_UNAVAILABLE' }, 409);
    }
    return jsonResponse(
      {
        status: 'pending',
        method: result.method,
        totpURI: result.totpURI,
        backupCodes: result.backupCodes,
      },
      200,
    );
  } catch (error) {
    return apiErrorResponse(request, error, {
      includeDetails: true,
      unknownBody: { error: 'MFA_SETUP_FAILED' },
      unknownStatus: 400,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
});
