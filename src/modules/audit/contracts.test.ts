import { describe, expect, it } from 'vitest';
import { signAuditEvent, verifyAuditEvent } from './contracts';

describe('audit event contract', () => {
  it('captures actor, subject, request, and change metadata in the signed event', () => {
    const event = signAuditEvent(
      {
        eventId: '11111111-1111-4111-8111-111111111111',
        eventScope: 'TENANT',
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
});
