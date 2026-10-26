import 'server-only';

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { AppError } from '../../platform/errors';
import {
  ExactDecimal,
  businessDate,
  litres,
  money,
  type CurrencyCode,
} from '../../platform/domain/primitives';
import { assertA5EvidenceCompatibleWithAccount, type A5CustomerFuelEvidence } from './contracts';
import {
  createCustomerPaymentEntry,
  createPrepaidTopUpEntry,
  assertSourceReferenceUnused,
  assertCustomerAccountTransactionAllowed,
  assertStationAllowedForAccount,
  activateCustomer,
  customerLedgerSourceKey,
  deactivateCustomer,
  deriveAccountBalance,
  recordCustomerFuelUse,
  requestCustomerFuelAuthorization,
  reserveCustomerFuelAuthorization,
  cancelCustomerFuelAuthorization,
  expireCustomerFuelAuthorization,
  type ActiveReservation,
  type Customer,
  type CustomerAccount,
  type CustomerFuelAuthorization,
  type CustomerLedgerEntry,
  updateCustomerMasterData,
} from './domain';
import type { CustomerCommandContext, CustomerTransaction } from './application';
import { insertCustomerEntryDetails } from './entry-details-store';
import { assertCreditFuelDetails } from './entry-rules';
import type {
  CompleteCustomerFuelTransactionInput,
  CreateCustomerAccountInput,
  CreateCustomerInput,
  ActivateCustomerInput,
  DeactivateCustomerInput,
  RecordCustomerPaymentInput,
  RecordPrepaidTopUpInput,
  RequestCustomerFuelAuthorizationInput,
  SetCustomerAccountStationsInput,
  SetCustomerLegalEntityInput,
  UpdateCustomerInput,
} from './validation';

type AccountRow = {
  id: string;
  tenant_id: string;
  customer_id: string;
  account_type: CustomerAccount['accountType'];
  currency: 'USD';
  credit_limit: string | null;
  legal_entity_id: string | null;
  station_scope: 'ALL' | 'SELECTED';
  station_scope_configured: boolean;
  status: CustomerAccount['status'];
  version: number | string;
  account_reference: string;
  display_name: string;
  customer_status: Customer['status'];
  customer_legal_entity_id: string | null;
};

type LedgerRow = {
  id: string;
  tenant_id: string;
  customer_id: string;
  account_id: string;
  account_type: CustomerLedgerEntry['accountType'];
  entry_type: CustomerLedgerEntry['entryType'];
  direction: CustomerLedgerEntry['direction'];
  amount: string | null;
  product_id: string | null;
  quantity_litres: string | null;
  source_type: CustomerLedgerEntry['source']['sourceType'];
  source_id: string;
  source_revision_id: string | null;
  occurred_at: Date | string;
  business_date: string;
  note: string | null;
  reason: string | null;
  fuel_allocation_id: string | null;
  reversal_of_entry_id: string | null;
};

type AuthorizationRow = {
  id: string;
  tenant_id: string;
  station_id: string;
  customer_id: string;
  account_id: string;
  account_type: CustomerAccount['accountType'];
  product_id: string;
  currency: 'USD';
  requested_amount: string;
  requested_litres: string;
  used_amount: string;
  used_litres: string;
  remaining_amount: string;
  remaining_litres: string;
  state: CustomerFuelAuthorization['state'];
  source_type: CustomerFuelAuthorization['source']['sourceType'];
  source_id: string;
  source_revision_id: string | null;
  requested_by: string;
  requested_at: Date | string;
  version: number | string;
};

function at(value: Date | string): string {
  return new Date(value).toISOString();
}

function accountFromRow(row: AccountRow): CustomerAccount {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    customerId: row.customer_id,
    accountType: row.account_type,
    currency: row.currency,
    status: row.status,
    legalEntityId: row.legal_entity_id,
    stationScope: row.station_scope,
    stationScopeConfigured: row.station_scope_configured,
    ...(row.credit_limit !== null ? { creditLimit: money(row.credit_limit, row.currency) } : {}),
  };
}

function ledgerFromRow(row: LedgerRow, currency: CurrencyCode): CustomerLedgerEntry {
  const base = {
    id: row.id,
    tenantId: row.tenant_id,
    customerId: row.customer_id,
    accountId: row.account_id,
    accountType: row.account_type,
    entryType: row.entry_type,
    direction: row.direction,
    source: {
      sourceType: row.source_type,
      sourceId: row.source_id,
      ...(row.source_revision_id ? { sourceRevisionId: row.source_revision_id } : {}),
    },
    occurredAt: at(row.occurred_at),
    businessDate: businessDate(row.business_date),
    ...(row.note ? { note: row.note } : {}),
    ...(row.reason ? { reason: row.reason } : {}),
    ...(row.fuel_allocation_id ? { fuelAllocationId: row.fuel_allocation_id } : {}),
    ...(row.reversal_of_entry_id ? { reversalOfEntryId: row.reversal_of_entry_id } : {}),
  } as const;
  if (row.account_type === 'PREPAID_LITRES') {
    if (!row.product_id || !row.quantity_litres)
      throw new AppError('INVARIANT_VIOLATION', 'Stored prepaid litre entry is malformed');
    return {
      ...base,
      accountType: 'PREPAID_LITRES',
      entryType: row.entry_type as
        'PREPAID_TOPUP' | 'PREPAID_FUEL_USAGE' | 'ADJUSTMENT' | 'REVERSAL',
      productId: row.product_id,
      quantityLitres: litres(row.quantity_litres),
    } as CustomerLedgerEntry;
  }
  if (!row.amount) throw new AppError('INVARIANT_VIOLATION', 'Stored monetary entry is malformed');
  return {
    ...base,
    accountType: row.account_type,
    amount: money(row.amount, currency),
  } as CustomerLedgerEntry;
}

