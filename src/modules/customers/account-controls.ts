import 'server-only';

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { AppError } from '../../platform/errors';
import { withTenantTransaction } from '../../platform/db/transaction';
import { DECIMAL_POLICIES, ExactDecimal } from '../../platform/domain/primitives';
import {
  authorizeCustomerCommand,
  customerRequestHash,
  executeCustomerCommand,
  resolveCustomerCommandContext,
  type CustomerCommandContext,
  type CustomerTransaction,
} from './application';
import { isPermissionGranted } from '../../platform/security/permissions';
import { assertStationAllowedForAccount } from './domain';
import { insertCustomerEntryDetails } from './entry-details-store';
import { loadAccount, loadAccountStationPolicy } from './persistence';
import { resolveCustomerReadContext } from './read-context';
import {
  overrideCustomerCreditLimitSchema,
  recordCustomerEntryDetailsSchema,
  type OverrideCustomerCreditLimitInput,
  type RecordCustomerEntryDetailsInput,
} from './validation';

/**
 * S13 account controls: details on a transaction (vehicle, driver, voucher, approver, document)
 * and the management override of a credit limit. Kept apart from the older customer commands.
 */

function idempotencyKey(request: Request): string {
  return request.headers.get('idempotency-key') ?? '';
}

function parse<TSchema extends z.ZodType>(schema: TSchema, body: unknown): z.output<TSchema> {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  const first = result.error.issues[0];
  throw new AppError('VALIDATION_FAILED', first?.message ?? 'Some of the details are not valid.', {
    fields: result.error.issues.map((issue) => ({
      field: issue.path.map(String).join('.'),
      message: issue.message,
    })),
  });
}

export async function recordCustomerEntryDetailsInTransaction(
  transaction: CustomerTransaction,
  context: CustomerCommandContext,
  input: RecordCustomerEntryDetailsInput,
) {
  const rows = await transaction.execute<{ id: string; account_id: string }>(sql`
    select id, account_id from app.customer_ledger_entries
    where tenant_id = ${context.tenantId} and id = ${input.ledgerEntryId}
  `);
  const entry = rows[0];
  if (!entry) throw new AppError('NOT_FOUND', 'That account transaction was not found.');
  if (!context.stationId || !context.scope.legalEntityId) {
    throw new AppError('FORBIDDEN', 'Choose a station before adding details to a transaction.');
  }
  assertStationAllowedForAccount(
    await loadAccountStationPolicy(transaction, context, entry.account_id),
    { stationId: context.stationId, legalEntityId: context.scope.legalEntityId },
  );
  const { detailsId } = await insertCustomerEntryDetails(transaction, context, {
    ledgerEntryId: entry.id,
    accountId: entry.account_id,
    details: input.details,
  });
  return { detailsId, ledgerEntryId: entry.id, accountId: entry.account_id };
}

export async function recordCustomerEntryDetailsFromRequest(request: Request, body: unknown) {
  const input = parse(recordCustomerEntryDetailsSchema, body);
  const context = await resolveCustomerCommandContext({
    request,
    requestedTenantId: input.tenantId,
    stationId: input.stationId,
  });
  return executeCustomerCommand({
    context,
    commandType: input.commandType,
    permissionCode: 'customer.credit.authorize',
    idempotencyKey: idempotencyKey(request),
    requestHash: customerRequestHash(input),
    audit: {
      actionCode: 'CUSTOMER.ENTRY_DETAILS_RECORDED',
      subjectType: 'CustomerLedgerEntry',
      subjectId: input.ledgerEntryId,
    },
    execute: (transaction) => recordCustomerEntryDetailsInTransaction(transaction, context, input),
  });
}

const fixed = (value: string) =>
  new ExactDecimal(value)
    .quantize(DECIMAL_POLICIES.money)
    .value.toFixed(DECIMAL_POLICIES.money.scale);

