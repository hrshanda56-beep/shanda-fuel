import 'server-only';

import { randomUUID } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { getAuth } from '../../platform/auth';
import { getAuditSigningKey } from '../../platform/config/env';
import { type Database, withTenantTransaction } from '../../platform/db';
import { AppError } from '../../platform/errors';
import {
  clerkUserHasMfa,
  getAuthProviderName,
  hasRecentClerkReverification,
  resolveClerkSession,
} from '../../platform/auth/provider';
import {
  CLERK_STEP_UP_ACTION,
  type ClerkReverificationLevel,
  type ClerkStepUpAction,
  issueClerkStepUpAssertion,
  issueClerkStepUpChallenge,
  readClerkStepUpChallenge,
} from '../../platform/auth/clerk-step-up';
import { appendSecurityEvent } from '../audit/contracts';
import { authSession } from '../../platform/db/schema/auth';
import type { TenantExecutionContext } from '../tenancy/authority';
import type { BetterAuthPasswordVerifier } from './authenticated-actor';

export const STEP_UP_LEVEL = 1 as const;
export const STEP_UP_TTL_MS = 10 * 60_000;

type TenantTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export type StepUpResult = {
  level: typeof STEP_UP_LEVEL;
  tenantId: string;
  expiresAt: string;
  setCookie?: string;
};

export const CLERK_STEP_UP_POLICY = {
  [CLERK_STEP_UP_ACTION]: {
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

type StepUpPersistence = {
  recordFailure: (
    context: TenantExecutionContext,
    now: Date,
    factor: 'password' | 'totp',
  ) => Promise<void>;
  establish: (context: TenantExecutionContext, now: Date, expiresAt: Date) => Promise<void>;
};

export type StepUpDependencies = {
  auth?: BetterAuthPasswordVerifier;
  persistence?: StepUpPersistence;
};

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
        authenticationMethod: 'password+totp',
        ...metadata,
      },
    },
    auditKey(),
    transaction,
  );
}

const databaseStepUpPersistence: StepUpPersistence = {
  async recordFailure(context, now, factor) {
    await withTenantTransaction(context.transaction, async (transaction) => {
      await appendStepUpEvent(transaction, context, now, 'SECURITY.STEP_UP_FAILED', {
        outcome: 'failure',
        factor,
      });
    });
  },

  async establish(context, now, expiresAt) {
    await withTenantTransaction(context.transaction, async (transaction) => {
      const updated = await transaction
        .update(authSession)
        .set({
          strongAuthenticatedAt: now,
          strongAuthenticationExpiresAt: expiresAt,
          strongAuthenticationVerified: true,
          stepUpLevel: STEP_UP_LEVEL,
          stepUpExpiresAt: expiresAt,
          stepUpTenantId: context.membership.tenantId,
          updatedAt: now,
        })
        .where(
          and(
            eq(authSession.id, context.actor.session.sessionId),
            eq(authSession.userId, context.actor.identityId),
            isNull(authSession.revokedAt),
            gt(authSession.expiresAt, now),
          ),
        )
        .returning({ id: authSession.id });

      if (updated.length !== 1) {
        throw new AppError('UNAUTHENTICATED', 'The authentication session is no longer active');
      }

      await appendStepUpEvent(transaction, context, now, 'SECURITY.STEP_UP_SUCCEEDED', {
        outcome: 'success',
        level: STEP_UP_LEVEL,
        expiresAt: expiresAt.toISOString(),
        tenantId: context.membership.tenantId,
      });
    });
  },
};

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

/**
 * Establish assurance only after Better Auth verifies both factors for the
 * current cookie-bound session. The session row and audit event are written in
 * one tenant-scoped transaction, and the tenant is never accepted from an
 * authenticated user without the A1 membership resolver validating it.
 */
export async function establishStepUp(input: {
  request: Request;
  context: TenantExecutionContext;
  password: string;
  totpCode: string;
  action?: ClerkStepUpAction;
  now?: Date;
  dependencies?: StepUpDependencies;
}): Promise<StepUpResult> {
  const now = input.now ?? new Date();
  if (getAuthProviderName() === 'CLERK') {
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

    const hasTenantOwnerRole = input.context.membership.roleAssignments.some(
      (assignment) =>
        assignment.roleCode === 'OWNER' &&
        assignment.scopeType === 'TENANT' &&
        assignment.tenantId === input.context.membership.tenantId,
    );
    const mfaEnrolled = await clerkUserHasMfa(session.providerUserId);
    const allowNoMfaPath = CLERK_STEP_UP_POLICY[input.action].allowNoMfaOwner && hasTenantOwnerRole;
    const level: ClerkReverificationLevel =
      mfaEnrolled || !allowNoMfaPath ? 'strict_mfa' : 'strict';
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
    const expiresAt = new Date(
      Math.min(session.expiresAt.getTime(), now.getTime() + STEP_UP_TTL_MS),
    );
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
  const auth = input.dependencies?.auth ?? (await getAuth());
  const persistence = input.dependencies?.persistence ?? databaseStepUpPersistence;
  let failedFactor: 'password' | 'totp' = 'password';

  try {
    const session = await auth.api.getSession({
      headers: input.request.headers,
      query: { disableCookieCache: true },
    });
    if (
      !session ||
      typeof session !== 'object' ||
      !('user' in session) ||
      !session.user ||
      typeof session.user !== 'object' ||
      !('twoFactorEnabled' in session.user) ||
      (session.user as { twoFactorEnabled?: unknown }).twoFactorEnabled !== true
    ) {
      failedFactor = 'totp';
      throw new Error('MFA enrollment is required');
    }
    const result = await auth.api.verifyPassword({
      headers: input.request.headers,
      body: { password: input.password },
    });
    if (!verificationSucceeded(result)) throw new Error('Password verification was not successful');
    failedFactor = 'totp';
    const totp = await auth.api.verifyTOTP({
      headers: input.request.headers,
      body: { code: input.totpCode },
    });
    if (!verificationSucceeded(totp)) throw new Error('TOTP verification was not successful');
  } catch {
    await persistence.recordFailure(input.context, now, failedFactor);
    throw new AppError('FORBIDDEN', 'Step-up verification failed');
  }

  const expiresAt = new Date(
    Math.min(input.context.actor.session.expiresAt.getTime(), now.getTime() + STEP_UP_TTL_MS),
  );
  await persistence.establish(input.context, now, expiresAt);

  return {
    level: STEP_UP_LEVEL,
    tenantId: input.context.membership.tenantId,
    expiresAt: expiresAt.toISOString(),
  };
}
