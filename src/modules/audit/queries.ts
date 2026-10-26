import 'server-only';

import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { withTenantTransaction } from '../../platform/db/transaction';
import { authorize } from '../../platform/security/permissions';
import { resolveTenantExecutionContext } from '../tenancy/authority';
import { toAuditItem, type AuditItem, type SubjectNames } from './audit-view';

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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Subject = { type: string; id: string };

function subjectsOf(details: unknown): Subject | null {
  if (typeof details !== 'object' || details === null) return null;
  const { subjectType, subjectId } = details as { subjectType?: unknown; subjectId?: unknown };
  return typeof subjectType === 'string' && typeof subjectId === 'string' && UUID.test(subjectId)
    ? { type: subjectType, id: subjectId }
    : null;
}

/** Names for the stations, companies, customers and so on that the page's events touched. */
async function lookupSubjectNames(
  transaction: Parameters<Parameters<typeof withTenantTransaction>[1]>[0],
  tenantId: string,
  details: readonly unknown[],
): Promise<SubjectNames> {
  const wanted = new Map<string, Subject>();
  for (const item of details) {
    const subject = subjectsOf(item);
    if (subject) wanted.set(`${subject.type}:${subject.id}`, subject);
  }
  const idsOf = (type: string) =>
    [...wanted.values()].filter((subject) => subject.type === type).map((subject) => subject.id);
  const inList = (ids: string[]) =>
    sql.join(
      ids.map((id) => sql`${id}::uuid`),
      sql`, `,
    );
  const parts: ReturnType<typeof sql>[] = [];
  const add = (type: string, query: (ids: ReturnType<typeof inList>) => ReturnType<typeof sql>) => {
    const ids = idsOf(type);
    if (ids.length > 0) parts.push(query(inList(ids)));
  };
  add(
    'Station',
    (ids) =>
      sql`select 'Station' as t, id::text, name from app.stations where tenant_id = ${tenantId} and id in (${ids})`,
  );
  add(
    'LegalEntity',
    (ids) =>
      sql`select 'LegalEntity', id::text, legal_name from app.legal_entities where tenant_id = ${tenantId} and id in (${ids})`,
  );
  add(
    'Customer',
    (ids) =>
      sql`select 'Customer', id::text, display_name from app.customers where tenant_id = ${tenantId} and id in (${ids})`,
  );
  add(
    'Supplier',
    (ids) =>
      sql`select 'Supplier', id::text, legal_name from app.suppliers where tenant_id = ${tenantId} and id in (${ids})`,
  );
  add(
    'BankAccount',
    (ids) =>
      sql`select 'BankAccount', id::text, name from app.bank_accounts where tenant_id = ${tenantId} and id in (${ids})`,
  );
  add(
    'StationBusinessDay',
    (ids) =>
      sql`select 'StationBusinessDay', d.id::text, s.name || ', ' || d.business_date from app.station_business_days d join app.stations s on s.tenant_id = d.tenant_id and s.id = d.station_id where d.tenant_id = ${tenantId} and d.id in (${ids})`,
  );
  add(
    'Shift',
    (ids) =>
      sql`select 'Shift', h.id::text, s.name || ', ' || h.business_date from app.shifts h join app.stations s on s.tenant_id = h.tenant_id and s.id = h.station_id where h.tenant_id = ${tenantId} and h.id in (${ids})`,
  );
  if (parts.length === 0) return new Map();
  const rows = await transaction.execute<{ t: string; id: string; name: string | null }>(
    sql.join(parts, sql` union all `),
  );
  return new Map(
    rows.filter((row) => row.name).map((row) => [`${row.t}:${row.id}`, row.name as string]),
  );
}

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
  const { rows, names } = await withTenantTransaction(
    authority.transaction,
    async (transaction) => {
      const found = await transaction.execute<{
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
    `);
      const names = await lookupSubjectNames(
        transaction,
        input.tenantId,
        found.slice(0, input.limit).map((row) => row.details),
      );
      return { rows: [...found], names };
    },
  );
  const page = rows.slice(0, input.limit);
  const last = page[page.length - 1];
  return {
    items: page.map((row) =>
      toAuditItem(
        {
          id: row.id,
          eventCode: row.event_code,
          occurredAt: new Date(row.occurred_at).toISOString(),
          actorName: row.actor_name,
          details: row.details,
        },
        names,
      ),
    ),
    next:
      rows.length > input.limit && last
        ? `${new Date(last.occurred_at).toISOString()}|${last.id}`
        : null,
  };
}
