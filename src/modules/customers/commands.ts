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
    throw new AppError('VALIDATION_FAILED', 'Unsupported customer command');
  }
  return value as CustomerCommandType;
}

function idempotencyKey(request: Request): string {
  return request.headers.get('idempotency-key') ?? '';
}

function base(input: { tenantId: string; stationId?: string }) {
  return resolveCustomerCommandContext(input as never);
}

export async function createCustomerFromRequest(request: Request, body: unknown) {
  const input = createCustomerSchema.parse(body);
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
  const input = createCustomerAccountSchema.parse(body);
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
  const input = setCustomerLegalEntitySchema.parse(body);
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
  const input = setCustomerAccountStationsSchema.parse(body);
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
  const input = updateCustomerSchema.parse(body);
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
  const input = activateCustomerSchema.parse(body);
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
  const input = deactivateCustomerSchema.parse(body);
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
  const input = recordCustomerPaymentSchema.parse(body);
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
  const input = recordPrepaidTopUpSchema.parse(body);
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
  const input = requestCustomerFuelAuthorizationSchema.parse(body);
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
  const input = authorizeCustomerFuelSchema.parse(body);
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
  const input = completeCustomerFuelTransactionSchema.parse(body);
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
  const input = cancelCustomerFuelAuthorizationSchema.parse(body);
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
  const input = expireCustomerFuelAuthorizationSchema.parse(body);
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
