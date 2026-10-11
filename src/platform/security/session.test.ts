import { describe, expect, it } from 'vitest';
import {
  assertSessionActive,
  assertStepUp,
  assertStrongAuthentication,
  invalidateExpiredAssurance,
  type SessionRecord,
} from './session';

const now = new Date('2026-09-20T10:00:00.000Z');
const baseSession: SessionRecord = {
  sessionId: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  membershipId: '33333333-3333-4333-8333-333333333333',
  expiresAt: new Date('2026-09-20T11:00:00.000Z'),
  strongAuthenticatedAt: new Date('2026-09-20T09:55:00.000Z'),
  strongAuthenticationExpiresAt: new Date('2026-09-20T10:30:00.000Z'),
  strongAuthenticationVerified: true,
  stepUpLevel: 2,
  stepUpExpiresAt: new Date('2026-09-20T10:10:00.000Z'),
  stepUpTenantId: '33333333-3333-4333-8333-333333333333',
};

describe('session security', () => {
  it('accepts an active session and step-up', () => {
    expect(() => assertSessionActive(baseSession, now)).not.toThrow();
    expect(() => assertStrongAuthentication(baseSession, now)).not.toThrow();
    expect(() => assertStepUp(baseSession, 2, now, baseSession.stepUpTenantId!)).not.toThrow();
  });

  it('rejects revoked and expired sessions', () => {
    expect(() =>
      assertSessionActive({ ...baseSession, revokedAt: new Date('2026-09-20T09:59:00.000Z') }, now),
    ).toThrow('no longer active');
    expect(() =>
      assertSessionActive({ ...baseSession, expiresAt: new Date('2026-09-20T09:00:00.000Z') }, now),
    ).toThrow('no longer active');
  });

  it('rejects a stale step-up even when the base session is active', () => {
    expect(() =>
      assertStepUp(
        { ...baseSession, stepUpExpiresAt: new Date('2026-09-20T09:59:00.000Z') },
        1,
        now,
        baseSession.stepUpTenantId!,
      ),
    ).toThrow('step-up');
  });

  it('requires the step-up tenant to match the active tenant context', () => {
    expect(() =>
      assertStepUp(baseSession, 1, now, '33333333-3333-4333-8333-333333333333'),
    ).not.toThrow();
    expect(() => assertStepUp(baseSession, 1, now, '44444444-4444-4444-8444-444444444444')).toThrow(
      'step-up',
    );
  });

  it('rejects an expired strong-authentication assertion', () => {
    expect(() =>
      assertStrongAuthentication(
        { ...baseSession, strongAuthenticationExpiresAt: new Date('2026-09-20T09:59:00.000Z') },
        now,
      ),
    ).toThrow('Strong authentication');
  });

  it('rejects an unverified strong-authentication timestamp', () => {
    expect(() =>
      assertStrongAuthentication({ ...baseSession, strongAuthenticationVerified: false }, now),
    ).toThrow('Strong authentication');
  });

  it('rejects a step-up bound to a different tenant', () => {
    expect(() =>
      assertStepUp(
        {
          ...baseSession,
          stepUpTenantId: '44444444-4444-4444-8444-444444444444',
        },
        1,
        now,
        '55555555-5555-4555-8555-555555555555',
      ),
    ).toThrow('step-up');
  });

  it('allows the explicit Clerk no-MFA assertion only for its bound action', () => {
    const clerkReverification = {
      ...baseSession,
      strongAuthenticationMethod: 'clerk-reverification' as const,
      stepUpAction: 'LOCK_BUSINESS_DAY',
    };
    expect(() =>
      assertStepUp(clerkReverification, 1, now, baseSession.stepUpTenantId!, 'LOCK_BUSINESS_DAY'),
    ).not.toThrow();
    expect(() => assertStepUp(clerkReverification, 1, now, baseSession.stepUpTenantId!)).toThrow(
      'step-up',
    );
    expect(() =>
      assertStepUp(
        clerkReverification,
        1,
        now,
        baseSession.stepUpTenantId!,
        'APPROVE_RECONCILIATION',
      ),
    ).toThrow('step-up');
  });

  it('invalidates expired assurance before authorization can reuse it', () => {
    const expired = invalidateExpiredAssurance(
      { ...baseSession, stepUpExpiresAt: new Date('2026-09-20T09:59:00.000Z') },
      now,
    );
    expect(expired.stepUpLevel).toBeUndefined();
    expect(expired.stepUpExpiresAt).toBeUndefined();
    expect(expired.strongAuthenticationVerified).toBe(true);

    const expiredStrong = invalidateExpiredAssurance(
      { ...baseSession, strongAuthenticationExpiresAt: new Date('2026-09-20T09:59:00.000Z') },
      now,
    );
    expect(expiredStrong.strongAuthenticationVerified).toBe(false);
    expect(expiredStrong.strongAuthenticatedAt).toBeUndefined();
    expect(expiredStrong.stepUpLevel).toBeUndefined();
  });
});