function authorizationFromRow(row: AuthorizationRow): CustomerFuelAuthorization {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    stationId: row.station_id,
    customerId: row.customer_id,
    accountId: row.account_id,
    accountType: row.account_type,
    requested: {
      productId: row.product_id,
      amount: money(row.requested_amount, row.currency),
      litres: litres(row.requested_litres),
    },
    used: {
      productId: row.product_id,
      amount: money(row.used_amount, row.currency),
      litres: litres(row.used_litres),
    },
    remaining: {
      productId: row.product_id,
      amount: money(row.remaining_amount, row.currency),
      litres: litres(row.remaining_litres),
    },
    state: row.state,
    requestedBy: row.requested_by,
    requestedAt: at(row.requested_at),
    source: {
      sourceType: row.source_type,
      sourceId: row.source_id,
      ...(row.source_revision_id ? { sourceRevisionId: row.source_revision_id } : {}),
    },
    version: Number(row.version),
  };
}

export async function loadAccount(
  transaction: CustomerTransaction,
  context: CustomerCommandContext,
  accountId: string,
  forUpdate = true,
): Promise<{ account: CustomerAccount; customer: Customer; entries: CustomerLedgerEntry[] }> {
  const accountLock = forUpdate ? sql`for update of a` : sql``;
  const rows = await transaction.execute<AccountRow>(sql`
    select a.id, a.tenant_id, a.customer_id, a.account_type, a.currency, a.credit_limit,
           a.legal_entity_id, a.station_scope, a.station_scope_configured,
           a.status, a.version, c.account_reference, c.display_name, c.status as customer_status,
           c.legal_entity_id as customer_legal_entity_id
    from app.customer_accounts a
    join app.customers c on c.tenant_id = a.tenant_id and c.id = a.customer_id
    where a.tenant_id = ${context.tenantId} and a.id = ${accountId}
    ${accountLock}
  `);
  const row = rows[0];
  if (!row) throw new AppError('NOT_FOUND', 'The customer account was not found');
  const entries = await transaction.execute<LedgerRow>(sql`
    select id, tenant_id, customer_id, account_id, account_type, entry_type, direction,
           amount, product_id, quantity_litres, source_type, source_id, source_revision_id,
           occurred_at, business_date, note, reason, fuel_allocation_id, reversal_of_entry_id
    from app.customer_ledger_entries
    where tenant_id = ${context.tenantId} and account_id = ${accountId}
    order by occurred_at, id
  `);
  return {
    account: accountFromRow(row),
    customer: {
      id: row.customer_id,
      tenantId: row.tenant_id,
      accountReference: row.account_reference,
      displayName: row.display_name,
      status: row.customer_status,
      legalEntityId: row.customer_legal_entity_id,
    },
    entries: entries.map((entry) => ledgerFromRow(entry, row.currency)),
  };
}

async function insertLedgerEntry(
  transaction: CustomerTransaction,
  entry: CustomerLedgerEntry,
  actorMembershipId: string,
  receivingStationId: string | null = null,
): Promise<void> {
  const sourceKey = customerLedgerSourceKey(entry.source);
  await transaction.execute(sql`
    insert into app.customer_ledger_entries
      (id, tenant_id, customer_id, account_id, account_type, entry_type, direction, amount,
       product_id, quantity_litres, source_type, source_id, source_revision_id, source_key,
       occurred_at, business_date, note, reason, fuel_allocation_id, reversal_of_entry_id, actor_membership_id,
       receiving_station_id)
    values
      (${entry.id}, ${entry.tenantId}, ${entry.customerId}, ${entry.accountId}, ${entry.accountType},
       ${entry.entryType}, ${entry.direction}, ${'amount' in entry ? entry.amount.amount.toString() : null},
       ${'productId' in entry ? entry.productId : null}, ${'quantityLitres' in entry ? entry.quantityLitres.toString() : null},
       ${entry.source.sourceType}, ${entry.source.sourceId}, ${entry.source.sourceRevisionId ?? null}, ${sourceKey},
       ${entry.occurredAt}::timestamptz, ${entry.businessDate}, ${entry.note ?? null}, ${entry.reason ?? null},
       ${entry.fuelAllocationId ?? null}, ${entry.reversalOfEntryId ?? null}, ${actorMembershipId},
       ${receivingStationId})
  `);
}

export async function createCustomerInTransaction(
  transaction: CustomerTransaction,
  context: CustomerCommandContext,
  input: CreateCustomerInput,
) {
  const id = randomUUID();
  if (input.legalEntityId) await assertLegalEntityExists(transaction, context, input.legalEntityId);
  await transaction.execute(sql`
    insert into app.customers (id, tenant_id, account_reference, display_name, contact_metadata, legal_entity_id, created_by, updated_by)
    values (${id}, ${context.tenantId}, ${input.accountReference}, ${input.displayName}, ${JSON.stringify(input.contactMetadata ?? {})}::jsonb, ${input.legalEntityId ?? null}, ${context.authority.membership.membershipId}, ${context.authority.membership.membershipId})
  `);
  return {
    customerId: id,
    accountReference: input.accountReference,
    legalEntityId: input.legalEntityId ?? null,
  };
}

async function assertLegalEntityExists(
  transaction: CustomerTransaction,
  context: CustomerCommandContext,
  legalEntityId: string,
) {
  const rows = await transaction.execute<{ id: string }>(sql`
    select id from app.legal_entities where tenant_id = ${context.tenantId} and id = ${legalEntityId}
  `);
  if (!rows[0]) throw new AppError('NOT_FOUND', 'The legal entity was not found');
}

