import 'server-only';

import { z } from 'zod';
import { AppError } from '../../platform/errors';
import { executeCashCommand, requestHash, resolveCashCommandContext } from './application';
import {
  confirmBankDepositInTransaction,
  createBankDepositInTransaction,
  cancelCashHandoverInTransaction,
  recordCashCountInTransaction,
  disputeCashHandoverInTransaction,
  prepareCashHandoverInTransaction,
  receiverConfirmCashHandoverInTransaction,
  receiveCashCollectionInTransaction,
  recordCashCollectionInTransaction,
  resolveCashHandoverDisputeInTransaction,
  senderConfirmCashHandoverInTransaction,
} from './persistence';

const uuid = z.string().uuid();
const decimalString = z
  .string()
  .min(1)
  .regex(/^\d+(?:\.\d+)?$/, 'A decimal string is required');

const authority = z.object({ tenantId: uuid, stationId: uuid });

const countCashSchema = authority.extend({
  commandType: z.literal('CountCash'),
  locationId: uuid,
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'A business date is required'),
  countedAmount: decimalString,
  explanation: z.string().trim().max(500).optional(),
});

const prepareHandoverSchema = authority.extend({
  commandType: z.literal('PrepareHandover'),
  fromLocationId: uuid,
  toLocationId: uuid,
  transitLocationId: uuid,
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'A business date is required'),
  expectedAmount: decimalString,
});

const handoverVersionSchema = authority.extend({
  handoverId: uuid,
  expectedVersion: z.number().int().nonnegative(),
});

const senderConfirmHandoverSchema = handoverVersionSchema.extend({
  commandType: z.literal('SenderConfirmHandover'),
  countedAmount: decimalString,
  varianceExplanation: z.string().trim().max(500).optional(),
});

const receiverConfirmHandoverSchema = handoverVersionSchema.extend({
  commandType: z.literal('ReceiverConfirmHandover'),
});

const disputeHandoverSchema = handoverVersionSchema.extend({
  commandType: z.literal('DisputeHandover'),
  reason: z.string().trim().min(1).max(500),
  varianceExplanation: z.string().trim().max(500).optional(),
});

const resolveHandoverSchema = handoverVersionSchema.extend({
  commandType: z.literal('ResolveHandoverDispute'),
  reason: z.string().trim().min(1).max(500),
});

const cancelHandoverSchema = handoverVersionSchema.extend({
  commandType: z.literal('CancelHandover'),
  reason: z.string().trim().min(1).max(500),
});

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

export async function countCashFromRequest(request: Request, body: unknown) {
  const input = countCashSchema.parse(body);
  const context = await resolveCashCommandContext({
    request,
    requestedTenantId: input.tenantId,
    stationId: input.stationId,
  });
  return executeCashCommand({
    context,
    commandType: input.commandType,
    permissionCode: 'cash.count.record',
    idempotencyKey: idempotencyKey(request),
    requestHash: requestHash(input),
    subjectType: 'CashCount',
    subjectId: `${input.locationId}:${input.businessDate}`,
    execute: async (transaction) => {
      const result = await recordCashCountInTransaction(transaction, context, input);
      return { result, after: result };
    },
  });
}

export async function prepareHandoverFromRequest(request: Request, body: unknown) {
  const input = prepareHandoverSchema.parse(body);
  const context = await resolveCashCommandContext({
    request,
    requestedTenantId: input.tenantId,
    stationId: input.stationId,
  });
  return executeCashCommand({
    context,
    commandType: input.commandType,
    permissionCode: 'cash.handover.submit',
    idempotencyKey: idempotencyKey(request),
    requestHash: requestHash(input),
    subjectType: 'CashHandover',
    subjectId: `${input.fromLocationId}:${input.businessDate}`,
    execute: async (transaction) => ({
      result: await prepareCashHandoverInTransaction(transaction, context, input),
    }),
  });
}

