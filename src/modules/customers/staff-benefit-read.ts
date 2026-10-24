import 'server-only';

import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { withTenantTransaction } from '../../platform/db/transaction';
import { authorizeCustomerCommand } from './application';
import { resolveCustomerReadContext } from './read-context';
import type { StaffBenefitLine } from './staff-benefit';
import {
  buildStaffBenefitRows,
  type StaffBenefitAccountFact,
  type StaffBenefitRow,
} from './staff-benefit-rows';

const querySchema = z.object({ tenantId: z.string().uuid() });

/**
 * Staff fuel benefit accounts with this month's use against the monthly limit. The month is the
 * calendar month at the account's company stations (station timezone); with no station timezone
 * on file the use is returned as null, never guessed. Needs the statement permission.
 */
export async function getStaffBenefitAccountsFromRequest(
  request: Request,
  input: unknown,
): Promise<readonly StaffBenefitRow[]> {
  const query = querySchema.parse(input);
  const context = await resolveCustomerReadContext({ request, requestedTenantId: query.tenantId });
  authorizeCustomerCommand(context, 'customer.statement.view');
  return withTenantTransaction(context.authority.transaction, async (transaction) => {
    const accounts = await transaction.execute<{
      account_id: string;
      customer_id: string;
      display_name: string;
      account_reference: string;
      staff_name: string;
      status: StaffBenefitAccountFact['status'];
      credit_limit: string | null;
      today: string | null;
    }>(sql`
      select a.id as account_id, c.id as customer_id, c.display_name, c.account_reference,
             t.staff_name, a.status, a.credit_limit::text as credit_limit,
             (select to_char(now() at time zone s.timezone, 'YYYY-MM-DD')
                from app.stations s
               where s.tenant_id = a.tenant_id and s.legal_entity_id = a.legal_entity_id
               order by s.code limit 1) as today
      from app.customer_staff_benefit_terms t
      join app.customer_accounts a on a.tenant_id = t.tenant_id and a.id = t.account_id
      join app.customers c on c.tenant_id = a.tenant_id and c.id = a.customer_id
      where t.tenant_id = ${context.tenantId}
      order by t.staff_name, a.id
    `);
    const lines = await transaction.execute<{
      account_id: string;
      id: string;
      direction: 'INCREASE' | 'DECREASE';
      entry_type: string;
      business_date: string;
      amount: string;
      reversal_of_entry_id: string | null;
    }>(sql`
      select l.account_id, l.id, l.direction, l.entry_type, l.business_date,
             l.amount::text as amount, l.reversal_of_entry_id
      from app.customer_ledger_entries l
      join app.customer_staff_benefit_terms t
        on t.tenant_id = l.tenant_id and t.account_id = l.account_id
      where l.tenant_id = ${context.tenantId} and l.account_type = 'CREDIT'
      order by l.account_id, l.business_date, l.occurred_at, l.id
    `);
    const byAccount = new Map<string, StaffBenefitLine[]>();
    for (const row of lines) {
      const list = byAccount.get(row.account_id) ?? [];
      list.push({
        id: row.id,
        direction: row.direction,
        entryType: row.entry_type,
        businessDate: row.business_date,
        amount: row.amount,
        reversalOfEntryId: row.reversal_of_entry_id,
      });
      byAccount.set(row.account_id, list);
    }
    return buildStaffBenefitRows(
      accounts.map((row) => ({
        accountId: row.account_id,
        customerId: row.customer_id,
        customerName: row.display_name,
        accountReference: row.account_reference,
        staffName: row.staff_name,
        status: row.status,
        limit: row.credit_limit,
        today: row.today,
      })),
      byAccount,
    );
  });
}
