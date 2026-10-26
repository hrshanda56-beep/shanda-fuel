import 'server-only';

import { sql } from 'drizzle-orm';
import type { AgeingLedgerLine } from '../../customers/ageing';
import { buildCustomerAgeingRows } from './customer-ageing';
import type { TableReportReader } from './read';
import { equalsClause } from './read-extra';

/**
 * Credit-account ledger lines up to the report's end date ("as at"), grouped per account and aged
 * oldest-first. Only credit accounts are aged; prepaid accounts are not debts. Organisation-wide
 * (ADR-017: customer credit is kept for the organisation, not by station).
 */
export const readCustomerAgeing: TableReportReader = async (transaction, filters) => {
  const rows = await transaction.execute<{
    account_id: string;
    customer: string;
    account_reference: string;
    credit_days: number | null;
    id: string;
    business_date: string;
    direction: 'INCREASE' | 'DECREASE';
    amount: string;
  }>(sql`
    select l.account_id, c.display_name as customer, c.account_reference, a.credit_days,
           l.id, l.business_date, l.direction, l.amount::text as amount
    from app.customer_ledger_entries l
    join app.customers c on c.tenant_id = l.tenant_id and c.id = l.customer_id
    join app.customer_accounts a on a.tenant_id = l.tenant_id and a.id = l.account_id
    where l.tenant_id = ${filters.tenantId}
      and l.account_type = 'CREDIT'
      and l.business_date <= ${filters.toDate}
      ${equalsClause('l.customer_id', filters.customerId)}
    order by l.account_id, l.business_date, l.occurred_at, l.id
  `);
  const accounts = new Map<
    string,
    {
      customer: string;
      accountReference: string;
      creditDays: number | null;
      lines: AgeingLedgerLine[];
    }
  >();
  for (const row of rows) {
    const account = accounts.get(row.account_id) ?? {
      customer: row.customer,
      accountReference: row.account_reference,
      creditDays: row.credit_days === null ? null : Number(row.credit_days),
      lines: [],
    };
    account.lines.push({
      id: row.id,
      businessDate: row.business_date,
      direction: row.direction,
      amount: row.amount,
    });
    accounts.set(row.account_id, account);
  }
  return buildCustomerAgeingRows([...accounts.values()], filters.toDate);
};
