import 'server-only';

import { z } from 'zod';
import { AppError } from '../../platform/errors';
import {
  authorizeCustomerFuelInTransaction,
  cancelCustomerFuelAuthorizationInTransaction,
  completeCustomerFuelTransactionInTransaction,
  createCustomerAccountInTransaction,
  createCustomerInTransaction,
  setCustomerAccountStationsInTransaction,
  setCustomerLegalEntityInTransaction,
  activateCustomerInTransaction,
  deactivateCustomerInTransaction,
  expireCustomerFuelAuthorizationInTransaction,
  recordCustomerPaymentInTransaction,
  recordPrepaidTopUpInTransaction,
  requestCustomerFuelAuthorizationInTransaction,
  updateCustomerInTransaction,
} from './persistence';
import {
  authorizeCustomerCommand,
  customerRequestHash,
  executeCustomerCommand,
  resolveCustomerCommandContext,
} from './application';
import {
  authorizeCustomerFuelSchema,
  cancelCustomerFuelAuthorizationSchema,
  completeCustomerFuelTransactionSchema,
  createCustomerAccountSchema,
  createCustomerSchema,
  setCustomerAccountStationsSchema,
  setCustomerLegalEntitySchema,
  activateCustomerSchema,
  deactivateCustomerSchema,
  expireCustomerFuelAuthorizationSchema,
  recordCustomerPaymentSchema,
  recordPrepaidTopUpSchema,
  requestCustomerFuelAuthorizationSchema,
  updateCustomerSchema,
} from './validation';

export const CUSTOMER_COMMAND_TYPES = [
  'CreateCustomer',
  'UpdateCustomer',
  'ActivateCustomer',
  'DeactivateCustomer',
  'CreateCustomerAccount',
  'SetCustomerLegalEntity',
  'SetCustomerAccountStations',
  'RequestCustomerFuelAuthorization',
  'AuthorizeCustomerFuel',
  'CompleteCustomerFuelTransaction',
  'CancelCustomerFuelAuthorization',
  'ExpireCustomerFuelAuthorization',
  'RecordCustomerPayment',
  'RecordPrepaidTopUp',
] as const;

export type CustomerCommandType = (typeof CUSTOMER_COMMAND_TYPES)[number];

export function assertCustomerCommandType(value: unknown): CustomerCommandType {
  if (typeof value !== 'string' || !CUSTOMER_COMMAND_TYPES.includes(value as CustomerCommandType)) {
    throw new AppError('VALIDATION_FAILED', 'That action is not available for customers.');
  }
  return value as CustomerCommandType;
}

const FIELD_LABELS: Record<string, string> = {
  tenantId: 'organisation',
  customerId: 'customer',
  accountId: 'account',
  stationId: 'station',
  receivingStationId: 'receiving station',
  stationIds: 'stations',
  stationScope: 'station choice',
  legalEntityId: 'company',
  productId: 'fuel',
  litres: 'litres',
  amount: 'amount',
  currency: 'currency',
  creditLimit: 'credit limit',
  accountType: 'account type',
  accountReference: 'account reference',
  displayName: 'name',
  businessDate: 'date',
  occurredAt: 'date and time',
  requestedAt: 'date and time',
  expectedVersion: 'page',
  sourceId: 'reference',
  source: 'reference',
  reason: 'reason',
  note: 'note',
};

function fieldLabel(path: readonly PropertyKey[]): string {
  for (let index = path.length - 1; index >= 0; index -= 1) {
    const label = FIELD_LABELS[String(path[index])];
    if (label) return label;
  }
  return 'details you entered';
}

/** Library defaults ("Invalid input: expected ...") are not for people; our own messages are. */
function issueMessage(issue: { message: string; path: readonly PropertyKey[] }): string {
  if (/^(Invalid|Too (small|big)|Expected|Required|Unrecognized)/i.test(issue.message)) {
    return `Check the ${fieldLabel(issue.path)}: it is missing or not in the expected form.`;
  }
  return issue.message;
}

/**
 * Parses a command body into a plain-language VALIDATION_FAILED error. The
 * default schema error has no message, so the customer screens could only show
 * a generic failure.
 */
function parseCommand<TSchema extends z.ZodType>(
  schema: TSchema,
  body: unknown,
): z.output<TSchema> {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  const issues = result.error.issues.map((issue) => ({
    field: issue.path.map(String).join('.'),
    message: issueMessage(issue),
  }));
  const first = issues[0]?.message ?? 'Some of the details are not valid.';
  const more = issues.length - 1;
  throw new AppError(
    'VALIDATION_FAILED',
    more > 0
      ? `${first} (${more} more ${more === 1 ? 'thing needs' : 'things need'} fixing.)`
      : first,
    { fields: issues },
  );
}

