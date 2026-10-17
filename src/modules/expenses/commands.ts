import 'server-only';

import { z } from 'zod';
import { AppError } from '../../platform/errors';
import { executeExpenseCommand, requestHash, resolveExpenseCommandContext } from './application';
import {
  approveExpenseInTransaction,
  postExpenseInTransaction,
  rejectExpenseInTransaction,
  returnExpenseInTransaction,
  reverseExpenseInTransaction,
  submitExpenseInTransaction,
  createRecurringExpenseTemplateInTransaction,
  deactivateRecurringExpenseTemplateInTransaction,
  generateRecurringCostPeriodInTransaction,
  updateRecurringExpenseTemplateInTransaction,
} from './persistence';

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'A YYYY-MM-DD business date is required');
const decimal = z.string().regex(/^\d+(?:\.\d+)?$/, 'An exact non-negative decimal is required');
const currency = z
  .string()
  .trim()
  .regex(/^[A-Z]{3}$/, 'A three-letter currency is required');

const context = z
  .object({
    tenantId: uuid,
    legalEntityId: uuid.optional(),
    stationId: uuid.optional(),
  })
  .superRefine((value, refinement) => {
    if (!value.legalEntityId && !value.stationId) {
      refinement.addIssue({
        code: 'custom',
        path: ['legalEntityId'],
        message: 'A legal entity or station context is required',
      });
    }
  });

const submitSchema = context.extend({
  commandType: z.literal('SubmitExpense'),
  businessDate: date,
  description: z.string().trim().min(1).max(500),
  category: z.string().trim().min(1).max(120).optional(),
  amount: decimal,
  currency: currency.default('USD'),
  classification: z.enum(['OPERATING_EXPENSE', 'DIRECT_INVENTORY_COST', 'RECURRING_FIXED_COST']),
  settlementSource: z.enum(['CASH', 'BANK', 'PAYABLE', 'REIMBURSEMENT']),
});

const recurringTemplateFields = {
  description: z.string().trim().min(1).max(500),
  category: z.string().trim().min(1).max(120).optional(),
  amount: decimal,
  currency: currency.default('USD'),
  settlementSource: z.enum(['CASH', 'BANK', 'PAYABLE', 'REIMBURSEMENT']),
  intervalUnit: z.enum(['DAY', 'WEEK', 'MONTH', 'YEAR']),
  intervalCount: z.number().int().min(1).max(3650),
  anchorDate: date,
  active: z.boolean().optional(),
  approvalPolicy: z.object({
    approvalRequired: z.boolean(),
    stepUpThreshold: decimal.optional(),
    secondApproverThreshold: decimal.optional(),
  }),
} as const;

const createRecurringTemplateSchema = context.extend({
  commandType: z.literal('CreateRecurringExpenseTemplate'),
  ...recurringTemplateFields,
});

const updateRecurringTemplateSchema = context.extend({
  commandType: z.literal('UpdateRecurringExpenseTemplate'),
  templateId: uuid,
  expectedVersion: z.number().int().nonnegative(),
  ...recurringTemplateFields,
});

const deactivateRecurringTemplateSchema = context.extend({
  commandType: z.literal('DeactivateRecurringExpenseTemplate'),
  templateId: uuid,
  expectedVersion: z.number().int().nonnegative(),
});

const generateRecurringPeriodSchema = context.extend({
  commandType: z.literal('GenerateRecurringCostPeriod'),
  templateId: uuid,
  businessDate: date,
});

const transitionSchema = context.extend({
  expenseId: uuid,
  expectedVersion: z.number().int().nonnegative(),
});

const reasonTransitionSchema = transitionSchema.extend({
  reason: z.string().trim().min(1).max(500),
});

function idempotencyKey(request: Request): string {
  return request.headers.get('idempotency-key')?.trim() ?? '';
}

function contextFor(
  request: Request,
  input: { tenantId: string; legalEntityId?: string; stationId?: string },
) {
  return resolveExpenseCommandContext({
    request,
    requestedTenantId: input.tenantId,
    legalEntityId: input.legalEntityId,
    stationId: input.stationId,
  });
}

