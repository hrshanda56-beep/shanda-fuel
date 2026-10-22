import 'server-only';

import { AppError } from '../../platform/errors';
import {
  executeExpenseCommand,
  expenseRequestHash,
  resolveExpenseCommandContext,
  type ExpenseCommandContext,
  type ExpenseTransaction,
} from './application';
import {
  EXPENSE_COMMAND_SCHEMAS,
  EXPENSE_COMMAND_TYPES,
  type ExpenseCommandInput,
  type ExpenseCommandType,
} from './contracts';
import {
  approveExpenseInTransaction,
  correctExpenseFactsInTransaction,
  adjustRecurringCostRecognitionInTransaction,
  createExpenseCategoryInTransaction,
  createRecurringCostTemplateInTransaction,
  generateRecurringCostPeriodInTransaction,
  postExpenseInTransaction,
  recognizeRecurringCostInTransaction,
  recordExpensePaymentInTransaction,
  rejectExpenseInTransaction,
  reverseExpenseInTransaction,
  reverseExpensePaymentInTransaction,
  reverseRecurringCostRecognitionInTransaction,
  setExpensePolicyInTransaction,
  submitExpenseInTransaction,
} from './persistence';

export function assertExpenseCommandType(value: unknown): ExpenseCommandType {
  if (typeof value === 'string' && (EXPENSE_COMMAND_TYPES as string[]).includes(value)) {
    return value as ExpenseCommandType;
  }
  throw new AppError('VALIDATION_FAILED', 'Unsupported expense command type');
}

type Handler<T extends ExpenseCommandType> = {
  subjectType: string;
  subjectId: (input: ExpenseCommandInput<T>, result: Record<string, unknown>) => string;
  reason?: (input: ExpenseCommandInput<T>) => string | undefined;
  /** HTTP status on first execution. */
  created: boolean;
  run: (
    transaction: ExpenseTransaction,
    context: ExpenseCommandContext,
    input: ExpenseCommandInput<T>,
  ) => Promise<Record<string, unknown>>;
};

const idOf = (key: string) => (_: unknown, result: Record<string, unknown>) =>
  String(result[key] ?? '');

const HANDLERS: { [K in ExpenseCommandType]: Handler<K> } = {
  CorrectExpenseFacts: {
    subjectType: 'Expense',
    subjectId: (input) => input.expenseId,
    reason: (input) => input.reason,
    created: false,
    run: correctExpenseFactsInTransaction,
  },
  CreateExpenseCategory: {
    subjectType: 'ExpenseCategory',
    subjectId: idOf('categoryId'),
    created: true,
    run: createExpenseCategoryInTransaction,
  },
  SetExpensePolicy: {
    subjectType: 'ExpensePolicy',
    subjectId: idOf('policyId'),
    created: false,
    run: setExpensePolicyInTransaction,
  },
  SubmitExpense: {
    subjectType: 'Expense',
    subjectId: idOf('expenseId'),
    created: true,
    run: submitExpenseInTransaction,
  },
  ApproveExpense: {
    subjectType: 'Expense',
    subjectId: (input) => input.expenseId,
    created: false,
    run: approveExpenseInTransaction,
  },
  RejectExpense: {
    subjectType: 'Expense',
    subjectId: (input) => input.expenseId,
    reason: (input) => input.reason,
    created: false,
    run: rejectExpenseInTransaction,
  },
  PostExpense: {
    subjectType: 'Expense',
    subjectId: (input) => input.expenseId,
    created: false,
    run: postExpenseInTransaction,
  },
  ReverseExpense: {
    subjectType: 'Expense',
    subjectId: (input) => input.expenseId,
    reason: (input) => input.reason,
    created: false,
    run: reverseExpenseInTransaction,
  },
  RecordExpensePayment: {
    subjectType: 'ExpensePayment',
    subjectId: idOf('paymentId'),
    created: true,
    run: recordExpensePaymentInTransaction,
  },
  ReverseExpensePayment: {
    subjectType: 'ExpensePayment',
    subjectId: (input) => input.paymentId,
    reason: (input) => input.reason,
    created: false,
    run: reverseExpensePaymentInTransaction,
  },
  CreateRecurringCostTemplate: {
    subjectType: 'RecurringCostTemplate',
    subjectId: idOf('templateId'),
    created: true,
    run: createRecurringCostTemplateInTransaction,
  },
  GenerateRecurringCostPeriod: {
    subjectType: 'RecurringCostPeriod',
    subjectId: idOf('periodId'),
    created: true,
    run: generateRecurringCostPeriodInTransaction,
  },
  RecognizeRecurringCost: {
    subjectType: 'RecurringCostRecognition',
    subjectId: idOf('recognitionId'),
    created: true,
    run: recognizeRecurringCostInTransaction,
  },
  ReverseRecurringCostRecognition: {
    subjectType: 'RecurringCostRecognition',
    subjectId: idOf('recognitionId'),
    reason: (input) => input.reason,
    created: false,
    run: reverseRecurringCostRecognitionInTransaction,
  },
  AdjustRecurringCostRecognition: {
    subjectType: 'RecurringCostRecognition',
    subjectId: idOf('recognitionId'),
    reason: (input) => input.reason,
    created: true,
    run: adjustRecurringCostRecognitionInTransaction,
  },
};

/** Validate, authorize, and execute one named expense command with idempotency and audit. */
export async function executeExpenseCommandFromRequest(
  request: Request,
  body: unknown,
): Promise<{ status: 200 | 201; body: Record<string, unknown> }> {
  const commandType = assertExpenseCommandType(
    typeof body === 'object' && body !== null && 'commandType' in body
      ? (body as { commandType: unknown }).commandType
      : undefined,
  );
  const parsed = EXPENSE_COMMAND_SCHEMAS[commandType].safeParse(body);
  if (!parsed.success) {
    throw new AppError('VALIDATION_FAILED', 'The expense command is invalid', {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  // Each schema has been validated for this exact command type above.
  const input = parsed.data as never as ExpenseCommandInput<ExpenseCommandType> & {
    tenantId: string;
    legalEntityId?: string;
    stationId?: string;
  };
  const handler = HANDLERS[commandType] as unknown as Handler<ExpenseCommandType>;
  const context = await resolveExpenseCommandContext({
    request,
    tenantId: input.tenantId,
    legalEntityId: input.legalEntityId,
    stationId: input.stationId,
  });
  const result = await executeExpenseCommand<Record<string, unknown>>({
    context,
    commandType,
    idempotencyKey: request.headers.get('idempotency-key') ?? '',
    requestHash: expenseRequestHash(input),
    audit: {
      subjectType: handler.subjectType,
      subjectId: (value) => handler.subjectId(input as never, value),
      reason: handler.reason?.(input as never),
    },
    execute: (transaction) => handler.run(transaction, context, input as never),
  });
  return { status: handler.created ? 201 : 200, body: result };
}
