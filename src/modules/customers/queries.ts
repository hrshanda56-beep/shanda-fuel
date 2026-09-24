import { z } from 'zod';
import type { CustomerAccountBalance, CustomerLedgerEntry } from './domain';
import { customerStatementQuerySchema } from './validation';
import { authorizeCustomerCommand, resolveCustomerCommandContext } from './application';
import { withTenantTransaction } from '../../platform/db/transaction';
import { deriveAccountBalance } from './domain';
import { loadAccount } from './persistence';

export type CustomerStatementLine = Readonly<{
  entry: CustomerLedgerEntry;
  runningBalance: CustomerAccountBalance;
}>;

export type CustomerAccountStatement = Readonly<{
  accountId: string;
  balance: CustomerAccountBalance;
  lines: readonly CustomerStatementLine[];
  asOf?: string;
  nextCursor?: string;
}>;

export type CustomerAccountQuery = z.infer<typeof customerStatementQuerySchema>;

/** Query contract; implementation must execute inside trusted tenant context. */
export interface CustomerAccountQueries {
  statement(input: CustomerAccountQuery): Promise<CustomerAccountStatement>;
}

export async function getCustomerAccountStatementFromRequest(
  request: Request,
  input: unknown,
): Promise<CustomerAccountStatement> {
  const query = customerStatementQuerySchema.parse(input);
  const context = await resolveCustomerCommandContext({
    request,
    requestedTenantId: query.tenantId,
  });
  authorizeCustomerCommand(context, 'customer.statement.view');
  return withTenantTransaction(context.authority.transaction, async (transaction) => {
    const loaded = await loadAccount(transaction, context, query.accountId, false);
    const asOfEntries = query.asOf
      ? loaded.entries.filter((entry) => entry.occurredAt <= query.asOf!)
      : loaded.entries;
    const cursorIndex = query.cursor
      ? asOfEntries.findIndex((entry) => entry.id === query.cursor)
      : -1;
    const start = cursorIndex >= 0 ? cursorIndex + 1 : 0;
    const page = asOfEntries.slice(start, start + query.limit);
    const balance = deriveAccountBalance(loaded.account, asOfEntries);
    const lines = page.map((entry) => {
      const index = asOfEntries.findIndex((candidate) => candidate.id === entry.id);
      return {
        entry,
        runningBalance: deriveAccountBalance(loaded.account, asOfEntries.slice(0, index + 1)),
      };
    });
    const nextCursor = start + page.length < asOfEntries.length ? page.at(-1)?.id : undefined;
    return {
      accountId: query.accountId,
      balance,
      lines,
      ...(query.asOf ? { asOf: query.asOf } : {}),
      ...(nextCursor ? { nextCursor } : {}),
    };
  });
}
