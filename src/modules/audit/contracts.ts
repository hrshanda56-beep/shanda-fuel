import {
  serializeSafe,
  signSecurityEvent,
  verifySecurityEvent,
  type SignedSecurityEvent,
} from '../../platform/security';
import { sql } from 'drizzle-orm';
import { getDatabase, type Database } from '../../platform/db';

export type SecurityEventScope = 'IDENTITY' | 'TENANT' | 'PLATFORM';
export type AuditActorType = 'HUMAN' | 'SYSTEM' | 'SUPPORT';

export type AuditEventDraft = {
  eventId: string;
  eventScope: SecurityEventScope;
  tenantId?: string;
  membershipId?: string;
  actorId?: string;
  actorType: AuditActorType;
  initiatedBy?: string;
  actionCode: string;
  subjectType?: string;
  subjectId?: string;
  requestId: string;
  occurredAt: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
  metadata?: Record<string, unknown>;
};

function assertEventScope(draft: AuditEventDraft): void {
  if (draft.eventScope === 'TENANT' && !draft.tenantId) {
    throw new Error('Tenant security events require tenantId');
  }
  if (draft.eventScope !== 'TENANT' && draft.tenantId) {
    throw new Error('Identity and platform security events cannot carry tenantId');
  }
  if (draft.membershipId && draft.eventScope !== 'TENANT') {
    throw new Error('Membership security events require tenant scope');
  }
}

export function signAuditEvent(
  draft: AuditEventDraft,
  key: { keyId: string; secret: string },
): SignedSecurityEvent {
  assertEventScope(draft);
  return signSecurityEvent(
    {
      eventId: draft.eventId,
      eventScope: draft.eventScope,
      tenantId: draft.tenantId,
      membershipId: draft.membershipId,
      actorId: draft.actorId,
      eventCode: draft.actionCode,
      requestId: draft.requestId,
      occurredAt: draft.occurredAt,
      details: serializeSafe({
        actorType: draft.actorType,
        after: draft.after,
        before: draft.before,
        initiatedBy: draft.initiatedBy,
        metadata: draft.metadata,
        reason: draft.reason,
        subjectId: draft.subjectId,
        subjectType: draft.subjectType,
      }),
    },
    key,
  );
}

/** Append one independently signed security event; this never updates or deletes. */
export async function appendSecurityEvent(
  draft: AuditEventDraft,
  key: { keyId: string; secret: string },
  executor: Pick<Database, 'execute'> = getDatabase(),
): Promise<SignedSecurityEvent> {
  const signed = signAuditEvent(draft, key);
  await executor.execute(sql`
    insert into platform.security_events (
      id, event_scope, tenant_id, membership_id, actor_id, event_code,
      request_id, occurred_at, details, key_id, algorithm, signature
    ) values (
      ${signed.eventId}, ${signed.eventScope}, ${signed.tenantId ?? null},
      ${signed.membershipId ?? null}, ${signed.actorId ?? null}, ${signed.eventCode},
      ${signed.requestId}, ${signed.occurredAt}, ${JSON.stringify(signed.details)}::jsonb,
      ${signed.keyId}, ${signed.algorithm}, ${signed.signature}
    )
  `);
  return signed;
}

export function verifyAuditEvent(event: SignedSecurityEvent, secret: string): boolean {
  return verifySecurityEvent(event, secret);
}