export async function senderConfirmHandoverFromRequest(request: Request, body: unknown) {
  const input = senderConfirmHandoverSchema.parse(body);
  const context = await resolveCashCommandContext({
    request,
    requestedTenantId: input.tenantId,
    stationId: input.stationId,
  });
  return executeCashCommand({
    context,
    commandType: input.commandType,
    permissionCode: 'cash.handover.submit',
    idempotencyKey: idempotencyKey(request),
    requestHash: requestHash(input),
    subjectType: 'CashHandover',
    subjectId: input.handoverId,
    execute: async (transaction) => ({
      result: await senderConfirmCashHandoverInTransaction(transaction, context, input),
    }),
  });
}

export async function receiverConfirmHandoverFromRequest(request: Request, body: unknown) {
  const input = receiverConfirmHandoverSchema.parse(body);
  const context = await resolveCashCommandContext({
    request,
    requestedTenantId: input.tenantId,
    stationId: input.stationId,
  });
  return executeCashCommand({
    context,
    commandType: input.commandType,
    permissionCode: 'cash.handover.accept',
    idempotencyKey: idempotencyKey(request),
    requestHash: requestHash(input),
    subjectType: 'CashHandover',
    subjectId: input.handoverId,
    execute: async (transaction) => ({
      result: await receiverConfirmCashHandoverInTransaction(transaction, context, input),
    }),
  });
}

export async function disputeHandoverFromRequest(request: Request, body: unknown) {
  const input = disputeHandoverSchema.parse(body);
  const context = await resolveCashCommandContext({
    request,
    requestedTenantId: input.tenantId,
    stationId: input.stationId,
  });
  return executeCashCommand({
    context,
    commandType: input.commandType,
    permissionCode: 'cash.handover.accept',
    idempotencyKey: idempotencyKey(request),
    requestHash: requestHash(input),
    subjectType: 'CashHandover',
    subjectId: input.handoverId,
    execute: async (transaction) => ({
      result: await disputeCashHandoverInTransaction(transaction, context, input),
    }),
  });
}

export async function resolveHandoverDisputeFromRequest(request: Request, body: unknown) {
  const input = resolveHandoverSchema.parse(body);
  const context = await resolveCashCommandContext({
    request,
    requestedTenantId: input.tenantId,
    stationId: input.stationId,
  });
  return executeCashCommand({
    context,
    commandType: input.commandType,
    permissionCode: 'cash.handover.resolve',
    idempotencyKey: idempotencyKey(request),
    requestHash: requestHash(input),
    subjectType: 'CashHandover',
    subjectId: input.handoverId,
    execute: async (transaction) => ({
      result: await resolveCashHandoverDisputeInTransaction(transaction, context, input),
    }),
  });
}

export async function cancelHandoverFromRequest(request: Request, body: unknown) {
  const input = cancelHandoverSchema.parse(body);
  const context = await resolveCashCommandContext({
    request,
    requestedTenantId: input.tenantId,
    stationId: input.stationId,
  });
  return executeCashCommand({
    context,
    commandType: input.commandType,
    permissionCode: 'cash.handover.submit',
    idempotencyKey: idempotencyKey(request),
    requestHash: requestHash(input),
    subjectType: 'CashHandover',
    subjectId: input.handoverId,
    execute: async (transaction) => ({
      result: await cancelCashHandoverInTransaction(transaction, context, input),
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
):
  | 'CountCash'
  | 'PrepareHandover'
  | 'SenderConfirmHandover'
  | 'ReceiverConfirmHandover'
  | 'DisputeHandover'
  | 'ResolveHandoverDispute'
  | 'CancelHandover'
  | 'RecordCashCollection'
  | 'ReceiveCashCollection'
  | 'CreateBankDeposit'
  | 'ConfirmBankDeposit' {
  if (
    value === 'CountCash' ||
    value === 'PrepareHandover' ||
    value === 'SenderConfirmHandover' ||
    value === 'ReceiverConfirmHandover' ||
    value === 'DisputeHandover' ||
    value === 'ResolveHandoverDispute' ||
    value === 'CancelHandover' ||
    value === 'RecordCashCollection' ||
    value === 'ReceiveCashCollection' ||
    value === 'CreateBankDeposit' ||
    value === 'ConfirmBankDeposit'
  ) {
    return value;
  }
  throw new AppError('VALIDATION_FAILED', 'Unsupported cash command type');
}
