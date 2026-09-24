import 'server-only';

import { z } from 'zod';
import { AppError } from '../../platform/errors';
import { executeCashCommand, requestHash, resolveCashCommandContext } from './application';
import {
  confirmBankDepositInTransaction,
  createBankDepositInTransaction,
  receiveCashCollectionInTransaction,
  recordCashCollectionInTransaction,
} from './persistence';

const uuid = z.string().uuid();
const decimalString = z
  .string()
  .min(1)
  .regex(/^\d+(?:\.\d+)?$/, 'A decimal string is required');

const authority = z.object({ tenantId: uuid, stationId: uuid });

const recordCollectionSchema = authority.extend({
  commandType: z.literal('RecordCashCollection'),
  collectionReference: z.string().trim().min(1).max(80),
  sourceLocationId: uuid,
  sources: z
    .array(z.object({ reconciliationId: uuid, amount: decimalString }))
    .min(1)
    .max(50),
});

const receiveCollectionSchema = authority.extend({
  commandType: z.literal('ReceiveCashCollection'),
  collectionId: uuid,
  targetLocationId: uuid,
  expectedVersion: z.number().int().nonnegative(),
});

const createDepositSchema = authority.extend({
  commandType: z.literal('CreateBankDeposit'),
  bankAccountId: uuid,
  sourceLocationId: uuid,
  depositReference: z.string().trim().min(1).max(120),
  allocations: z
    .array(z.object({ collectionId: uuid, amount: decimalString }))
    .min(1)
    .max(100),
});

const confirmDepositSchema = authority.extend({
  commandType: z.literal('ConfirmBankDeposit'),
  depositId: uuid,
  expectedVersion: z.number().int().nonnegative(),
  confirmedAmount: decimalString,
  bankReference: z.string().trim().min(1).max(120),
});

function idempotencyKey(request: Request): string {
  return request.headers.get('idempotency-key') ?? '';
}

export async function recordCashCollectionFromRequest(request: Request, body: unknown) {
  const input = recordCollectionSchema.parse(body);
  const context = await resolveCashCommandContext({
    request,
    requestedTenantId: input.tenantId,
    stationId: input.stationId,
  });
  return executeCashCommand({
    context,
    commandType: input.commandType,
    permissionCode: 'cash.collection.record',
    idempotencyKey: idempotencyKey(request),
    requestHash: requestHash(input),
    subjectType: 'CashCollection',
    subjectId: input.collectionReference,
    execute: async (transaction) => ({
      result: await recordCashCollectionInTransaction(transaction, context, input),
    }),
  });
}

export async function receiveCashCollectionFromRequest(request: Request, body: unknown) {
  const input = receiveCollectionSchema.parse(body);
  const context = await resolveCashCommandContext({
    request,
    requestedTenantId: input.tenantId,
    stationId: input.stationId,
  });
  return executeCashCommand({
    context,
    commandType: input.commandType,
    permissionCode: 'cash.collection.receive',
    idempotencyKey: idempotencyKey(request),
    requestHash: requestHash(input),
    subjectType: 'CashCollection',
    subjectId: input.collectionId,
    execute: async (transaction) => ({
      result: await receiveCashCollectionInTransaction(transaction, context, input),
    }),
  });
}

export async function createBankDepositFromRequest(request: Request, body: unknown) {
  const input = createDepositSchema.parse(body);
  const context = await resolveCashCommandContext({
    request,
    requestedTenantId: input.tenantId,
    stationId: input.stationId,
  });
  return executeCashCommand({
    context,
    commandType: input.commandType,
    permissionCode: 'cash.deposit.record',
    idempotencyKey: idempotencyKey(request),
    requestHash: requestHash(input),
    subjectType: 'BankDeposit',
    subjectId: input.depositReference,
    execute: async (transaction) => ({
      result: await createBankDepositInTransaction(transaction, context, input),
    }),
  });
}

export async function confirmBankDepositFromRequest(request: Request, body: unknown) {
  const input = confirmDepositSchema.parse(body);
  const context = await resolveCashCommandContext({
    request,
    requestedTenantId: input.tenantId,
    stationId: input.stationId,
  });
  return executeCashCommand({
    context,
    commandType: input.commandType,
    permissionCode: 'cash.deposit.confirm',
    idempotencyKey: idempotencyKey(request),
    requestHash: requestHash(input),
    subjectType: 'BankDeposit',
    subjectId: input.depositId,
    execute: async (transaction) => ({
      result: await confirmBankDepositInTransaction(transaction, context, input),
    }),
  });
}

export function assertCashCommandType(
  value: unknown,
): 'RecordCashCollection' | 'ReceiveCashCollection' | 'CreateBankDeposit' | 'ConfirmBankDeposit' {
  if (
    value === 'RecordCashCollection' ||
    value === 'ReceiveCashCollection' ||
    value === 'CreateBankDeposit' ||
    value === 'ConfirmBankDeposit'
  ) {
    return value;
  }
  throw new AppError('VALIDATION_FAILED', 'Unsupported cash command type');
}
