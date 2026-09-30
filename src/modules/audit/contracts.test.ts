import { describe, expect, it, vi } from 'vitest';
import { appendSecurityEvent, signAuditEvent, verifyAuditEvent } from './contracts';

describe('audit event contract', () => {
  it('captures actor, subject, request, and change metadata in the signed event', () => {
    const event = signAuditEvent(
      {
        eventId: '11111111-1111-4111-8111-111111111111',
        tenantId: '22222222-2222-4222-8222-222222222222',
        actorId: '33333333-3333-4333-8333-333333333333',
        actorType: 'HUMAN',
        initiatedBy: '33333333-3333-4333-8333-333333333333',
        actionCode: 'MEMBERSHIP_DISABLED',
        subjectType: 'Membership',
        subjectId: '44444444-4444-4444-8444-444444444444',
        requestId: '55555555-5555-4555-8555-555555555555',
        occurredAt: '2026-09-20T10:00:00.000Z',
        before: { status: 'ACTIVE' },
        after: { status: 'DISABLED' },
        reason: 'Access removed',
      },
      { keyId: 'audit-key-v1', secret: 'audit-test-secret' },
    );

    expect(event.eventCode).toBe('MEMBERSHIP_DISABLED');
    expect(event.details).toMatchObject({
      actorType: 'HUMAN',
      subjectType: 'Membership',
      subjectId: '44444444-4444-4444-8444-444444444444',
      before: { status: 'ACTIVE' },
      after: { status: 'DISABLED' },
    });
    expect(verifyAuditEvent(event, 'audit-test-secret')).toBe(true);
  });

  it('emits a redacted operational signal when the append fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const executor = {
      execute: vi.fn().mockRejectedValue(new Error('database password must not be logged')),
    };

    await expect(
      appendSecurityEvent(
        {
          eventId: '11111111-1111-4111-8111-111111111111',
          tenantId: '22222222-2222-4222-8222-222222222222',
          actorType: 'SYSTEM',
          actionCode: 'SECURITY_TEST',
          requestId: '55555555-5555-4555-8555-555555555555',
          occurredAt: '2026-09-20T10:00:00.000Z',
        },
        { keyId: 'audit-key-v1', secret: 'audit-test-secret' },
        executor,
      ),
    ).rejects.toThrow('database password must not be logged');

    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      message: 'security.audit.append_failed',
      signal: 'security_audit_failure',
      requestId: '55555555-5555-4555-8555-555555555555',
      eventCode: 'SECURITY_TEST',
    });
    expect(JSON.stringify(log.mock.calls[0])).not.toContain('database password');
  });
});