/**
 * Sets the customer's one legal entity. It can be set once; moving a customer
 * to another legal entity is deliberately not supported here because it would
 * re-home an existing receivable.
 */
export async function setCustomerLegalEntityInTransaction(
  transaction: CustomerTransaction,
  context: CustomerCommandContext,
  input: SetCustomerLegalEntityInput,
) {
  const rows = await transaction.execute<{
    id: string;
    version: number | string;
    legal_entity_id: string | null;
  }>(sql`
    select id, version, legal_entity_id from app.customers
    where tenant_id = ${context.tenantId} and id = ${input.customerId}
    for update
  `);
  const row = rows[0];
  if (!row) throw new AppError('NOT_FOUND', 'The customer was not found');
  if (Number(row.version) !== input.expectedVersion)
    throw new AppError(
      'CONFLICT',
      'This customer was changed by someone else. Refresh the page and try again.',
    );
  if (row.legal_entity_id && row.legal_entity_id !== input.legalEntityId) {
    throw new AppError(
      'CONFLICT',
      'The customer already has a legal entity; moving a customer between legal entities is not supported',
    );
  }
  await assertLegalEntityExists(transaction, context, input.legalEntityId);
  const updated = await transaction.execute<{ version: number | string }>(sql`
    update app.customers
    set legal_entity_id = ${input.legalEntityId}, version = version + 1,
        updated_by = ${context.authority.membership.membershipId}, updated_at = now()
    where tenant_id = ${context.tenantId} and id = ${input.customerId} and version = ${input.expectedVersion}
    returning version
  `);
  if (!updated[0])
    throw new AppError(
      'CONFLICT',
      'This customer was changed by someone else. Refresh the page and try again.',
    );
  // Existing accounts adopt the customer's legal entity.
  await transaction.execute(sql`
    update app.customer_accounts
    set legal_entity_id = ${input.legalEntityId}, version = version + 1,
        updated_by = ${context.authority.membership.membershipId}, updated_at = now()
    where tenant_id = ${context.tenantId} and customer_id = ${input.customerId}
      and legal_entity_id is null
  `);
  return {
    customerId: input.customerId,
    legalEntityId: input.legalEntityId,
    version: Number(updated[0].version),
  };
}

type CustomerRow = {
  id: string;
  tenant_id: string;
  account_reference: string;
  display_name: string;
  contact_metadata: Record<string, string>;
  status: Customer['status'];
  version: number | string;
};

async function loadCustomerForUpdate(
  transaction: CustomerTransaction,
  context: CustomerCommandContext,
  customerId: string,
): Promise<CustomerRow> {
  const rows = await transaction.execute<CustomerRow>(sql`
    select id, tenant_id, account_reference, display_name, contact_metadata, status, version
    from app.customers
    where tenant_id=${context.tenantId} and id=${customerId}
    for update
  `);
  const row = rows[0];
  if (!row) throw new AppError('NOT_FOUND', 'The customer was not found');
  return row;
}

function customerFromRow(row: CustomerRow): Customer {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    accountReference: row.account_reference,
    displayName: row.display_name,
    status: row.status,
    contactMetadata: row.contact_metadata,
  };
}

async function persistCustomer(
  transaction: CustomerTransaction,
  context: CustomerCommandContext,
  row: CustomerRow,
  next: Customer,
  expectedVersion: number,
) {
  const updated = await transaction.execute<{ id: string; version: number | string }>(sql`
    update app.customers
    set account_reference=${next.accountReference},
        display_name=${next.displayName},
        contact_metadata=${JSON.stringify(next.contactMetadata ?? {})}::jsonb,
        status=${next.status},
        version=version+1,
        updated_by=${context.authority.membership.membershipId},
        updated_at=now()
    where tenant_id=${context.tenantId} and id=${row.id} and version=${expectedVersion}
    returning id, version
  `);
  if (!updated[0])
    throw new AppError(
      'CONFLICT',
      'This customer was changed by someone else. Refresh the page and try again.',
    );
  return {
    customerId: next.id,
    accountReference: next.accountReference,
    displayName: next.displayName,
    contactMetadata: next.contactMetadata ?? {},
    status: next.status,
    version: Number(updated[0].version),
  };
}

export async function updateCustomerInTransaction(
  transaction: CustomerTransaction,
  context: CustomerCommandContext,
  input: UpdateCustomerInput,
) {
  const row = await loadCustomerForUpdate(transaction, context, input.customerId);
  if (Number(row.version) !== input.expectedVersion)
    throw new AppError(
      'CONFLICT',
      'This customer was changed by someone else. Refresh the page and try again.',
    );
  return persistCustomer(
    transaction,
    context,
    row,
    updateCustomerMasterData(customerFromRow(row), input),
    input.expectedVersion,
  );
}

export async function activateCustomerInTransaction(
  transaction: CustomerTransaction,
  context: CustomerCommandContext,
  input: ActivateCustomerInput,
) {
  const row = await loadCustomerForUpdate(transaction, context, input.customerId);
  if (Number(row.version) !== input.expectedVersion)
    throw new AppError(
      'CONFLICT',
      'This customer was changed by someone else. Refresh the page and try again.',
    );
  return persistCustomer(
    transaction,
    context,
    row,
    activateCustomer(customerFromRow(row)),
    input.expectedVersion,
  );
}

export async function deactivateCustomerInTransaction(
  transaction: CustomerTransaction,
  context: CustomerCommandContext,
  input: DeactivateCustomerInput,
) {
  const row = await loadCustomerForUpdate(transaction, context, input.customerId);
  if (Number(row.version) !== input.expectedVersion)
    throw new AppError(
      'CONFLICT',
      'This customer was changed by someone else. Refresh the page and try again.',
    );
  return persistCustomer(
    transaction,
    context,
    row,
    deactivateCustomer(customerFromRow(row)),
    input.expectedVersion,
  );
}

