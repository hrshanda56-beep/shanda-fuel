import 'server-only';

import { z } from 'zod';
import type { ContextSelection } from '@/modules/context';
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

const context = z.object({
  organisationId: uuid,
  legalEntityId: uuid.optional(),
  stationId: uuid.optional(),
  allStations: z.boolean(),
});

const commandContext = z
  .object({
    context: context.optional(),
    // Legacy callers are accepted only as an input shape. The server converts
    // them to a ContextSelection and validates them against live membership.
    tenantId: uuid.optional(),
    stationId: uuid.optional(),
  })
  .superRefine((value, refinement) => {
    if (!value.context && (!value.tenantId || !value.stationId)) {
      refinement.addIssue({
        code: 'custom',
        path: ['context'],
        message: 'An authorised station context is required',
      });
    }
  });

const recordCollectionSchema = commandContext.extend({
  commandType: z.literal('RecordCashCollection'),
  collectionReference: z.string().trim().min(1).max(80),
  sourceLocationId: uuid,
  sources: z
    .array(z.object({ reconciliationId: uuid, amount: decimalString }))
    .min(1)
    .max(50),
});

const receiveCollectionSchema = commandContext.extend({
  commandType: z.literal('ReceiveCashCollection'),
  collectionId: uuid,
  targetLocationId: uuid,
  expectedVersion: z.number().int().nonnegative(),
});

const createDepositSchema = commandContext.extend({
  commandType: z.literal('CreateBankDeposit'),
  bankAccountId: uuid,
  sourceLocationId: uuid,
  depositReference: z.string().trim().min(1).max(120),
  allocations: z
    .array(z.object({ collectionId: uuid, amount: decimalString }))
    .min(1)
    .max(100),
});

const confirmDepositSchema = commandContext.extend({
  commandType: z.literal('ConfirmBankDeposit'),
  depositId: uuid,
  expectedVersion: z.number().int().nonnegative(),
  confirmedAmount: decimalString,
  bankReference: z.string().trim().min(1).max(120),
});

function idempotencyKey(request: Request): string {
  return request.headers.get('idempotency-key') ?? '';
}

function selectionFromInput(input: {
  context?: ContextSelection;
  tenantId?: string;
  stationId?: string;
}): ContextSelection {
  if (input.context) return input.context;
  if (input.tenantId && input.stationId) {
    return {
      organisationId: input.tenantId,
      stationId: input.stationId,
      allStations: false,
    };
  }
  throw new AppError('VALIDATION_FAILED', 'An authorised station context is required');
}

function canonicalRequestHash(input: Record<string, unknown>, selection: ContextSelection): string {
  const { tenantId: _tenantId, stationId: _stationId, ...rest } = input;
  return requestHash({ ...rest, context: selection });
}

export async function recordCashCollectionFromRequest(request: Request, body: unknown) {
  const input = recordCollectionSchema.parse(body);
  const selection = selectionFromInput(input);
  const context = await resolveCashCommandContext({
    request,
    selection,
  });
  return executeCashCommand({
    context,
    commandType: input.commandType,
    permissionCode: 'cash.collection.record',
    idempotencyKey: idempotencyKey(request),
    requestHash: canonicalRequestHash(input, selection),
    subjectType: 'CashCollection',
    subjectId: input.collectionReference,
    execute: async (transaction) => ({
      result: await recordCashCollectionInTransaction(transaction, context, input),
      after: { collectionReference: input.collectionReference },
    }),
  });
}

export async function receiveCashCollectionFromRequest(request: Request, body: unknown) {
  const input = receiveCollectionSchema.parse(body);
  const selection = selectionFromInput(input);
  const context = await resolveCashCommandContext({
    request,
    selection,
  });
  return executeCashCommand({
    context,
    commandType: input.commandType,
    permissionCode: 'cash.collection.receive',
    idempotencyKey: idempotencyKey(request),
    requestHash: canonicalRequestHash(input, selection),
    subjectType: 'CashCollection',
    subjectId: input.collectionId,
    execute: async (transaction) => ({
      result: await receiveCashCollectionInTransaction(transaction, context, input),
      after: { collectionId: input.collectionId, expectedVersion: input.expectedVersion },
    }),
  });
}

export async function createBankDepositFromRequest(request: Request, body: unknown) {
  const input = createDepositSchema.parse(body);
  const selection = selectionFromInput(input);
  const context = await resolveCashCommandContext({
    request,
    selection,
  });
  return executeCashCommand({
    context,
    commandType: input.commandType,
    permissionCode: 'cash.deposit.record',
    idempotencyKey: idempotencyKey(request),
    requestHash: canonicalRequestHash(input, selection),
    subjectType: 'BankDeposit',
    subjectId: input.depositReference,
    execute: async (transaction) => ({
      result: await createBankDepositInTransaction(transaction, context, input),
      after: { depositReference: input.depositReference },
    }),
  });
}

export async function confirmBankDepositFromRequest(request: Request, body: unknown) {
  const input = confirmDepositSchema.parse(body);
  const selection = selectionFromInput(input);
  const context = await resolveCashCommandContext({
    request,
    selection,
  });
  return executeCashCommand({
    context,
    commandType: input.commandType,
    permissionCode: 'cash.deposit.confirm',
    idempotencyKey: idempotencyKey(request),
    requestHash: canonicalRequestHash(input, selection),
    subjectType: 'BankDeposit',
    subjectId: input.depositId,
    execute: async (transaction) => ({
      result: await confirmBankDepositInTransaction(transaction, context, input),
      after: { depositId: input.depositId, expectedVersion: input.expectedVersion },
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
