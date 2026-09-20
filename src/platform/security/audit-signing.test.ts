import { describe, expect, it } from 'vitest';
import { signSecurityEvent, verifySecurityEvent } from './audit-signing';

const event = {
  eventId: '11111111-1111-4111-8111-111111111111',
  tenantId: '22222222-2222-4222-8222-222222222222',
  actorId: '33333333-3333-4333-8333-333333333333',
  eventCode: 'AUTHORIZATION_DENIED',
  requestId: '44444444-4444-4444-8444-444444444444',
  occurredAt: '2026-09-20T10:00:00.000Z',
  details: { permissionCode: 'report.export', source: 'test' },
};

describe('security event signing', () => {
  it('signs and verifies independent events without a global hash chain', () => {
    const signed = signSecurityEvent(event, { keyId: 'test-key-v1', secret: 'test-secret' });
    expect(signed.algorithm).toBe('hmac-sha256');
    expect(verifySecurityEvent(signed, 'test-secret')).toBe(true);
    expect(verifySecurityEvent(signed, 'wrong-secret')).toBe(false);
    expect(verifySecurityEvent({ ...signed, eventCode: 'OTHER_EVENT' }, 'test-secret')).toBe(false);
    expect(
      verifySecurityEvent(
        { ...signed, details: { source: 'test', permissionCode: 'report.export' } },
        'test-secret',
      ),
    ).toBe(true);
  });
});
