import { describe, expect, it } from 'vitest';
import {
  assertSessionActive,
  assertStepUp,
  assertStrongAuthentication,
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
  stepUpLevel: 2,
  stepUpExpiresAt: new Date('2026-09-20T10:10:00.000Z'),
};

describe('session security', () => {
  it('accepts an active session and step-up', () => {
    expect(() => assertSessionActive(baseSession, now)).not.toThrow();
    expect(() => assertStrongAuthentication(baseSession, now)).not.toThrow();
    expect(() => assertStepUp(baseSession, 2, now)).not.toThrow();
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
      ),
    ).toThrow('step-up');
  });

  it('rejects an expired strong-authentication assertion', () => {
    expect(() =>
      assertStrongAuthentication(
        { ...baseSession, strongAuthenticationExpiresAt: new Date('2026-09-20T09:59:00.000Z') },
        now,
      ),
    ).toThrow('Strong authentication');
  });
});
