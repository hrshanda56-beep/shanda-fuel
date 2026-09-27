import { NextResponse } from 'next/server';
import { z, ZodError } from 'zod';
import { requireAuthenticatedActor } from '../../../../../../modules/identity';
import { getAuth } from '../../../../../../platform/auth';
import { AppError } from '../../../../../../platform/errors';

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

export async function POST(request: Request): Promise<Response> {
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
    if (error instanceof ZodError) {
      return jsonResponse({ error: 'VALIDATION_FAILED', issues: error.issues }, 400);
    }
    if (error instanceof AppError) {
      return jsonResponse(
        { error: error.code, message: error.message, details: error.details },
        error.httpStatus,
      );
    }
    return jsonResponse({ error: 'MFA_VERIFICATION_FAILED' }, 400);
  }
}
