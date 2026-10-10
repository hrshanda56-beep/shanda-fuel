import { NextResponse } from 'next/server';

import { acceptStaffInvitationFromRequest } from '@/modules/staff';
import { apiErrorResponse, withRequestObservability } from '@/platform/observability';
import { AUTH_RATE_LIMIT, withPersistentRateLimit } from '@/platform/security';

export const runtime = 'nodejs';

export const POST = withRequestObservability(
  withPersistentRateLimit(async (request: Request): Promise<Response> => {
    try {
      return NextResponse.json(
        await acceptStaffInvitationFromRequest(request, await request.json()),
        { headers: { 'cache-control': 'no-store' } },
      );
    } catch (error) {
      return apiErrorResponse(request, error, {
        includeDetails: false,
        headers: { 'cache-control': 'no-store' },
      });
    }
  }, AUTH_RATE_LIMIT),
);
