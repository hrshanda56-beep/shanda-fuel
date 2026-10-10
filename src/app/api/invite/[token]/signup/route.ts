import { NextResponse } from 'next/server';

import { signUpFromInvitation } from '@/modules/staff';
import { apiErrorResponse, withRequestObservability } from '@/platform/observability';
import { AUTH_RATE_LIMIT, withPersistentRateLimit } from '@/platform/security';

export const runtime = 'nodejs';

export const POST = withRequestObservability(
  withPersistentRateLimit(async (request: Request): Promise<Response> => {
    try {
      const body = await request.json();
      return NextResponse.json(await signUpFromInvitation(body), {
        status: 201,
        headers: { 'cache-control': 'no-store' },
      });
    } catch (error) {
      return apiErrorResponse(request, error, {
        includeDetails: false,
        headers: { 'cache-control': 'no-store' },
      });
    }
  }, AUTH_RATE_LIMIT),
);