export async function createCustomerAccountInTransaction(
  transaction: CustomerTransaction,
  context: CustomerCommandContext,
  input: CreateCustomerAccountInput,
) {
  const customer = await transaction.execute<{
    id: string;
    status: Customer['status'];
    legal_entity_id: string | null;
  }>(sql`
    select id, status, legal_entity_id from app.customers where tenant_id = ${context.tenantId} and id = ${input.customerId} for update
  `);
  if (!customer[0]) throw new AppError('NOT_FOUND', 'The customer was not found');
  if (customer[0].status !== 'ACTIVE')
    throw new AppError('CONFLICT', 'Accounts may only be opened for active customers');
  if (input.staffBenefit && input.accountType !== 'CREDIT')
    throw new AppError('VALIDATION_FAILED', 'A staff fuel benefit uses a credit account.');
  const accountId = randomUUID();
  const limit = input.creditLimit ?? null;
  const parsedLimit = limit ? new ExactDecimal(limit).value : null;
  if (
    input.accountType === 'CREDIT' &&
    (!parsedLimit || parsedLimit.isNegative() || parsedLimit.isZero())
  ) {
    throw new AppError('VALIDATION_FAILED', 'Credit accounts require a positive credit limit');
  }
  if (input.accountType !== 'CREDIT' && limit)
    throw new AppError('VALIDATION_FAILED', 'Credit limits apply only to credit accounts');
  const legalEntityId = customer[0].legal_entity_id;
  const stationScope = input.stationScope ?? 'ALL';
  if (stationScope === 'SELECTED' && !legalEntityId) {
    throw new AppError(
      'CONFLICT',
      'Set the customer legal entity before choosing the stations an account may use',
    );
  }
  // An omitted scope is deliberately not a confirmation. Keep the stored
  // enum value at ALL for schema compatibility, but fail closed until the
  // owner/admin explicitly submits SetCustomerAccountStations.
  const stationScopeConfigured = input.stationScope !== undefined && legalEntityId !== null;
  await transaction.execute(sql`
    insert into app.customer_accounts (id, tenant_id, customer_id, account_type, currency, credit_limit, credit_days, legal_entity_id, station_scope, station_scope_configured, created_by, updated_by)
    values (${accountId}, ${context.tenantId}, ${input.customerId}, ${input.accountType}, ${input.currency}, ${limit}, ${input.creditDays ?? null}, ${legalEntityId}, ${stationScope}, ${stationScopeConfigured}, ${context.authority.membership.membershipId}, ${context.authority.membership.membershipId})
  `);
  if (stationScope === 'SELECTED' && legalEntityId) {
    await replaceAccountStations(
      transaction,
      context,
      accountId,
      legalEntityId,
      input.stationIds ?? [],
    );
  }
  if (input.staffBenefit) {
    await transaction.execute(sql`
      insert into app.customer_staff_benefit_terms
        (tenant_id, account_id, staff_name, staff_membership_id, created_by)
      values (${context.tenantId}, ${accountId}, ${input.staffBenefit.staffName.trim()},
              ${input.staffBenefit.staffMembershipId ?? null}, ${context.authority.membership.membershipId})
    `);
  }
  return { accountId, accountType: input.accountType, stationScope, stationScopeConfigured };
}

/** Makes exactly `stationIds` the active stations of the account. Rows are deactivated, never deleted. */
async function replaceAccountStations(
  transaction: CustomerTransaction,
  context: CustomerCommandContext,
  accountId: string,
  legalEntityId: string,
  stationIds: readonly string[],
) {
  if (stationIds.length > 0) {
    const list = sql.join(
      stationIds.map((id) => sql`${id}`),
      sql`, `,
    );
    const found = await transaction.execute<{ id: string }>(sql`
      select id from app.stations
      where tenant_id = ${context.tenantId} and legal_entity_id = ${legalEntityId}
        and status = 'ACTIVE' and id in (${list})
    `);
    if (found.length !== stationIds.length) {
      throw new AppError(
        'VALIDATION_FAILED',
        "Every station must be an active station of the customer's legal entity",
      );
    }
    const membershipId = context.authority.membership.membershipId;
    for (const stationId of stationIds) {
      await transaction.execute(sql`
        insert into app.customer_account_stations
          (tenant_id, account_id, legal_entity_id, station_id, active, created_by, updated_by)
        values (${context.tenantId}, ${accountId}, ${legalEntityId}, ${stationId}, true, ${membershipId}, ${membershipId})
        on conflict (tenant_id, account_id, station_id)
        do update set active = true, updated_by = ${membershipId}, updated_at = now()
      `);
    }
    await transaction.execute(sql`
      update app.customer_account_stations
      set active = false, updated_by = ${context.authority.membership.membershipId}, updated_at = now()
      where tenant_id = ${context.tenantId} and account_id = ${accountId}
        and active and station_id not in (${list})
    `);
  } else {
    await transaction.execute(sql`
      update app.customer_account_stations
      set active = false, updated_by = ${context.authority.membership.membershipId}, updated_at = now()
      where tenant_id = ${context.tenantId} and account_id = ${accountId} and active
    `);
  }
}