export async function overrideCustomerCreditLimitInTransaction(
  transaction: CustomerTransaction,
  context: CustomerCommandContext,
  input: OverrideCustomerCreditLimitInput,
) {
  const loaded = await loadAccount(transaction, context, input.accountId);
  const { account } = loaded;
  if (account.accountType !== 'CREDIT' || !account.creditLimit) {
    throw new AppError('VALIDATION_FAILED', 'Only credit accounts have a credit limit.');
  }
  const versionRows = await transaction.execute<{ version: number }>(sql`
    select version from app.customer_accounts
    where tenant_id = ${context.tenantId} and id = ${input.accountId}
  `);
  if (Number(versionRows[0]?.version) !== input.expectedVersion) {
    throw new AppError(
      'CONFLICT',
      'This account was changed by someone else. Reload the page and try again.',
    );
  }
  const previous = account.creditLimit.amount.toString();
  const next = new ExactDecimal(input.newLimit);
  if (next.equals(new ExactDecimal(previous))) {
    throw new AppError('VALIDATION_FAILED', 'The new limit is the same as the current limit.');
  }
  const approver = await transaction.execute<{ id: string }>(sql`
    select id from app.memberships
    where tenant_id = ${context.tenantId} and id = ${input.approvedByMembershipId}
      and status = 'ACTIVE'
  `);
  if (!approver[0]) {
    throw new AppError(
      'VALIDATION_FAILED',
      'The person who approved this is not an active member of your organisation.',
    );
  }
  const overrideId = randomUUID();
  await transaction.execute(sql`
    insert into app.customer_credit_limit_overrides
      (id, tenant_id, account_id, previous_limit, new_limit, approved_by_membership_id, reason, recorded_by)
    values
      (${overrideId}, ${context.tenantId}, ${input.accountId}, ${previous}, ${next.toString()},
       ${input.approvedByMembershipId}, ${input.reason}, ${context.authority.membership.membershipId})
  `);
  await transaction.execute(sql`
    update app.customer_accounts
    set credit_limit = ${next.toString()}, version = version + 1, updated_at = now(),
        updated_by = ${context.authority.membership.membershipId}
    where tenant_id = ${context.tenantId} and id = ${input.accountId}
      and version = ${input.expectedVersion}
  `);
  return {
    overrideId,
    accountId: input.accountId,
    previousLimit: fixed(previous),
    newLimit: fixed(next.toString()),
    approvedByMembershipId: input.approvedByMembershipId,
    version: input.expectedVersion + 1,
  };
}

export async function overrideCustomerCreditLimitFromRequest(request: Request, body: unknown) {
  const input = parse(overrideCustomerCreditLimitSchema, body);
  const context = await resolveCustomerCommandContext({
    request,
    requestedTenantId: input.tenantId,
  });
  return executeCustomerCommand({
    context,
    commandType: input.commandType,
    permissionCode: 'customer.limit.override',
    idempotencyKey: idempotencyKey(request),
    requestHash: customerRequestHash(input),
    audit: {
      actionCode: 'CUSTOMER.CREDIT_LIMIT_OVERRIDDEN',
      subjectType: 'CustomerAccount',
      subjectId: input.accountId,
      reason: input.reason,
    },
    execute: (transaction) => overrideCustomerCreditLimitInTransaction(transaction, context, input),
  });
}

const accountQuerySchema = z.object({
  tenantId: z.string().uuid(),
  accountId: z.string().uuid(),
});

export type CustomerEntryDetailsRow = Readonly<{
  ledgerEntryId: string;
  vehicleRegistration: string | null;
  driverName: string | null;
  voucherNumber: string | null;
  approvedByMembershipId: string | null;
  documentId: string | null;
  recordedAt: string;
}>;

export type CustomerCreditLimitOverrideRow = Readonly<{
  id: string;
  previousLimit: string;
  newLimit: string;
  approvedByMembershipId: string;
  reason: string;
  recordedAt: string;
}>;

