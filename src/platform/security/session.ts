import { AppError } from '../errors';

export type SessionRecord = {
  sessionId: string;
  userId: string;
  membershipId: string;
  expiresAt: Date;
  revokedAt?: Date;
  strongAuthenticatedAt?: Date;
  strongAuthenticationExpiresAt?: Date;
  stepUpLevel?: 0 | 1 | 2;
  stepUpExpiresAt?: Date;
};

export function assertSessionActive(session: SessionRecord, now = new Date()): void {
  if (session.revokedAt || session.expiresAt.getTime() <= now.getTime()) {
    throw new AppError('UNAUTHENTICATED', 'Session is no longer active');
  }
}

export function assertStrongAuthentication(session: SessionRecord, now = new Date()): void {
  assertSessionActive(session, now);
  if (
    !session.strongAuthenticatedAt ||
    (session.strongAuthenticationExpiresAt &&
      session.strongAuthenticationExpiresAt.getTime() <= now.getTime())
  ) {
    throw new AppError('FORBIDDEN', 'Strong authentication is required for this action');
  }
}

export function assertStepUp(session: SessionRecord, minimumLevel: 1 | 2, now = new Date()): void {
  assertStrongAuthentication(session, now);
  if (
    !session.stepUpExpiresAt ||
    session.stepUpExpiresAt.getTime() <= now.getTime() ||
    (session.stepUpLevel ?? 0) < minimumLevel
  ) {
    throw new AppError('FORBIDDEN', 'A current step-up authentication is required for this action');
  }
}