export async function submitExpenseFromRequest(request: Request, body: unknown) {
  const input = submitSchema.parse(body);
  const commandContext = await contextFor(request, input);
  return executeExpenseCommand({
    context: commandContext,
    commandType: input.commandType,
    permissionCode: 'expense.submit',
    idempotencyKey: idempotencyKey(request),
    requestHash: requestHash(input),
    audit: {
      actionCode: 'EXPENSE.SUBMITTED',
      subjectType: 'Expense',
      subjectId: (result) => (result as { expenseId: string }).expenseId,
    },
    execute: (transaction) => submitExpenseInTransaction(transaction, commandContext, input),
  });
}

export async function returnExpenseFromRequest(request: Request, body: unknown) {
  const input = reasonTransitionSchema
    .extend({ commandType: z.literal('ReturnExpense') })
    .parse(body);
  const commandContext = await contextFor(request, input);
  return executeExpenseCommand({
    context: commandContext,
    commandType: input.commandType,
    permissionCode: 'expense.approve',
    idempotencyKey: idempotencyKey(request),
    requestHash: requestHash(input),
    audit: {
      actionCode: 'EXPENSE.RETURNED',
      subjectType: 'Expense',
      subjectId: input.expenseId,
      reason: input.reason,
    },
    execute: (transaction) => returnExpenseInTransaction(transaction, commandContext, input),
  });
}

export async function approveExpenseFromRequest(request: Request, body: unknown) {
  const input = transitionSchema.extend({ commandType: z.literal('ApproveExpense') }).parse(body);
  const commandContext = await contextFor(request, input);
  return executeExpenseCommand({
    context: commandContext,
    commandType: input.commandType,
    permissionCode: 'expense.approve',
    idempotencyKey: idempotencyKey(request),
    requestHash: requestHash(input),
    audit: { actionCode: 'EXPENSE.APPROVED', subjectType: 'Expense', subjectId: input.expenseId },
    execute: (transaction) => approveExpenseInTransaction(transaction, commandContext, input),
  });
}

export async function rejectExpenseFromRequest(request: Request, body: unknown) {
  const input = reasonTransitionSchema
    .extend({ commandType: z.literal('RejectExpense') })
    .parse(body);
  const commandContext = await contextFor(request, input);
  return executeExpenseCommand({
    context: commandContext,
    commandType: input.commandType,
    permissionCode: 'expense.approve',
    idempotencyKey: idempotencyKey(request),
    requestHash: requestHash(input),
    audit: {
      actionCode: 'EXPENSE.REJECTED',
      subjectType: 'Expense',
      subjectId: input.expenseId,
      reason: input.reason,
    },
    execute: (transaction) => rejectExpenseInTransaction(transaction, commandContext, input),
  });
}

export async function postExpenseFromRequest(request: Request, body: unknown) {
  const input = transitionSchema.extend({ commandType: z.literal('PostExpense') }).parse(body);
  const commandContext = await contextFor(request, input);
  return executeExpenseCommand({
    context: commandContext,
    commandType: input.commandType,
    permissionCode: 'expense.post',
    idempotencyKey: idempotencyKey(request),
    requestHash: requestHash(input),
    audit: { actionCode: 'EXPENSE.POSTED', subjectType: 'Expense', subjectId: input.expenseId },
    execute: (transaction) => postExpenseInTransaction(transaction, commandContext, input),
  });
}

export async function reverseExpenseFromRequest(request: Request, body: unknown) {
  const input = reasonTransitionSchema
    .extend({ commandType: z.literal('ReverseExpense') })
    .parse(body);
  const commandContext = await contextFor(request, input);
  return executeExpenseCommand({
    context: commandContext,
    commandType: input.commandType,
    permissionCode: 'expense.reverse',
    idempotencyKey: idempotencyKey(request),
    requestHash: requestHash(input),
    audit: {
      actionCode: 'EXPENSE.REVERSED',
      subjectType: 'Expense',
      subjectId: input.expenseId,
      reason: input.reason,
    },
    execute: (transaction) => reverseExpenseInTransaction(transaction, commandContext, input),
  });
}

