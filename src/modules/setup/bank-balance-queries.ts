import 'server-only';

import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { withTenantTransaction } from '../../platform/db/transaction';
import { isPermissionGranted } from '../../platform/security/permissions';
import { resolveTenantExecutionContext } from '../tenancy/authority';

export type BankBalanceAccount = Readonly<{
  id: string;
  name: string;
  bankName: string;
  accountReference: string;
  /** The latest balance typed in from the statement, or null when none has been. */
  balance: string | null;
  asOfDate: string | null;
}>;

export type BankBalanceView = Readonly<{
  accounts: readonly BankBalanceAccount[];
  canRecord: boolean;
}>;

export async function getBankBalancesFromRequest(
  request: Request,
  rawInput: unknown,
): Promise<BankBalanceView> {
  const { tenantId } = z.object({ tenantId: z.string().uuid() }).parse(rawInput);
  const authority = await resolveTenantExecutionContext({ request, requestedTenantId: tenantId });
  const canRecord = isPermissionGranted({
    actor: authority.authorization,
    permissionCode: 'cash.deposit.confirm',
    requestedScope: { tenantId, scopeType: 'TENANT' },
  });
  const rows = await withTenantTransaction(authority.transaction, (transaction) =>
    transaction.execute<{
      id: string;
      name: string;
      bank_name: string;
      account_reference_masked: string;
      balance: string | null;
      as_of_date: string | null;
    }>(sql`
      select a.id, a.name, a.bank_name, a.account_reference_masked,
        latest.balance::text as balance, latest.as_of_date::text as as_of_date
      from app.bank_accounts a
      left join lateral (
        select s.balance, s.as_of_date from app.bank_balance_statements s
        where s.tenant_id = a.tenant_id and s.bank_account_id = a.id
        order by s.as_of_date desc, s.entered_at desc limit 1
      ) latest on true
      where a.tenant_id = ${tenantId} and a.status = 'ACTIVE'
      order by a.name
    `),
  );
  return {
    canRecord,
    accounts: rows.map((row) => ({
      id: row.id,
      name: row.name,
      bankName: row.bank_name,
      accountReference: row.account_reference_masked,
      balance: row.balance,
      asOfDate: row.as_of_date,
    })),
  };
}
