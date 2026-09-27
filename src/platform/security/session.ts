import { AppError } from '../errors';

export type SessionRecord = {
  sessionId: string;
  userId: string;
  membershipId?: string;
  expiresAt: Date;
  revokedAt?: Date;
  strongAuthenticatedAt?: Date;
  strongAuthenticationExpiresAt?: Date;
  strongAuthenticationVerified?: boolean;
  stepUpLevel?: 0 | 1 | 2;
  stepUpExpiresAt?: Date;
  stepUpTenantId?: string;
};

export function assertSessionActive(session: SessionRecord, now = new Date()): void {
  if (session.revokedAt || session.expiresAt.getTime() <= now.getTime()) {
    throw new AppError('UNAUTHENTICATED', 'Session is no longer active');
  }
}

export function assertStrongAuthentication(session: SessionRecord, now = new Date()): void {
  assertSessionActive(session, now);
  if (
    session.strongAuthenticationVerified !== true ||
    !session.strongAuthenticatedAt ||
    (session.strongAuthenticationExpiresAt &&
      session.strongAuthenticationExpiresAt.getTime() <= now.getTime())
  ) {
    throw new AppError('FORBIDDEN', 'Strong authentication is required for this action');
  }
}

export function assertStepUp(
  session: SessionRecord,
  minimumLevel: 1 | 2,
  now = new Date(),
  tenantId: string,
): void {
  assertStrongAuthentication(session, now);
  if (
    !session.stepUpExpiresAt ||
    session.stepUpExpiresAt.getTime() <= now.getTime() ||
    (session.stepUpLevel ?? 0) < minimumLevel ||
    session.stepUpTenantId !== tenantId
  ) {
    throw new AppError('FORBIDDEN', 'A current step-up authentication is required for this action');
  }
}

/**
 * Expired assurance is invalidated at the authorization boundary even when a
 * provider/session cache still contains the old fields. The next durable
 * session read may clear those fields, but no command may reuse them.
 */
export function invalidateExpiredAssurance(
  session: SessionRecord,
  now = new Date(),
): SessionRecord {
  const strongAuthenticationExpired =
    session.strongAuthenticationExpiresAt &&
    session.strongAuthenticationExpiresAt.getTime() <= now.getTime();
  const stepUpExpired =
    session.stepUpExpiresAt && session.stepUpExpiresAt.getTime() <= now.getTime();

  if (!strongAuthenticationExpired && !stepUpExpired) return session;

  return {
    ...session,
    ...(strongAuthenticationExpired
      ? {
          strongAuthenticatedAt: undefined,
          strongAuthenticationExpiresAt: undefined,
          strongAuthenticationVerified: false,
        }
      : {}),
    ...(strongAuthenticationExpired || stepUpExpired
      ? { stepUpLevel: undefined, stepUpExpiresAt: undefined, stepUpTenantId: undefined }
      : {}),
  };
}