export async function createRecurringExpenseTemplateFromRequest(request: Request, body: unknown) {
  const input = createRecurringTemplateSchema.parse(body);
  const commandContext = await contextFor(request, input);
  return executeExpenseCommand({
    context: commandContext,
    commandType: input.commandType,
    permissionCode: 'expense.recurring.manage',
    idempotencyKey: idempotencyKey(request),
    requestHash: requestHash(input),
    audit: {
      actionCode: 'EXPENSE_RECURRING_TEMPLATE.CREATED',
      subjectType: 'RecurringExpenseTemplate',
      subjectId: (result) => (result as { templateId: string }).templateId,
    },
    execute: (transaction) =>
      createRecurringExpenseTemplateInTransaction(transaction, commandContext, input),
  });
}

export async function updateRecurringExpenseTemplateFromRequest(request: Request, body: unknown) {
  const input = updateRecurringTemplateSchema.parse(body);
  const commandContext = await contextFor(request, input);
  return executeExpenseCommand({
    context: commandContext,
    commandType: input.commandType,
    permissionCode: 'expense.recurring.manage',
    idempotencyKey: idempotencyKey(request),
    requestHash: requestHash(input),
    audit: {
      actionCode: 'EXPENSE_RECURRING_TEMPLATE.UPDATED',
      subjectType: 'RecurringExpenseTemplate',
      subjectId: input.templateId,
    },
    execute: (transaction) =>
      updateRecurringExpenseTemplateInTransaction(transaction, commandContext, input),
  });
}

export async function deactivateRecurringExpenseTemplateFromRequest(
  request: Request,
  body: unknown,
) {
  const input = deactivateRecurringTemplateSchema.parse(body);
  const commandContext = await contextFor(request, input);
  return executeExpenseCommand({
    context: commandContext,
    commandType: input.commandType,
    permissionCode: 'expense.recurring.manage',
    idempotencyKey: idempotencyKey(request),
    requestHash: requestHash(input),
    audit: {
      actionCode: 'EXPENSE_RECURRING_TEMPLATE.DEACTIVATED',
      subjectType: 'RecurringExpenseTemplate',
      subjectId: input.templateId,
    },
    execute: (transaction) =>
      deactivateRecurringExpenseTemplateInTransaction(transaction, commandContext, input),
  });
}

export async function generateRecurringCostPeriodFromRequest(request: Request, body: unknown) {
  const input = generateRecurringPeriodSchema.parse(body);
  const commandContext = await contextFor(request, input);
  return executeExpenseCommand({
    context: commandContext,
    commandType: input.commandType,
    permissionCode: 'expense.recurring.manage',
    idempotencyKey: idempotencyKey(request),
    requestHash: requestHash(input),
    audit: {
      actionCode: 'EXPENSE_RECURRING_PERIOD.GENERATED',
      subjectType: 'Expense',
      subjectId: (result) => (result as { expenseId: string }).expenseId,
      metadata: { templateId: input.templateId, businessDate: input.businessDate },
    },
    execute: (transaction) =>
      generateRecurringCostPeriodInTransaction(transaction, commandContext, input),
  });
}

export type ExpenseCommandName = (typeof import('./application').EXPENSE_COMMAND_TYPES)[number];

export function assertExpenseCommandType(value: unknown): ExpenseCommandName {
  if (
    value === 'SubmitExpense' ||
    value === 'ReturnExpense' ||
    value === 'ApproveExpense' ||
    value === 'RejectExpense' ||
    value === 'PostExpense' ||
    value === 'ReverseExpense' ||
    value === 'CreateRecurringExpenseTemplate' ||
    value === 'UpdateRecurringExpenseTemplate' ||
    value === 'DeactivateRecurringExpenseTemplate' ||
    value === 'GenerateRecurringCostPeriod'
  ) {
    return value;
  }
  throw new AppError('VALIDATION_FAILED', 'Unsupported expense command type');
}
