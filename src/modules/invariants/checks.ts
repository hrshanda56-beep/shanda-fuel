import 'server-only';

import { sql, type SQL } from 'drizzle-orm';
import { tanksMissingClosingDip } from '../forecourt/closing-shift-dips';

/**
 * G3: statements that must be true of the data at all times. Each check returns the records that
 * break it; none returned means it holds. They read only, run against the demo seed and the test
 * database, and say in plain words what is wrong so a person can find the record.
 */
type Executor = { execute(query: SQL): PromiseLike<readonly Record<string, unknown>[]> };

export type InvariantResult = Readonly<{
  code: string;
  rule: string;
  violations: readonly string[];
}>;

type Scope = Readonly<{ tenantId?: string }>;

const forTenant = (alias: string, scope: Scope) =>
  scope.tenantId ? sql`and ${sql.raw(`${alias}.tenant_id`)} = ${scope.tenantId}` : sql``;

async function rows<T>(transaction: Executor, query: SQL): Promise<T[]> {
  return (await transaction.execute(query)) as unknown as T[];
}

export async function runInvariantChecks(
  transaction: Executor,
  scope: Scope = {},
): Promise<InvariantResult[]> {
  const results: InvariantResult[] = [];
  const add = (code: string, rule: string, violations: readonly string[]) =>
    results.push({ code, rule, violations });

  // No tank ever holds less than nothing.
  const negative = await rows<{ code: string; litres: string }>(
    transaction,
    sql`
      select t.code, sum(m.quantity_litres)::text as litres
      from app.inventory_movements m
      join app.tanks t on t.tenant_id = m.tenant_id and t.id = m.tank_id
      where true ${forTenant('m', scope)}
      group by t.tenant_id, t.id, t.code
      having sum(m.quantity_litres) < 0
    `,
  );
  add(
    'NO_NEGATIVE_STOCK',
    'No tank holds negative stock.',
    negative.map((row) => `Tank ${row.code} holds ${row.litres} L`),
  );

  // A collection cannot be put into more deposits than it contains.
  const overAllocated = await rows<{ reference: string; amount: string; allocated: string }>(
    transaction,
    sql`
      select c.collection_reference as reference, c.amount::text as amount,
        sum(a.amount)::text as allocated
      from app.cash_collections c
      join app.bank_deposit_allocations a
        on a.tenant_id = c.tenant_id and a.station_id = c.station_id and a.collection_id = c.id
      join app.bank_deposits d
        on d.tenant_id = a.tenant_id and d.station_id = a.station_id and d.id = a.deposit_id
       and d.state <> 'REVERSED'
      where c.state <> 'REVERSED' ${forTenant('c', scope)}
      group by c.tenant_id, c.id, c.collection_reference, c.amount
      having sum(a.amount) > c.amount
    `,
  );
  add(
    'CASH_NOT_DEPOSITED_TWICE',
    'No collection is deposited for more than it contains.',
    overAllocated.map(
      (row) => `Collection ${row.reference}: ${row.allocated} deposited of ${row.amount}`,
    ),
  );

  // A deposit is exactly the sum of the collections put into it.
  const depositMismatch = await rows<{ reference: string; amount: string; allocated: string }>(
    transaction,
    sql`
      select d.deposit_reference as reference, d.amount::text as amount,
        coalesce(sum(a.amount), 0)::text as allocated
      from app.bank_deposits d
      left join app.bank_deposit_allocations a
        on a.tenant_id = d.tenant_id and a.station_id = d.station_id and a.deposit_id = d.id
      where d.state <> 'REVERSED' ${forTenant('d', scope)}
      group by d.tenant_id, d.id, d.deposit_reference, d.amount
      having coalesce(sum(a.amount), 0) <> d.amount
    `,
  );
  add(
    'DEPOSIT_EQUALS_ITS_COLLECTIONS',
    'Every deposit equals the collections put into it.',
    depositMismatch.map(
      (row) => `Deposit ${row.reference}: ${row.amount} but ${row.allocated} allocated`,
    ),
  );

  // A supplier payment cannot be allocated to invoices for more than it paid.
  const overPaid = await rows<{ reference: string; amount: string; allocated: string }>(
    transaction,
    sql`
      select p.payment_reference as reference, p.amount::text as amount,
        sum(a.amount)::text as allocated
      from app.supplier_payments p
      join app.supplier_payment_allocations a
        on a.tenant_id = p.tenant_id and a.payment_id = p.id and a.state = 'POSTED'
       and not exists (
         select 1 from app.supplier_payment_allocations r
         where r.tenant_id = a.tenant_id and r.reversal_of_id = a.id and r.state = 'REVERSED'
       )
      where true ${forTenant('p', scope)}
      group by p.tenant_id, p.id, p.payment_reference, p.amount
      having sum(a.amount) > p.amount
    `,
  );
  add(
    'PAYMENT_NOT_OVER_ALLOCATED',
    'No supplier payment is allocated for more than its amount.',
    overPaid.map((row) => `Payment ${row.reference}: ${row.allocated} allocated of ${row.amount}`),
  );

  // Every approved report for the last shift of a day has a dip for every active tank.
  const approved = await rows<{ id: string; tenant_id: string; station_id: string }>(
    transaction,
    sql`
      select r.id, r.tenant_id, r.station_id
      from app.reconciliations r
      where r.state in ('APPROVED', 'POSTED', 'LOCKED') and r.shift_id is not null
        ${forTenant('r', scope)}
    `,
  );
  const withoutDips: string[] = [];
  for (const reconciliation of approved) {
    const missing = await tanksMissingClosingDip(transaction, {
      tenantId: reconciliation.tenant_id,
      stationId: reconciliation.station_id,
      reconciliationId: reconciliation.id,
    });
    if (missing.length > 0) {
      withoutDips.push(`Report ${reconciliation.id} has no dip for ${missing.join(', ')}`);
    }
  }
  add(
    'APPROVED_DAY_HAS_DIPS',
    'Every approved report for the last shift of a day has a dip for every active tank.',
    withoutDips,
  );

  return results;
}

export function failedInvariants(results: readonly InvariantResult[]): InvariantResult[] {
  return results.filter((result) => result.violations.length > 0);
}
