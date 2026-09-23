import { z } from 'zod';
import type { CustomerAccountBalance, CustomerLedgerEntry } from './domain';
import { customerStatementQuerySchema } from './validation';

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
