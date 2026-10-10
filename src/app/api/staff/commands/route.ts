import { NextResponse } from 'next/server';

import {
  createStaffInvitationFromRequest,
  deactivateStaffMemberFromRequest,
  generateManualStaffActivationFromRequest,
  activateManualStaffFromRequest,
  resendStaffInvitationFromRequest,
  revokeStaffInvitationFromRequest,
} from '@/modules/staff';
import { requireAuthenticatedActor } from '@/modules/identity';
import { apiErrorResponse, withRequestObservability } from '@/platform/observability';
import { WRITE_RATE_LIMIT, withPersistentRateLimit } from '@/platform/security';

export const runtime = 'nodejs';

function response(body: unknown, status = 200): Response {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export const POST = withRequestObservability(
  withPersistentRateLimit(async (request: Request): Promise<Response> => {
    try {
      const body: unknown = await request.json();
      const commandType =
        typeof body === 'object' && body !== null && 'commandType' in body
          ? (body as { commandType?: unknown }).commandType
          : undefined;
      if (commandType !== 'ActivateManualStaff') await requireAuthenticatedActor(request);
      switch (commandType) {
        case 'ActivateManualStaff':
          return response(await activateManualStaffFromRequest(body));
        case 'CreateStaffInvitation':
          return response(await createStaffInvitationFromRequest(request, body), 201);
        case 'GenerateManualStaffActivation':
          return response(await generateManualStaffActivationFromRequest(request, body));
        case 'ResendStaffInvitation':
          return response(await resendStaffInvitationFromRequest(request, body));
        case 'RevokeStaffInvitation':
          return response(await revokeStaffInvitationFromRequest(request, body));
        case 'DeactivateStaffMember':
          return response(await deactivateStaffMemberFromRequest(request, body));
        default:
          return response(
            { error: 'VALIDATION_FAILED', message: 'Unsupported staff command' },
            400,
          );
      }
    } catch (error) {
      return apiErrorResponse(request, error, {
        includeDetails: true,
        headers: { 'cache-control': 'no-store' },
      });
    }
  }, WRITE_RATE_LIMIT),
);
