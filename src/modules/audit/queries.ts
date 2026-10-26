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
  add(
    'Tank',
    (ids) =>
      sql`select 'Tank', t.id::text, 'tank ' || t.code || ' (' || p.name || ')' from app.tanks t join app.products p on p.tenant_id = t.tenant_id and p.id = t.product_id where t.tenant_id = ${tenantId} and t.id in (${ids})`,
  );
  add(
    'FuelDelivery',
    (ids) =>
      sql`select 'FuelDelivery', d.id::text, 'note ' || d.delivery_note_number from app.fuel_deliveries d where d.tenant_id = ${tenantId} and d.id in (${ids})`,
  );
  add(
    'SellingPrice',
    (ids) =>
      sql`select 'SellingPrice', sp.id::text, p.name || ' at ' || sp.unit_price::numeric(20,4)::text from app.selling_prices sp join app.products p on p.tenant_id = sp.tenant_id and p.id = sp.product_id where sp.tenant_id = ${tenantId} and sp.id in (${ids})`,
  );
  add(
    'Expense',
    (ids) =>
      sql`select 'Expense', e.id::text, e.description from app.expenses e where e.tenant_id = ${tenantId} and e.id in (${ids})`,
  );
  add(
    'PurchaseOrder',
    (ids) =>
      sql`select 'PurchaseOrder', o.id::text, 'order ' || o.order_number from app.purchase_orders o where o.tenant_id = ${tenantId} and o.id in (${ids})`,
  );
  add(
    'SupplierDocument',
    (ids) =>
      sql`select 'SupplierDocument', d.id::text, d.reference_number from app.supplier_documents d where d.tenant_id = ${tenantId} and d.id in (${ids})`,
  );
  add(
    'SupplierPayment',
    (ids) =>
      sql`select 'SupplierPayment', p.id::text, p.payment_reference from app.supplier_payments p where p.tenant_id = ${tenantId} and p.id in (${ids})`,
  );
  add(
    'Membership',
    (ids) =>
      sql`select 'Membership', m.id::text, coalesce(nullif(u.name, ''), u.email) from app.memberships m join app.users u on u.id = m.identity_id where m.tenant_id = ${tenantId} and m.id in (${ids})`,
  );
  add(
    'CustomerAccount',
    (ids) =>
      sql`select 'CustomerAccount', a.id::text, c.display_name from app.customer_accounts a join app.customers c on c.tenant_id = a.tenant_id and c.id = a.customer_id where a.tenant_id = ${tenantId} and a.id in (${ids})`,
  );
  add(
    'ProviderSettlement',
    (ids) =>
      sql`select 'ProviderSettlement', s.id::text, s.settlement_reference from app.provider_settlements s where s.tenant_id = ${tenantId} and s.id in (${ids})`,
  );
  add(
    'Reconciliation',
    (ids) =>
      sql`select 'Reconciliation', r.id::text, s.name || ', ' || d.business_date from app.reconciliations r join app.station_business_days d on d.tenant_id = r.tenant_id and d.id = r.business_day_id join app.stations s on s.tenant_id = r.tenant_id and s.id = r.station_id where r.tenant_id = ${tenantId} and r.id in (${ids})`,
  );
  add(
    'Product',
    (ids) =>
      sql`select 'Product', id::text, name from app.products where tenant_id = ${tenantId} and id in (${ids})`,
  );
  if (parts.length === 0) return new Map();
  // Named by position, because the first branch of a union names the columns for all the rest.
  const rows = await transaction.execute<{ t: string; id: string; name: string | null }>(
    sql`select t, id, name from (${sql.join(parts, sql` union all `)}) as found(t, id, name)`,
  );
  return new Map(
    rows.filter((row) => row.name).map((row) => [`${row.t}:${row.id}`, row.name as string]),
  );
}

const UUID_IN_TEXT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Every identifier that appears as a value inside the old and new values of these events. */
function idsInChanges(details: readonly unknown[]): string[] {
  const found = new Set<string>();
  for (const item of details) {
    if (typeof item !== 'object' || item === null) continue;
    const { before, after } = item as { before?: unknown; after?: unknown };
    for (const part of [before, after]) {
      for (const match of JSON.stringify(part ?? null).matchAll(UUID_IN_TEXT)) found.add(match[0]);
    }
  }
  return [...found].slice(0, 100);
}

/** Names for identifiers that appear as values, whatever kind of record they point at. */
async function lookupValueNames(
  transaction: Parameters<Parameters<typeof withTenantTransaction>[1]>[0],
  tenantId: string,
  ids: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  if (ids.length === 0) return new Map();
  const list = sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const rows = await transaction.execute<{ id: string; name: string | null }>(sql`
    select id::text, name from app.stations where tenant_id = ${tenantId} and id in (${list})
    union all select id::text, legal_name from app.legal_entities where tenant_id = ${tenantId} and id in (${list})
    union all select id::text, name from app.products where tenant_id = ${tenantId} and id in (${list})
    union all select id::text, 'tank ' || code from app.tanks where tenant_id = ${tenantId} and id in (${list})
    union all select id::text, legal_name from app.suppliers where tenant_id = ${tenantId} and id in (${list})
    union all select id::text, display_name from app.customers where tenant_id = ${tenantId} and id in (${list})
    union all select id::text, name from app.bank_accounts where tenant_id = ${tenantId} and id in (${list})
    union all select m.id::text, coalesce(nullif(u.name, ''), u.email)
      from app.memberships m join app.users u on u.id = m.identity_id
      where m.tenant_id = ${tenantId} and m.id in (${list})
  `);
  return new Map(rows.filter((row) => row.name).map((row) => [row.id, row.name as string]));
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
  const { rows, names, valueNames } = await withTenantTransaction(
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
      const shown = found.slice(0, input.limit).map((row) => row.details);
      const names = await lookupSubjectNames(transaction, input.tenantId, shown);
      const valueNames = await lookupValueNames(transaction, input.tenantId, idsInChanges(shown));
      return { rows: [...found], names, valueNames };
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
        valueNames,
      ),
    ),
    next:
      rows.length > input.limit && last
        ? `${new Date(last.occurred_at).toISOString()}|${last.id}`
        : null,
  };
}