export async function setCustomerAccountStationsInTransaction(
  transaction: CustomerTransaction,
  context: CustomerCommandContext,
  input: SetCustomerAccountStationsInput,
) {
  const rows = await transaction.execute<{
    id: string;
    version: number | string;
    legal_entity_id: string | null;
  }>(sql`
    select id, version, legal_entity_id from app.customer_accounts
    where tenant_id = ${context.tenantId} and id = ${input.accountId}
    for update
  `);
  const account = rows[0];
  if (!account) throw new AppError('NOT_FOUND', 'The customer account was not found');
  if (Number(account.version) !== input.expectedVersion)
    throw new AppError(
      'CONFLICT',
      'This account was changed by someone else. Refresh the page and try again.',
    );
  if (!account.legal_entity_id) {
    throw new AppError(
      'CONFLICT',
      'Set the customer legal entity before choosing the stations an account may use',
    );
  }
  await replaceAccountStations(
    transaction,
    context,
    input.accountId,
    account.legal_entity_id,
    input.stationScope === 'SELECTED' ? (input.stationIds ?? []) : [],
  );
  const updated = await transaction.execute<{ version: number | string }>(sql`
    update app.customer_accounts
    set station_scope = ${input.stationScope}, station_scope_configured = true, version = version + 1,
        updated_by = ${context.authority.membership.membershipId}, updated_at = now()
    where tenant_id = ${context.tenantId} and id = ${input.accountId} and version = ${input.expectedVersion}
    returning version
  `);
  if (!updated[0])
    throw new AppError(
      'CONFLICT',
      'This account was changed by someone else. Refresh the page and try again.',
    );
  return {
    accountId: input.accountId,
    stationScope: input.stationScope,
    stationScopeConfigured: true,
    stationIds: input.stationScope === 'SELECTED' ? [...(input.stationIds ?? [])].sort() : [],
    version: Number(updated[0].version),
  };
}

export async function loadAccountStationPolicy(
  transaction: CustomerTransaction,
  context: CustomerCommandContext,
  accountId: string,
) {
  const rows = await transaction.execute<{
    legal_entity_id: string | null;
    station_scope: 'ALL' | 'SELECTED';
    station_scope_configured: boolean;
  }>(sql`
    select legal_entity_id, station_scope, station_scope_configured from app.customer_accounts
    where tenant_id = ${context.tenantId} and id = ${accountId}
  `);
  const account = rows[0];
  if (!account) throw new AppError('NOT_FOUND', 'The customer account was not found');
  const stations = await transaction.execute<{ station_id: string }>(sql`
    select station_id from app.customer_account_stations
    where tenant_id = ${context.tenantId} and account_id = ${accountId} and active
  `);
  return {
    legalEntityId: account.legal_entity_id,
    scope: account.station_scope,
    configured: account.station_scope_configured,
    allowedStationIds: stations.map((row) => row.station_id),
  };
}

function assertAccountReadiness(loaded: { account: CustomerAccount; customer: Customer }): void {
  if (
    !loaded.customer.legalEntityId ||
    !loaded.account.legalEntityId ||
    loaded.customer.legalEntityId !== loaded.account.legalEntityId ||
    loaded.account.stationScopeConfigured !== true
  ) {
    throw new AppError(
      'CONFLICT',
      'The customer account is not ready for new financial activity. Confirm its legal entity and station scope first.',
    );
  }
}

function assertAuthorizationStation(
  context: CustomerCommandContext,
  authorization: CustomerFuelAuthorization,
): void {
  if (!context.stationId || context.stationId !== authorization.stationId) {
    throw new AppError(
      'FORBIDDEN',
      'This fuel approval can only be handled at the station it was requested for.',
    );
  }
}

export async function recordCustomerPaymentInTransaction(
  transaction: CustomerTransaction,
  context: CustomerCommandContext,
  input: RecordCustomerPaymentInput,
) {
  const loaded = await loadAccount(transaction, context, input.accountId);
  assertCustomerAccountTransactionAllowed(loaded.customer.status, loaded.account.status);
  assertAccountReadiness(loaded);
  assertSourceReferenceUnused(loaded.entries, input.source);
  await assertReceivingStation(transaction, context, input.accountId, input.receivingStationId);
  const entry = createCustomerPaymentEntry({
    id: randomUUID(),
    account: loaded.account,
    amount: money(input.amount.amount, input.amount.currency as CurrencyCode),
    source: input.source,
    occurredAt: input.occurredAt,
    businessDate: input.businessDate,
    note: input.note,
  });
  await insertLedgerEntry(
    transaction,
    entry,
    context.authority.membership.membershipId,
    input.receivingStationId,
  );
  if (input.entryDetails) {
    await insertCustomerEntryDetails(transaction, context, {
      ledgerEntryId: entry.id,
      accountId: input.accountId,
      details: input.entryDetails,
    });
  }
  return {
    entryId: entry.id,
    receivingStationId: input.receivingStationId,
    balance: deriveAccountBalance(loaded.account, [...loaded.entries, entry]),
  };
}

/**
 * A payment may be received at any active station of the customer's legal
 * entity, regardless of the account's fuel-use station scope: the cash lands in
 * that station's custody and is applied to the organisation-level account.
 */
async function assertReceivingStation(
  transaction: CustomerTransaction,
  context: CustomerCommandContext,
  accountId: string,
  stationId: string,
) {
  const rows = await transaction.execute<{ id: string }>(sql`
    select s.id
    from app.stations s
    join app.customer_accounts a
      on a.tenant_id = s.tenant_id and a.legal_entity_id = s.legal_entity_id
    where s.tenant_id = ${context.tenantId} and s.id = ${stationId}
      and s.status = 'ACTIVE' and a.id = ${accountId}
  `);
  if (!rows[0]) {
    throw new AppError(
      'VALIDATION_FAILED',
      "The receiving station must be an active station of the customer's legal entity",
    );
  }
}