function idempotencyKey(request: Request): string {
  return request.headers.get('idempotency-key') ?? '';
}

function base(input: { tenantId: string; stationId?: string }) {
  return resolveCustomerCommandContext(input as never);
}

export async function createCustomerFromRequest(request: Request, body: unknown) {
  const input = parseCommand(createCustomerSchema, body);
  const context = await resolveCustomerCommandContext({
    request,
    requestedTenantId: input.tenantId,
  });
  return executeCustomerCommand({
    context,
    commandType: input.commandType,
    permissionCode: 'customer.manage',
    idempotencyKey: idempotencyKey(request),
    requestHash: customerRequestHash(input),
    audit: {
      actionCode: 'CUSTOMER.CREATED',
      subjectType: 'Customer',
      subjectId: (result) => (result as { customerId: string }).customerId,
    },
    execute: (transaction) => createCustomerInTransaction(transaction, context, input),
  });
}

export async function createCustomerAccountFromRequest(request: Request, body: unknown) {
  const input = parseCommand(createCustomerAccountSchema, body);
  const context = await resolveCustomerCommandContext({
    request,
    requestedTenantId: input.tenantId,
  });
  return executeCustomerCommand({
    context,
    commandType: input.commandType,
    permissionCode: 'customer.account.manage',
    idempotencyKey: idempotencyKey(request),
    requestHash: customerRequestHash(input),
    audit: {
      actionCode: 'CUSTOMER.ACCOUNT_CREATED',
      subjectType: 'CustomerAccount',
      subjectId: (result) => (result as { accountId: string }).accountId,
    },
    execute: (transaction) => createCustomerAccountInTransaction(transaction, context, input),
  });
}

export async function setCustomerLegalEntityFromRequest(request: Request, body: unknown) {
  const input = parseCommand(setCustomerLegalEntitySchema, body);
  const context = await resolveCustomerCommandContext({
    request,
    requestedTenantId: input.tenantId,
  });
  return executeCustomerCommand({
    context,
    commandType: input.commandType,
    permissionCode: 'customer.manage',
    idempotencyKey: idempotencyKey(request),
    requestHash: customerRequestHash(input),
    audit: {
      actionCode: 'CUSTOMER.LEGAL_ENTITY_SET',
      subjectType: 'Customer',
      subjectId: input.customerId,
    },
    execute: (transaction) => setCustomerLegalEntityInTransaction(transaction, context, input),
  });
}

export async function setCustomerAccountStationsFromRequest(request: Request, body: unknown) {
  const input = parseCommand(setCustomerAccountStationsSchema, body);
  const context = await resolveCustomerCommandContext({
    request,
    requestedTenantId: input.tenantId,
  });
  return executeCustomerCommand({
    context,
    commandType: input.commandType,
    permissionCode: 'customer.account.manage',
    idempotencyKey: idempotencyKey(request),
    requestHash: customerRequestHash(input),
    audit: {
      actionCode: 'CUSTOMER.ACCOUNT_STATIONS_SET',
      subjectType: 'CustomerAccount',
      subjectId: input.accountId,
    },
    execute: (transaction) => setCustomerAccountStationsInTransaction(transaction, context, input),
  });
}

export async function updateCustomerFromRequest(request: Request, body: unknown) {
  const input = parseCommand(updateCustomerSchema, body);
  const context = await resolveCustomerCommandContext({
    request,
    requestedTenantId: input.tenantId,
  });
  return executeCustomerCommand({
    context,
    commandType: input.commandType,
    permissionCode: 'customer.manage',
    idempotencyKey: idempotencyKey(request),
    requestHash: customerRequestHash(input),
    audit: {
      actionCode: 'CUSTOMER.UPDATED',
      subjectType: 'Customer',
      subjectId: input.customerId,
    },
    execute: (transaction) => updateCustomerInTransaction(transaction, context, input),
  });
}

export async function activateCustomerFromRequest(request: Request, body: unknown) {
  const input = parseCommand(activateCustomerSchema, body);
  const context = await resolveCustomerCommandContext({
    request,
    requestedTenantId: input.tenantId,
  });
  return executeCustomerCommand({
    context,
    commandType: input.commandType,
    permissionCode: 'customer.manage',
    idempotencyKey: idempotencyKey(request),
    requestHash: customerRequestHash(input),
    audit: {
      actionCode: 'CUSTOMER.ACTIVATED',
      subjectType: 'Customer',
      subjectId: input.customerId,
    },
    execute: (transaction) => activateCustomerInTransaction(transaction, context, input),
  });
}

