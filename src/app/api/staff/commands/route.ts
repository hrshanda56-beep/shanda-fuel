import { NextResponse } from 'next/server';

import {
  createStaffInvitationFromRequest,
  deactivateStaffMemberFromRequest,
  generateManualStaffActivationFromRequest,
  activateManualStaffFromRequest,
  resendStaffInvitationFromRequest,
  revokeStaffInvitationFromRequest,
} from '../../../../modules/staff';
import { requireAuthenticatedActor } from '../../../../modules/identity';
import { apiErrorResponse, withRequestObservability } from '../../../../platform/observability';
import { WRITE_RATE_LIMIT, withPersistentRateLimit } from '../../../../platform/security';
import { staffDeactivationResponseStatus } from '../../../../modules/staff/revocation';
import {
  consumePersistentRateLimit,
  rateLimitResponse,
} from '../../../../platform/security/rate-limit';

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
        case 'ActivateManualStaff': {
          const clientLimit = await consumePersistentRateLimit(request, {
            scope: 'auth',
            limit: 20,
            windowSeconds: 900,
          });
          if (!clientLimit.allowed) return rateLimitResponse(clientLimit);
          return response(await activateManualStaffFromRequest(body));
        }
        case 'CreateStaffInvitation':
          return response(await createStaffInvitationFromRequest(request, body), 201);
        case 'GenerateManualStaffActivation':
          return response(await generateManualStaffActivationFromRequest(request, body));
        case 'ResendStaffInvitation':
          return response(await resendStaffInvitationFromRequest(request, body));
        case 'RevokeStaffInvitation':
          return response(await revokeStaffInvitationFromRequest(request, body));
        case 'DeactivateStaffMember': {
          const result = await deactivateStaffMemberFromRequest(request, body);
          return response(result, staffDeactivationResponseStatus(result));
        }
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