export async function recordPrepaidTopUpInTransaction(
  transaction: CustomerTransaction,
  context: CustomerCommandContext,
  input: RecordPrepaidTopUpInput,
) {
  const loaded = await loadAccount(transaction, context, input.accountId);
  assertCustomerAccountTransactionAllowed(loaded.customer.status, loaded.account.status);
  assertAccountReadiness(loaded);
  if (context.stationId) {
    const stationLegalEntityId = context.scope.legalEntityId;
    if (!stationLegalEntityId)
      throw new AppError('INVARIANT_VIOLATION', 'This station is not linked to a company yet.');
    assertStationAllowedForAccount(
      await loadAccountStationPolicy(transaction, context, input.accountId),
      { stationId: context.stationId, legalEntityId: stationLegalEntityId },
    );
  }
  assertSourceReferenceUnused(loaded.entries, input.source);
  if (loaded.account.accountType !== input.accountType)
    throw new AppError(
      'INVARIANT_VIOLATION',
      'This top-up does not match the type of the chosen account.',
    );
  const entry = createPrepaidTopUpEntry({
    id: randomUUID(),
    account: loaded.account,
    amount: input.amount
      ? money(input.amount.amount, input.amount.currency as CurrencyCode)
      : undefined,
    productId: input.productId,
    quantityLitres: input.litres ? litres(input.litres) : undefined,
    source: input.source,
    occurredAt: input.occurredAt,
    businessDate: input.businessDate,
  });
  await insertLedgerEntry(transaction, entry, context.authority.membership.membershipId);
  if (input.entryDetails) {
    await insertCustomerEntryDetails(transaction, context, {
      ledgerEntryId: entry.id,
      accountId: input.accountId,
      details: input.entryDetails,
    });
  }
  return {
    entryId: entry.id,
    balance: deriveAccountBalance(loaded.account, [...loaded.entries, entry]),
  };
}

export async function requestCustomerFuelAuthorizationInTransaction(
  transaction: CustomerTransaction,
  context: CustomerCommandContext,
  input: RequestCustomerFuelAuthorizationInput,
) {
  if (!context.stationId)
    throw new AppError('FORBIDDEN', 'Choose a station before approving fuel for a customer.');
  const loaded = await loadAccount(transaction, context, input.accountId);
  assertCustomerAccountTransactionAllowed(loaded.customer.status, loaded.account.status);
  assertAccountReadiness(loaded);
  const stationLegalEntityId = context.scope.legalEntityId;
  if (!stationLegalEntityId)
    throw new AppError('INVARIANT_VIOLATION', 'This station is not linked to a company yet.');
  assertStationAllowedForAccount(
    await loadAccountStationPolicy(transaction, context, input.accountId),
    { stationId: context.stationId, legalEntityId: stationLegalEntityId },
  );
  const authorization = requestCustomerFuelAuthorization({
    id: input.authorizationId,
    account: loaded.account,
    stationId: context.stationId,
    requested: {
      productId: input.requested.productId,
      litres: litres(input.requested.litres),
      amount: money(input.requested.amount.amount, input.requested.amount.currency as CurrencyCode),
    },
    requestedBy: context.authority.membership.membershipId,
    requestedAt: input.requestedAt,
    source: input.source,
  });
  const existing = await transaction.execute<{ id: string }>(sql`
    select id
    from app.customer_fuel_authorizations
    where tenant_id = ${context.tenantId} and source_key = ${customerLedgerSourceKey(authorization.source)}
    limit 1
  `);
  if (existing[0])
    throw new AppError(
      'IDEMPOTENCY_CONFLICT',
      'This fuel approval has already been requested, so it was not requested a second time.',
    );
  await transaction.execute(sql`
    insert into app.customer_fuel_authorizations
      (id, tenant_id, station_id, customer_id, account_id, account_type, product_id, currency,
       requested_amount, requested_litres, remaining_amount, remaining_litres, source_type, source_id,
       source_revision_id, source_key, requested_by, requested_at)
    values (${authorization.id}, ${authorization.tenantId}, ${authorization.stationId}, ${authorization.customerId}, ${authorization.accountId}, ${authorization.accountType}, ${authorization.requested.productId}, ${authorization.requested.amount.currency}, ${authorization.requested.amount.amount.toString()}, ${authorization.requested.litres.toString()}, ${authorization.remaining.amount.amount.toString()}, ${authorization.remaining.litres.toString()}, ${authorization.source.sourceType}, ${authorization.source.sourceId}, ${authorization.source.sourceRevisionId ?? null}, ${customerLedgerSourceKey(authorization.source)}, ${authorization.requestedBy}, ${authorization.requestedAt}::timestamptz)
  `);
  return {
    authorizationId: authorization.id,
    state: authorization.state,
    version: authorization.version,
  };
}

async function loadAuthorization(
  transaction: CustomerTransaction,
  context: CustomerCommandContext,
  authorizationId: string,
  forUpdate = true,
): Promise<CustomerFuelAuthorization> {
  const lock = forUpdate ? sql`for update` : sql``;
  const rows = await transaction.execute<AuthorizationRow>(sql`
    select id, tenant_id, station_id, customer_id, account_id, account_type, product_id, currency,
           requested_amount, requested_litres, used_amount, used_litres, remaining_amount,
           remaining_litres, state, source_type, source_id, source_revision_id, requested_by,
           requested_at, version
    from app.customer_fuel_authorizations
    where tenant_id = ${context.tenantId} and id = ${authorizationId}
    ${lock}
  `);
  if (!rows[0]) throw new AppError('NOT_FOUND', 'That fuel approval was not found.');
  return authorizationFromRow(rows[0]);
}

