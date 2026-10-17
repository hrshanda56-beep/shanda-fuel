import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertStepUp, type SessionRecord } from '../security/session';
import {
  CLERK_STEP_UP_COOKIE,
  issueClerkStepUpAssertion,
  readClerkStepUpAssertion,
} from './clerk-step-up';

const now = new Date('2026-10-17T10:00:00Z');
const session: SessionRecord = {
  sessionId: 'sess_1',
  userId: 'internal_1',
  expiresAt: new Date('2026-10-17T11:00:00Z'),
  strongAuthenticatedAt: now,
  strongAuthenticationExpiresAt: new Date('2026-10-17T10:10:00Z'),
  strongAuthenticationVerified: true,
  stepUpLevel: 1,
  stepUpExpiresAt: new Date('2026-10-17T10:10:00Z'),
  stepUpTenantId: 'tenant_1',
  stepUpAction: 'LOCK_BUSINESS_DAY',
};

beforeEach(() => {
  vi.stubEnv('AUDIT_SIGNING_KEY_ID', 'unit-test');
  vi.stubEnv('AUDIT_SIGNING_KEY', 'unit-test-signing-secret-long-enough');
});
afterEach(() => vi.unstubAllEnvs());

describe('Clerk action and tenant assurance', () => {
  it.each(['clerk-mfa', 'clerk-reverification'] as const)(
    'binds %s to both tenant and named action',
    (strongAuthenticationMethod) => {
      const actorSession = { ...session, strongAuthenticationMethod };
      expect(() =>
        assertStepUp(actorSession, 1, now, 'tenant_1', 'LOCK_BUSINESS_DAY'),
      ).not.toThrow();
      expect(() => assertStepUp(actorSession, 1, now, 'tenant_2', 'LOCK_BUSINESS_DAY')).toThrow();
      expect(() =>
        assertStepUp(actorSession, 1, now, 'tenant_1', 'DEACTIVATE_STAFF_MEMBER'),
      ).toThrow();
      expect(() => assertStepUp(actorSession, 1, now, 'tenant_1')).toThrow();
    },
  );

  it('rejects altered and expired signed assertions', () => {
    const cookie = issueClerkStepUpAssertion({
      providerSessionId: 'sess_1',
      internalUserId: 'internal_1',
      tenantId: 'tenant_1',
      action: 'LOCK_BUSINESS_DAY',
      level: 'strict_mfa',
      now,
    }).split(';', 1)[0]!;
    const request = (value: string) =>
      new Request('https://fuel.test', { headers: { cookie: value } });
    expect(readClerkStepUpAssertion(request(cookie), now)).toMatchObject({
      providerSessionId: 'sess_1',
      tenantId: 'tenant_1',
      action: 'LOCK_BUSINESS_DAY',
      level: 'strict_mfa',
    });
    const value = decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1));
    const [version, payload, signature] = value.split('.');
    const changed = JSON.parse(Buffer.from(payload!, 'base64url').toString());
    changed.action = 'DEACTIVATE_STAFF_MEMBER';
    const tampered = `${version}.${Buffer.from(JSON.stringify(changed)).toString('base64url')}.${signature}`;
    expect(
      readClerkStepUpAssertion(request(`${CLERK_STEP_UP_COOKIE}=${tampered}`), now),
    ).toBeNull();
    expect(readClerkStepUpAssertion(request(cookie), new Date(now.getTime() + 600_000))).toBeNull();
  });
});