/** Details recorded against the transactions of one account. Needs the statement permission. */
export async function getCustomerEntryDetailsFromRequest(
  request: Request,
  input: unknown,
): Promise<readonly CustomerEntryDetailsRow[]> {
  const query = accountQuerySchema.parse(input);
  const context = await resolveCustomerReadContext({
    request,
    requestedTenantId: query.tenantId,
  });
  authorizeCustomerCommand(context, 'customer.statement.view');
  return withTenantTransaction(context.authority.transaction, async (transaction) => {
    const rows = await transaction.execute<{
      ledger_entry_id: string;
      vehicle_registration: string | null;
      driver_name: string | null;
      voucher_number: string | null;
      approved_by_membership_id: string | null;
      document_id: string | null;
      recorded_at: Date | string;
    }>(sql`
      select ledger_entry_id, vehicle_registration, driver_name, voucher_number,
             approved_by_membership_id, document_id, recorded_at
      from app.customer_ledger_entry_details
      where tenant_id = ${context.tenantId} and account_id = ${query.accountId}
      order by recorded_at, id
    `);
    return rows.map((row) => ({
      ledgerEntryId: row.ledger_entry_id,
      vehicleRegistration: row.vehicle_registration,
      driverName: row.driver_name,
      voucherNumber: row.voucher_number,
      approvedByMembershipId: row.approved_by_membership_id,
      documentId: row.document_id,
      recordedAt: new Date(row.recorded_at).toISOString(),
    }));
  });
}

/** The history of management limit overrides for one account, newest first. */
export async function getCustomerCreditLimitOverridesFromRequest(
  request: Request,
  input: unknown,
): Promise<readonly CustomerCreditLimitOverrideRow[]> {
  const query = accountQuerySchema.parse(input);
  const context = await resolveCustomerReadContext({
    request,
    requestedTenantId: query.tenantId,
  });
  authorizeCustomerCommand(context, 'customer.statement.view');
  return withTenantTransaction(context.authority.transaction, async (transaction) => {
    const rows = await transaction.execute<{
      id: string;
      previous_limit: string;
      new_limit: string;
      approved_by_membership_id: string;
      reason: string;
      recorded_at: Date | string;
    }>(sql`
      select id, previous_limit::text, new_limit::text, approved_by_membership_id, reason, recorded_at
      from app.customer_credit_limit_overrides
      where tenant_id = ${context.tenantId} and account_id = ${query.accountId}
      order by recorded_at desc, id
    `);
    return rows.map((row) => ({
      id: row.id,
      previousLimit: row.previous_limit,
      newLimit: row.new_limit,
      approvedByMembershipId: row.approved_by_membership_id,
      reason: row.reason,
      recordedAt: new Date(row.recorded_at).toISOString(),
    }));
  });
}

export type AccountControlsApprover = Readonly<{ membershipId: string; name: string }>;

export type AccountControlsPageData = Readonly<{
  canOverrideLimit: boolean;
  canRecordDetails: boolean;
  approvers: readonly AccountControlsApprover[];
}>;

/** What the account controls page needs besides the customer list: permissions and approvers. */
export async function getAccountControlsPageDataFromRequest(
  request: Request,
  input: unknown,
): Promise<AccountControlsPageData> {
  const query = z.object({ tenantId: z.string().uuid() }).parse(input);
  const context = await resolveCustomerReadContext({
    request,
    requestedTenantId: query.tenantId,
  });
  authorizeCustomerCommand(context, 'customer.view');
  const actor = context.authority.authorization;
  const granted = (permissionCode: 'customer.limit.override' | 'customer.credit.authorize') =>
    isPermissionGranted({
      actor,
      permissionCode,
      requestedScope: { tenantId: context.tenantId, scopeType: 'TENANT' },
    }) ||
    actor.roleAssignments.some(
      (assignment) =>
        assignment.scopeType === 'STATION' &&
        isPermissionGranted({
          actor,
          permissionCode,
          requestedScope: {
            tenantId: context.tenantId,
            scopeType: 'STATION',
            legalEntityId: assignment.legalEntityId ?? undefined,
            stationId: assignment.stationId ?? undefined,
          },
        }),
    );
  const approvers = await withTenantTransaction(context.authority.transaction, (transaction) =>
    transaction.execute<{ membership_id: string; name: string }>(sql`
      select m.id as membership_id, coalesce(nullif(u.name, ''), u.email) as name
      from app.memberships m
      join app.users u on u.id = m.identity_id
      where m.tenant_id = ${context.tenantId} and m.status = 'ACTIVE'
      order by 2, 1
    `),
  );
  return {
    canOverrideLimit: granted('customer.limit.override'),
    canRecordDetails: granted('customer.credit.authorize'),
    approvers: approvers.map((row) => ({ membershipId: row.membership_id, name: row.name })),
  };
}