async function activeReservations(
  transaction: CustomerTransaction,
  context: CustomerCommandContext,
  accountId: string,
): Promise<ActiveReservation[]> {
  const rows = await transaction.execute<AuthorizationRow>(sql`
    select id, tenant_id, station_id, customer_id, account_id, account_type, product_id, currency,
           requested_amount, requested_litres, used_amount, used_litres, remaining_amount,
           remaining_litres, state, source_type, source_id, source_revision_id, requested_by,
           requested_at, version
    from app.customer_fuel_authorizations
    where tenant_id = ${context.tenantId} and account_id = ${accountId} and state in ('AUTHORIZED','PARTIALLY_USED')
  `);
  return rows.map((row) => {
    const auth = authorizationFromRow(row);
    return {
      accountId: auth.accountId,
      accountType: auth.accountType,
      remaining: auth.remaining,
      state: auth.state as 'AUTHORIZED' | 'PARTIALLY_USED',
    };
  });
}

async function isStaffBenefitAccount(
  transaction: CustomerTransaction,
  context: CustomerCommandContext,
  accountId: string,
): Promise<boolean> {
  const rows = await transaction.execute<{ id: string }>(sql`
    select id from app.customer_staff_benefit_terms
    where tenant_id = ${context.tenantId} and account_id = ${accountId}
  `);
  return rows.length > 0;
}

/** Today's date at the station, from the station's own timezone (never the browser's). */
async function stationBusinessDate(
  transaction: CustomerTransaction,
  context: CustomerCommandContext,
): Promise<string> {
  const rows = await transaction.execute<{ today: string }>(sql`
    select to_char(now() at time zone s.timezone, 'YYYY-MM-DD') as today
    from app.stations s
    where s.tenant_id = ${context.tenantId} and s.id = ${context.stationId}
  `);
  if (!rows[0]) throw new AppError('NOT_FOUND', 'The station was not found.');
  return rows[0].today;
}

export async function authorizeCustomerFuelInTransaction(
  transaction: CustomerTransaction,
  context: CustomerCommandContext,
  input: { authorizationId: string; expectedVersion: number },
) {
  const initial = await loadAuthorization(transaction, context, input.authorizationId, false);
  assertAuthorizationStation(context, initial);
  const loaded = await loadAccount(transaction, context, initial.accountId);
  assertCustomerAccountTransactionAllowed(loaded.customer.status, loaded.account.status);
  assertAccountReadiness(loaded);
  assertStationAllowedForAccount(
    await loadAccountStationPolicy(transaction, context, initial.accountId),
    { stationId: context.stationId!, legalEntityId: context.scope.legalEntityId! },
  );
  const authorization = await loadAuthorization(transaction, context, input.authorizationId);
  const next = reserveCustomerFuelAuthorization({
    authorization,
    account: loaded.account,
    entries: loaded.entries,
    activeReservations: await activeReservations(transaction, context, authorization.accountId),
    ...((await isStaffBenefitAccount(transaction, context, authorization.accountId))
      ? { staffBenefit: { asAt: await stationBusinessDate(transaction, context) } }
      : {}),
  });
  if (next.version !== input.expectedVersion + 1 || authorization.version !== input.expectedVersion)
    throw new AppError(
      'CONFLICT',
      'This fuel approval was changed by someone else. Refresh the page and try again.',
    );
  await transaction.execute(sql`
    update app.customer_fuel_authorizations set state='AUTHORIZED', authorized_at=now(), version=version+1, updated_at=now()
    where tenant_id=${context.tenantId} and id=${authorization.id} and version=${input.expectedVersion} and state='REQUESTED'
  `);
  return { authorizationId: authorization.id, state: next.state, version: next.version };
}

async function assertPostedA5Evidence(
  transaction: CustomerTransaction,
  context: CustomerCommandContext,
  evidence: A5CustomerFuelEvidence,
  account: CustomerAccount,
): Promise<void> {
  if (evidence.tenantId !== context.tenantId || evidence.stationId !== context.stationId)
    throw new AppError(
      'FORBIDDEN',
      'The payment record for this fuel sale does not belong to this organisation or station.',
    );
  assertA5EvidenceCompatibleWithAccount(evidence, account.accountType);
  const category = evidence.category === 'CUSTOMER_CREDIT' ? 'CUSTOMER_CREDIT' : 'PREPAID';
  const rows = await transaction.execute<{ amount: string; method: string }>(sql`
    select p.amount::text, p.method
    from app.reconciliation_payments p
    join app.reconciliation_revisions r on r.tenant_id=p.tenant_id and r.station_id=p.station_id and r.reconciliation_id=p.reconciliation_id
    where p.tenant_id=${context.tenantId} and p.station_id=${context.stationId} and p.id=${evidence.paymentEvidenceId}
      and r.id=${evidence.reconciliationRevisionId} and r.state in ('POSTED','LOCKED')
      and r.reconciliation_id=${evidence.reconciliationId}
      and p.method=${category}
    limit 1
  `);
  if (!rows[0])
    throw new AppError(
      'CONFLICT',
      'The fuel sale must be posted as a customer fuel payment before it can be charged to the account.',
    );
  if (
    new ExactDecimal(rows[0].amount).value.equals(evidence.allocation.amount.amount.value) === false
  )
    throw new AppError(
      'INVARIANT_VIOLATION',
      'The amount on the fuel sale record does not match the amount charged to the customer.',
    );
}

