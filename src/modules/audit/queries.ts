import 'server-only';

import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { withTenantTransaction } from '../../platform/db/transaction';
import { authorize } from '../../platform/security/permissions';
import { resolveTenantExecutionContext } from '../tenancy/authority';
import { toAuditItem, type AuditItem } from './audit-view';

const querySchema = z.object({
  tenantId: z.string().uuid(),
  /** One area, for example "CASH"; omit for everything. */
  area: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]{0,40}$/)
    .optional(),
  /** Page after this event, newest first: "<occurredAt ISO>|<id>". */
  after: z
    .string()
    .regex(/^[0-9T:.\-+Z]+\|[0-9a-f-]{36}$/i)
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type AuditPage = Readonly<{ items: readonly AuditItem[]; next: string | null }>;

/**
 * The organisation's signed audit log, newest first. Needs the audit permission at organisation
 * level, so a person who can see one station cannot read the whole organisation's history.
 */
export async function listAuditEventsFromRequest(
  request: Request,
  rawInput: unknown,
): Promise<AuditPage> {
  const input = querySchema.parse(rawInput);
  const authority = await resolveTenantExecutionContext({
    request,
    requestedTenantId: input.tenantId,
  });
  authorize({
    actor: authority.authorization,
    permissionCode: 'audit.view',
    requestedScope: { tenantId: input.tenantId, scopeType: 'TENANT' },
  });
  const [afterAt, afterId] = input.after ? input.after.split('|') : [];
  const rows = await withTenantTransaction(authority.transaction, (transaction) =>
    transaction.execute<{
      id: string;
      event_code: string;
      occurred_at: Date | string;
      actor_name: string | null;
      details: unknown;
    }>(sql`
      select e.id, e.event_code, e.occurred_at,
             coalesce(nullif(u.name, ''), u.email) as actor_name, e.details
      from platform.security_events e
      left join app.memberships m on m.tenant_id = e.tenant_id and m.id = e.membership_id
      left join app.users u on u.id = m.identity_id
      where e.tenant_id = ${input.tenantId}
        ${input.area ? sql`and e.event_code like ${`${input.area}.%`}` : sql``}
        ${
          afterAt && afterId
            ? sql`and (e.occurred_at, e.id) < (${afterAt}::timestamptz, ${afterId}::uuid)`
            : sql``
        }
      order by e.occurred_at desc, e.id desc
      limit ${input.limit + 1}
    `),
  );
  const page = rows.slice(0, input.limit);
  const last = page[page.length - 1];
  return {
    items: page.map((row) =>
      toAuditItem({
        id: row.id,
        eventCode: row.event_code,
        occurredAt: new Date(row.occurred_at).toISOString(),
        actorName: row.actor_name,
        details: row.details,
      }),
    ),
    next:
      rows.length > input.limit && last
        ? `${new Date(last.occurred_at).toISOString()}|${last.id}`
        : null,
  };
}
