import {
  signSecurityEvent,
  verifySecurityEvent,
  type SignedSecurityEvent,
} from '../../platform/security';

export type AuditActorType = 'HUMAN' | 'SYSTEM' | 'SUPPORT';

export type AuditEventDraft = {
  eventId: string;
  tenantId: string;
  actorId?: string;
  actorType: AuditActorType;
  initiatedBy?: string;
  actionCode: string;
  subjectType: string;
  subjectId: string;
  requestId: string;
  occurredAt: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
  metadata?: Record<string, unknown>;
};

export function signAuditEvent(
  draft: AuditEventDraft,
  key: { keyId: string; secret: string },
): SignedSecurityEvent {
  return signSecurityEvent(
    {
      eventId: draft.eventId,
      tenantId: draft.tenantId,
      actorId: draft.actorId,
      eventCode: draft.actionCode,
      requestId: draft.requestId,
      occurredAt: draft.occurredAt,
      details: {
        actorType: draft.actorType,
        after: draft.after,
        before: draft.before,
        initiatedBy: draft.initiatedBy,
        metadata: draft.metadata,
        reason: draft.reason,
        subjectId: draft.subjectId,
        subjectType: draft.subjectType,
      },
    },
    key,
  );
}

export function verifyAuditEvent(event: SignedSecurityEvent, secret: string): boolean {
  return verifySecurityEvent(event, secret);
}