export async function completeCustomerFuelTransactionInTransaction(
  transaction: CustomerTransaction,
  context: CustomerCommandContext,
  input: CompleteCustomerFuelTransactionInput,
) {
  if (!context.stationId)
    throw new AppError('FORBIDDEN', 'Choose a station before recording fuel used by a customer.');
  const initial = await loadAuthorization(transaction, context, input.authorizationId, false);
  assertAuthorizationStation(context, initial);
  if (initial.accountId !== input.accountId)
    throw new AppError('FORBIDDEN', 'This fuel approval does not belong to the chosen account.');
  const loaded = await loadAccount(transaction, context, input.accountId);
  assertCustomerAccountTransactionAllowed(loaded.customer.status, loaded.account.status);
  assertAccountReadiness(loaded);
  assertStationAllowedForAccount(
    await loadAccountStationPolicy(transaction, context, input.accountId),
    { stationId: context.stationId, legalEntityId: context.scope.legalEntityId! },
  );
  const authorization = await loadAuthorization(transaction, context, input.authorizationId);
  await assertPostedA5Evidence(
    transaction,
    context,
    {
      ...input.evidence,
      eventType: 'a5.customer_fuel_allocation_posted.v1',
      eventVersion: 1,
      tenantId: context.tenantId,
      stationId: context.stationId,
      reconciliationId: input.evidence.reconciliationId,
      reconciliationRevisionId: input.evidence.reconciliationRevisionId,
      paymentEvidenceId: input.evidence.paymentEvidenceId,
      category: loaded.account.accountType === 'CREDIT' ? 'CUSTOMER_CREDIT' : 'PREPAID',
      customerAccountReference: loaded.customer.accountReference,
      allocation: {
        productId: input.used.productId,
        litres: litres(input.used.litres),
        amount: money(input.used.amount.amount, input.used.amount.currency as CurrencyCode),
      },
      currency: input.used.amount.currency as CurrencyCode,
      businessDate: businessDate(input.businessDate),
      occurredAt: input.occurredAt,
      source: {
        sourceType: 'A5_RECONCILIATION_CUSTOMER_FUEL',
        sourceId: input.evidence.paymentEvidenceId,
        sourceRevisionId: input.evidence.reconciliationRevisionId,
      },
    },
    loaded.account,
  );
  const result = recordCustomerFuelUse({
    authorization,
    account: loaded.account,
    used: {
      productId: input.used.productId,
      litres: litres(input.used.litres),
      amount: money(input.used.amount.amount, input.used.amount.currency as CurrencyCode),
    },
    entryId: input.entryId,
    source: {
      sourceType: 'A5_RECONCILIATION_CUSTOMER_FUEL',
      sourceId: input.evidence.paymentEvidenceId,
      sourceRevisionId: input.evidence.reconciliationRevisionId,
    },
    occurredAt: input.occurredAt,
    businessDate: input.businessDate,
    fuelAllocationId: input.fuelAllocationId,
  });
  assertSourceReferenceUnused(loaded.entries, result.ledgerEntry.source);
  await insertLedgerEntry(
    transaction,
    result.ledgerEntry,
    context.authority.membership.membershipId,
  );
  if (loaded.account.accountType === 'CREDIT') assertCreditFuelDetails(input.entryDetails);
  if (input.entryDetails) {
    await insertCustomerEntryDetails(transaction, context, {
      ledgerEntryId: result.ledgerEntry.id,
      accountId: input.accountId,
      details: input.entryDetails,
    });
  }
  await transaction.execute(sql`
    update app.customer_fuel_authorizations
    set used_amount=${result.authorization.used.amount.amount.toString()}, used_litres=${result.authorization.used.litres.toString()}, remaining_amount=${result.authorization.remaining.amount.amount.toString()}, remaining_litres=${result.authorization.remaining.litres.toString()}, state=${result.authorization.state}, completed_at=${result.authorization.state === 'COMPLETED' ? sql`now()` : sql`null`}, version=version+1, updated_at=now()
    where tenant_id=${context.tenantId} and id=${authorization.id} and version=${authorization.version}
  `);
  return {
    authorizationId: authorization.id,
    entryId: result.ledgerEntry.id,
    state: result.authorization.state,
    version: result.authorization.version,
  };
}

export async function cancelCustomerFuelAuthorizationInTransaction(
  transaction: CustomerTransaction,
  context: CustomerCommandContext,
  input: { authorizationId: string; expectedVersion: number; reason: string },
) {
  const initial = await loadAuthorization(transaction, context, input.authorizationId, false);
  assertAuthorizationStation(context, initial);
  const loaded = await loadAccount(transaction, context, initial.accountId);
  const authorization = await loadAuthorization(transaction, context, input.authorizationId);
  if (authorization.version !== input.expectedVersion)
    throw new AppError(
      'CONFLICT',
      'This fuel approval was changed by someone else. Refresh the page and try again.',
    );
  const next = cancelCustomerFuelAuthorization(authorization, input.reason);
  await transaction.execute(
    sql`update app.customer_fuel_authorizations set state='CANCELLED', remaining_amount=0, remaining_litres=0, closed_reason=${input.reason}, version=version+1, updated_at=now() where tenant_id=${context.tenantId} and id=${authorization.id} and version=${input.expectedVersion}`,
  );
  return { authorizationId: authorization.id, state: next.state, version: next.version };
}

export async function expireCustomerFuelAuthorizationInTransaction(
  transaction: CustomerTransaction,
  context: CustomerCommandContext,
  input: { authorizationId: string; expectedVersion: number },
) {
  const initial = await loadAuthorization(transaction, context, input.authorizationId, false);
  assertAuthorizationStation(context, initial);
  const loaded = await loadAccount(transaction, context, initial.accountId);
  const authorization = await loadAuthorization(transaction, context, input.authorizationId);
  if (authorization.version !== input.expectedVersion)
    throw new AppError(
      'CONFLICT',
      'This fuel approval was changed by someone else. Refresh the page and try again.',
    );
  const next = expireCustomerFuelAuthorization(authorization, new Date().toISOString());
  await transaction.execute(
    sql`update app.customer_fuel_authorizations set state='EXPIRED', remaining_amount=0, remaining_litres=0, closed_reason='expired', version=version+1, updated_at=now() where tenant_id=${context.tenantId} and id=${authorization.id} and version=${input.expectedVersion}`,
  );
  return { authorizationId: authorization.id, state: next.state, version: next.version };
}
