import 'server-only';

import { randomUUID } from 'node:crypto';
import { getAuditSigningKey, getServerEnv } from '../../platform/config/env';
import { type Database, withTenantTransaction } from '../../platform/db';
import { AppError } from '../../platform/errors';
import { assertSessionActive } from '../../platform/security';
import {
  clerkUserHasMfa,
  hasRecentClerkReverification,
  resolveClerkSession,
} from '../../platform/auth/provider';
import {
  CLERK_DEACTIVATE_STAFF_ACTION,
  CLERK_PRIVILEGED_ACTION,
  CLERK_STEP_UP_ACTION,
  type ClerkReverificationLevel,
  type ClerkStepUpAction,
  issueClerkStepUpAssertion,
  issueClerkStepUpChallenge,
  readClerkStepUpChallenge,
} from '../../platform/auth/clerk-step-up';
import { appendSecurityEvent } from '../audit/contracts';
import type { TenantExecutionContext } from '../tenancy/authority';

export const STEP_UP_LEVEL = 1 as const;
export const STEP_UP_TTL_MS = 10 * 60_000;

type TenantTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export type StepUpResult = {
  level: typeof STEP_UP_LEVEL;
  tenantId: string;
  expiresAt: string;
  setCookie?: string;
};

// DEC-047: while REQUIRE_LOGIN_MFA is false (no paid Clerk plan), the tenant Owner's password
// re-check is the strongest check available, so it also covers exports. With MFA required, or for
// anyone who is not the Owner, the privileged action still needs strict MFA.
export const CLERK_STEP_UP_POLICY = {
  [CLERK_PRIVILEGED_ACTION]: { allowNoMfaOwner: true },
  [CLERK_STEP_UP_ACTION]: {
    allowNoMfaOwner: true,
  },
  [CLERK_DEACTIVATE_STAFF_ACTION]: {
    allowNoMfaOwner: true,
  },
} as const satisfies Record<ClerkStepUpAction, { allowNoMfaOwner: boolean }>;

export class ClerkReverificationRequiredError extends Error {
  readonly code = 'CLERK_REVERIFICATION_REQUIRED';

  constructor(
    readonly level: ClerkReverificationLevel,
    readonly challengeCookie: string,
  ) {
    super('Clerk reverification is required for this action');
    this.name = 'ClerkReverificationRequiredError';
  }
}

function auditKey(): { keyId: string; secret: string } {
  return getAuditSigningKey();
}

async function appendStepUpEvent(
  transaction: TenantTransaction,
  context: TenantExecutionContext,
  now: Date,
  eventCode: 'SECURITY.STEP_UP_FAILED' | 'SECURITY.STEP_UP_SUCCEEDED',
  metadata: Record<string, unknown>,
): Promise<void> {
  await appendSecurityEvent(
    {
      eventId: randomUUID(),
      tenantId: context.membership.tenantId,
      membershipId: context.membership.membershipId,
      actorId: context.actor.identityId,
      actorType: 'HUMAN',
      actionCode: eventCode,
      subjectType: 'AuthSession',
      subjectId: context.actor.session.sessionId,
      requestId: context.transaction.requestId ?? randomUUID(),
      occurredAt: now.toISOString(),
      metadata: {
        sessionId: context.actor.session.sessionId,
        authenticationMethod: 'clerk-reverification',
        ...metadata,
      },
    },
    auditKey(),
    transaction,
  );
}

export async function establishStepUp(input: {
  request: Request;
  context: TenantExecutionContext;
  action: ClerkStepUpAction;
  now?: Date;
}): Promise<StepUpResult> {
  const now = input.now ?? new Date();
  const session = await resolveClerkSession(input.request);
  if (!session || !input.action || !(input.action in CLERK_STEP_UP_POLICY)) {
    throw new AppError('FORBIDDEN', 'The privileged action is not eligible for Clerk step-up');
  }
  if (
    session.internalUserId !== input.context.actor.identityId ||
    session.providerSessionId !== input.context.actor.session.sessionId ||
    input.context.membership.tenantId !== input.context.transaction.tenantId
  ) {
    throw new AppError('FORBIDDEN', 'Clerk step-up context is invalid');
  }
  assertSessionActive(input.context.actor.session, now);
  assertSessionActive(
    {
      sessionId: session.providerSessionId,
      userId: session.internalUserId,
      expiresAt: session.expiresAt,
    },
    now,
  );

  const hasTenantOwnerRole = input.context.membership.roleAssignments.some(
    (assignment) =>
      assignment.roleCode === 'OWNER' &&
      assignment.scopeType === 'TENANT' &&
      assignment.tenantId === input.context.membership.tenantId,
  );
  const mfaEnrolled = await clerkUserHasMfa(session.providerUserId);
  const allowNoMfaPath =
    !getServerEnv().REQUIRE_LOGIN_MFA &&
    CLERK_STEP_UP_POLICY[input.action].allowNoMfaOwner &&
    hasTenantOwnerRole;
  const level: ClerkReverificationLevel = mfaEnrolled || !allowNoMfaPath ? 'strict_mfa' : 'strict';
  const challengeInput = {
    providerSessionId: session.providerSessionId,
    internalUserId: session.internalUserId,
    tenantId: input.context.membership.tenantId,
    action: input.action,
    level,
  } as const;

  if (!readClerkStepUpChallenge(input.request, challengeInput, now)) {
    throw new ClerkReverificationRequiredError(
      level,
      issueClerkStepUpChallenge({ ...challengeInput, now }),
    );
  }
  if (!hasRecentClerkReverification(input.request, level)) {
    throw new AppError('FORBIDDEN', 'Clerk reverification is required for this action');
  }
  const expiresAt = new Date(Math.min(session.expiresAt.getTime(), now.getTime() + STEP_UP_TTL_MS));
  await withTenantTransaction(input.context.transaction, async (transaction) => {
    await appendStepUpEvent(transaction, input.context, now, 'SECURITY.STEP_UP_SUCCEEDED', {
      outcome: 'success',
      level: STEP_UP_LEVEL,
      expiresAt: expiresAt.toISOString(),
      tenantId: input.context.membership.tenantId,
      authenticationMethod: 'clerk-reverification',
    });
  });
  const setCookie = issueClerkStepUpAssertion({ ...challengeInput, now });
  return {
    level: STEP_UP_LEVEL,
    tenantId: input.context.membership.tenantId,
    expiresAt: expiresAt.toISOString(),
    ...(setCookie ? { setCookie } : {}),
  };
}
