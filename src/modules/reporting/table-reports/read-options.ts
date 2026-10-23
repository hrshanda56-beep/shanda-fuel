import 'server-only';

import { sql } from 'drizzle-orm';
import type { Database } from '../../../platform/db';
import type { TableReportFilterKey } from './definitions';
import { PAYMENT_METHOD_OPTIONS } from './narrowing';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export type FilterOption = Readonly<{ id: string; label: string }>;
export type FilterOptions = Partial<Record<TableReportFilterKey, readonly FilterOption[]>>;

const MAX_OPTIONS = 500;

/**
 * The choices for the extra report filters. Read inside the same tenant transaction as the
 * report, so a person only ever sees choices from their own organisation.
 */
export async function loadFilterOptions(
  transaction: Transaction,
  tenantId: string,
  keys: readonly TableReportFilterKey[],
): Promise<FilterOptions> {
  const out: FilterOptions = {};
  const take = async (query: ReturnType<typeof sql>) =>
    (await transaction.execute<{ id: string; label: string }>(query)).map((row) => ({
      id: row.id,
      label: row.label,
    }));
  for (const key of keys) {
    if (key === 'product') {
      out.product = await take(sql`
        select id, name as label from app.products
        where tenant_id = ${tenantId} order by name limit ${MAX_OPTIONS}`);
    } else if (key === 'supplier') {
      out.supplier = await take(sql`
        select id, legal_name as label from app.suppliers
        where tenant_id = ${tenantId} order by legal_name limit ${MAX_OPTIONS}`);
    } else if (key === 'customer') {
      out.customer = await take(sql`
        select id, display_name as label from app.customers
        where tenant_id = ${tenantId} order by display_name limit ${MAX_OPTIONS}`);
    } else if (key === 'employee') {
      out.employee = await take(sql`
        select m.id, coalesce(nullif(u.name, ''), u.email) as label
        from app.memberships m join app.users u on u.id = m.identity_id
        where m.tenant_id = ${tenantId} and m.status = 'ACTIVE'
        order by 2 limit ${MAX_OPTIONS}`);
    } else if (key === 'shift') {
      out.shift = await take(sql`
        select t.id, t.name || ' (' || s.name || ')' as label
        from app.shift_templates t
        join app.stations s on s.tenant_id = t.tenant_id and s.id = t.station_id
        where t.tenant_id = ${tenantId} and t.active
        order by s.name, t.start_time, t.name limit ${MAX_OPTIONS}`);
    } else {
      out.paymentMethod = PAYMENT_METHOD_OPTIONS;
    }
  }
  return out;
}
