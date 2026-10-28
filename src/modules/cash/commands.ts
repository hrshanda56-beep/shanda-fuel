import 'server-only';

import { z } from 'zod';
import type { ContextSelection } from '../context';
import { AppError } from '../../platform/errors';
import { executeCashCommand, requestHash, resolveCashCommandContext } from './application';
import { isAuthorized } from '../../platform/security/permissions';
import {
  acceptCashHandoverInTransaction,
  cancelCashHandoverInTransaction,
  confirmBankDepositInTransaction,
  createBankDepositInTransaction,
  receiveCashCollectionInTransaction,
  recordCashCollectionInTransaction,
  resolveCashHandoverInTransaction,
  submitCashHandoverInTransaction,
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

const submitHandoverSchema = commandContext.extend({
  commandType: z.literal('SubmitCashHandover'),
  fromLocationId: uuid,
  toLocationId: uuid,
  expectedAmount: decimalString,
  countedAmount: decimalString,
  reason: z.string().trim().max(500).optional(),
});

const handoverActionSchema = commandContext.extend({
  handoverId: uuid,
  expectedVersion: z.number().int().nonnegative(),
});
const acceptHandoverSchema = handoverActionSchema.extend({
  commandType: z.literal('AcceptCashHandover'),
});
const resolveHandoverSchema = handoverActionSchema.extend({
  commandType: z.literal('ResolveCashHandover'),
  resolutionNote: z.string().trim().min(3).max(500),
});
const cancelHandoverSchema = handoverActionSchema.extend({
  commandType: z.literal('CancelCashHandover'),
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
    execute: async (transaction) => {
      const result = await recordCashCollectionInTransaction(transaction, context, input);
      return { result, after: result };
    },
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
    execute: async (transaction) => {
      const result = await receiveCashCollectionInTransaction(transaction, context, input);
      return { result, after: result };
    },
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
    execute: async (transaction) => {
      const result = await createBankDepositInTransaction(transaction, context, input);
      return { result, after: result };
    },
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
    execute: async (transaction) => {
      const result = await confirmBankDepositInTransaction(transaction, context, input);
      return { result, after: { ...result, bankReference: input.bankReference } };
    },
  });
}

export async function submitCashHandoverFromRequest(request: Request, body: unknown) {
  const input = submitHandoverSchema.parse(body);
  const selection = selectionFromInput(input);
  const context = await resolveCashCommandContext({ request, selection });
  return executeCashCommand({
    context,
    commandType: input.commandType,
    permissionCode: 'cash.handover.submit',
    idempotencyKey: idempotencyKey(request),
    requestHash: canonicalRequestHash(input, selection),
    subjectType: 'CashHandover',
    subjectId: `${input.fromLocationId}:${input.toLocationId}`,
    execute: async (transaction) => {
      const result = await submitCashHandoverInTransaction(transaction, context, input);
      return {
        result,
        after: {
          ...result,
          expectedAmount: input.expectedAmount,
          countedAmount: input.countedAmount,
        },
      };
    },
  });
}

export async function acceptCashHandoverFromRequest(request: Request, body: unknown) {
  const input = acceptHandoverSchema.parse(body);
  const selection = selectionFromInput(input);
  const context = await resolveCashCommandContext({ request, selection });
  return executeCashCommand({
    context,
    commandType: input.commandType,
    permissionCode: 'cash.handover.accept',
    idempotencyKey: idempotencyKey(request),
    requestHash: canonicalRequestHash(input, selection),
    subjectType: 'CashHandover',
    subjectId: input.handoverId,
    execute: async (transaction) => {
      const result = await acceptCashHandoverInTransaction(transaction, context, input);
      return { result, after: result };
    },
  });
}

export async function resolveCashHandoverFromRequest(request: Request, body: unknown) {
  const input = resolveHandoverSchema.parse(body);
  const selection = selectionFromInput(input);
  const context = await resolveCashCommandContext({ request, selection });
  return executeCashCommand({
    context,
    commandType: input.commandType,
    permissionCode: 'cash.handover.resolve',
    idempotencyKey: idempotencyKey(request),
    requestHash: canonicalRequestHash(input, selection),
    subjectType: 'CashHandover',
    subjectId: input.handoverId,
    execute: async (transaction) => {
      const result = await resolveCashHandoverInTransaction(transaction, context, input);
      return { result, after: { ...result, resolutionNote: input.resolutionNote } };
    },
  });
}

export async function cancelCashHandoverFromRequest(request: Request, body: unknown) {
  const input = cancelHandoverSchema.parse(body);
  const selection = selectionFromInput(input);
  const context = await resolveCashCommandContext({ request, selection });
  const canActForOthers = isAuthorized({
    actor: context.authority.authorization,
    permissionCode: 'cash.handover.accept',
    requestedScope: context.scope,
  });
  return executeCashCommand({
    context,
    commandType: input.commandType,
    permissionCode: 'cash.handover.submit',
    idempotencyKey: idempotencyKey(request),
    requestHash: canonicalRequestHash(input, selection),
    subjectType: 'CashHandover',
    subjectId: input.handoverId,
    execute: async (transaction) => {
      const result = await cancelCashHandoverInTransaction(transaction, context, {
        ...input,
        canActForOthers,
      });
      return { result, after: result };
    },
  });
}

const CASH_COMMAND_TYPES = [
  'RecordCashCollection',
  'ReceiveCashCollection',
  'CreateBankDeposit',
  'ConfirmBankDeposit',
  'SubmitCashHandover',
  'AcceptCashHandover',
  'ResolveCashHandover',
  'CancelCashHandover',
] as const;

export function assertCashCommandType(value: unknown): (typeof CASH_COMMAND_TYPES)[number] {
  const match = CASH_COMMAND_TYPES.find((type) => type === value);
  if (match) return match;
  throw new AppError('VALIDATION_FAILED', 'Unsupported cash command type');
}