export async function deactivateCustomerFromRequest(request: Request, body: unknown) {
  const input = parseCommand(deactivateCustomerSchema, body);
  const context = await resolveCustomerCommandContext({
    request,
    requestedTenantId: input.tenantId,
  });
  return executeCustomerCommand({
    context,
    commandType: input.commandType,
    permissionCode: 'customer.manage',
    idempotencyKey: idempotencyKey(request),
    requestHash: customerRequestHash(input),
    audit: {
      actionCode: 'CUSTOMER.DEACTIVATED',
      subjectType: 'Customer',
      subjectId: input.customerId,
    },
    execute: (transaction) => deactivateCustomerInTransaction(transaction, context, input),
  });
}

export async function recordCustomerPaymentFromRequest(request: Request, body: unknown) {
  const input = parseCommand(recordCustomerPaymentSchema, body);
  const context = await resolveCustomerCommandContext({
    request,
    requestedTenantId: input.tenantId,
  });
  return executeCustomerCommand({
    context,
    commandType: input.commandType,
    permissionCode: 'customer.payment.record',
    idempotencyKey: idempotencyKey(request),
    requestHash: customerRequestHash(input),
    audit: {
      actionCode: 'CUSTOMER.PAYMENT_POSTED',
      subjectType: 'CustomerLedgerEntry',
      subjectId: (result) => (result as { entryId: string }).entryId,
    },
    execute: (transaction) => recordCustomerPaymentInTransaction(transaction, context, input),
  });
}

export async function recordPrepaidTopUpFromRequest(request: Request, body: unknown) {
  const input = parseCommand(recordPrepaidTopUpSchema, body);
  const context = await resolveCustomerCommandContext({
    request,
    requestedTenantId: input.tenantId,
    ...(input.stationId ? { stationId: input.stationId } : {}),
  });
  return executeCustomerCommand({
    context,
    commandType: input.commandType,
    permissionCode: 'customer.prepaid.top_up',
    idempotencyKey: idempotencyKey(request),
    requestHash: customerRequestHash(input),
    audit: {
      actionCode: 'CUSTOMER.PREPAID_TOPUP_POSTED',
      subjectType: 'CustomerLedgerEntry',
      subjectId: (result) => (result as { entryId: string }).entryId,
    },
    execute: (transaction) => recordPrepaidTopUpInTransaction(transaction, context, input),
  });
}

export async function requestCustomerFuelAuthorizationFromRequest(request: Request, body: unknown) {
  const input = parseCommand(requestCustomerFuelAuthorizationSchema, body);
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
      actionCode: 'CUSTOMER.FUEL_AUTHORIZATION_REQUESTED',
      subjectType: 'CustomerFuelAuthorization',
      subjectId: input.authorizationId,
    },
    execute: (transaction) =>
      requestCustomerFuelAuthorizationInTransaction(transaction, context, input),
  });
}

export async function authorizeCustomerFuelFromRequest(request: Request, body: unknown) {
  const input = parseCommand(authorizeCustomerFuelSchema, body);
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
      actionCode: 'CUSTOMER.FUEL_AUTHORIZATION_RESERVED',
      subjectType: 'CustomerFuelAuthorization',
      subjectId: input.authorizationId,
    },
    execute: (transaction) => authorizeCustomerFuelInTransaction(transaction, context, input),
  });
}

export async function completeCustomerFuelTransactionFromRequest(request: Request, body: unknown) {
  const input = parseCommand(completeCustomerFuelTransactionSchema, body);
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
      actionCode: 'CUSTOMER.FUEL_TRANSACTION_POSTED',
      subjectType: 'CustomerLedgerEntry',
      subjectId: input.entryId,
    },
    execute: (transaction) =>
      completeCustomerFuelTransactionInTransaction(transaction, context, input),
  });
}

export async function cancelCustomerFuelAuthorizationFromRequest(request: Request, body: unknown) {
  const input = parseCommand(cancelCustomerFuelAuthorizationSchema, body);
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
      actionCode: 'CUSTOMER.AUTHORIZATION_CANCELLED',
      subjectType: 'CustomerFuelAuthorization',
      subjectId: input.authorizationId,
      reason: input.reason,
    },
    execute: (transaction) =>
      cancelCustomerFuelAuthorizationInTransaction(transaction, context, input),
  });
}

export async function expireCustomerFuelAuthorizationFromRequest(request: Request, body: unknown) {
  const input = parseCommand(expireCustomerFuelAuthorizationSchema, body);
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
      actionCode: 'CUSTOMER.AUTHORIZATION_EXPIRED',
      subjectType: 'CustomerFuelAuthorization',
      subjectId: input.authorizationId,
    },
    execute: (transaction) =>
      expireCustomerFuelAuthorizationInTransaction(transaction, context, input),
  });
}
