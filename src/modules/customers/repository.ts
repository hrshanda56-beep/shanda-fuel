import type {
  Customer,
  CustomerAccount,
  CustomerAccountBalance,
  CustomerFuelAuthorization,
  CustomerLedgerEntry,
  CustomerSourceReference,
} from './domain';

/**
 * Persistence ports only. The future adapter must bind these ports to the
 * existing tenant transaction, idempotency, and audit infrastructure; this
 * module deliberately contains no database implementation during parallel
 * preparation.
 */
export type CustomerAggregate = Readonly<{
  customer: Customer;
  account: CustomerAccount;
  entries: readonly CustomerLedgerEntry[];
  authorizations: readonly CustomerFuelAuthorization[];
}>;

export interface CustomerRepository {
  findById(input: { tenantId: string; customerId: string }): Promise<Customer | null>;
  save(customer: Customer): Promise<void>;
}

export interface CustomerAccountRepository {
  loadForUpdate(input: { tenantId: string; accountId: string }): Promise<CustomerAggregate | null>;
  appendLedgerEntry(entry: CustomerLedgerEntry): Promise<void>;
  saveAuthorization(authorization: CustomerFuelAuthorization): Promise<void>;
  findLedgerEntryBySource(input: {
    tenantId: string;
    accountId: string;
    source: CustomerSourceReference;
  }): Promise<CustomerLedgerEntry | null>;
}

export interface CustomerAccountQueryRepository {
  getBalance(input: { tenantId: string; accountId: string }): Promise<CustomerAccountBalance>;
  listStatement(input: {
    tenantId: string;
    accountId: string;
    asOf?: string;
    limit: number;
    cursor?: string;
  }): Promise<readonly CustomerLedgerEntry[]>;
}
