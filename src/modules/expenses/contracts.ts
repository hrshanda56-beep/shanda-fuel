import { z } from 'zod';
import type { PermissionCode } from '../../platform/security/permissions';
import { EXPENSE_CATEGORY_CLASSIFICATIONS, SETTLEMENT_SOURCES } from './domain';

export const EXPENSE_PERMISSION_CODES = [
  'expense.view',
  'expense.submit',
  'expense.approve',
  'expense.post',
  'expense.reverse',
  'expense.payment.record',
  'expense.payment.reverse',
  'expense.manage',
  'expense.policy.manage',
  'expense.recurring.manage',
  'expense.recurring.recognize',
] as const satisfies readonly PermissionCode[];

const uuid = z.string().uuid();
/** Exact decimal strings only: JSON numbers are rejected so no value passes through a float. */
const decimal = z
  .string()
  .min(1)
  .max(30)
  .regex(/^\d+(?:\.\d{1,4})?$/, 'An exact decimal string with at most 4 decimals is required');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'A YYYY-MM-DD date is required');
const version = z.number().int().nonnegative();
const reason = z.string().trim().min(1).max(500);
const stationBase = z.object({ tenantId: uuid, stationId: uuid });

export const createExpenseCategorySchema = z.object({
  commandType: z.literal('CreateExpenseCategory'),
  tenantId: uuid,
  legalEntityId: uuid,
  code: z.string().trim().min(1).max(60),
  name: z.string().trim().min(1).max(160),
  classification: z.enum(EXPENSE_CATEGORY_CLASSIFICATIONS),
});

export const setExpensePolicySchema = z.object({
  commandType: z.literal('SetExpensePolicy'),
  tenantId: uuid,
  legalEntityId: uuid,
  stepUpThreshold: decimal.nullable(),
  secondApprovalThreshold: decimal.nullable(),
  /** Omit when creating the first policy; required when changing an existing one. */
  expectedVersion: version.optional(),
});

export const submitExpenseSchema = stationBase.extend({
  commandType: z.literal('SubmitExpense'),
  categoryId: uuid,
  expenseDate: date,
  description: z.string().trim().min(1).max(500),
  payee: z.string().trim().max(160).optional(),
  reference: z.string().trim().max(120).optional(),
  amount: decimal,
});

export const approveExpenseSchema = stationBase.extend({
  commandType: z.literal('ApproveExpense'),
  expenseId: uuid,
  expectedVersion: version,
});

export const rejectExpenseSchema = stationBase.extend({
  commandType: z.literal('RejectExpense'),
  expenseId: uuid,
  expectedVersion: version,
  reason,
});

export const postExpenseSchema = stationBase.extend({
  commandType: z.literal('PostExpense'),
  expenseId: uuid,
  expectedVersion: version,
});

export const reverseExpenseSchema = stationBase.extend({
  commandType: z.literal('ReverseExpense'),
  expenseId: uuid,
  expectedVersion: version,
  reason,
});

export const recordExpensePaymentSchema = stationBase
  .extend({
    commandType: z.literal('RecordExpensePayment'),
    expenseId: uuid.optional(),
    recurringPeriodId: uuid.optional(),
    expectedVersion: version,
    paymentDate: date,
    amount: decimal,
    settlementSource: z.enum(SETTLEMENT_SOURCES),
    cashMovementId: uuid.optional(),
    externalReference: z.string().trim().min(1).max(160).optional(),
  })
  .refine((value) => Boolean(value.expenseId) !== Boolean(value.recurringPeriodId), {
    message: 'Exactly one of expenseId or recurringPeriodId is required',
    path: ['expenseId'],
  });

export const reverseExpensePaymentSchema = stationBase.extend({
  commandType: z.literal('ReverseExpensePayment'),
  paymentId: uuid,
  expectedVersion: version,
  reason,
});

export const createRecurringCostTemplateSchema = stationBase.extend({
  commandType: z.literal('CreateRecurringCostTemplate'),
  categoryId: uuid,
  name: z.string().trim().min(1).max(160),
  amount: decimal,
  startDate: date,
  endDate: date.optional(),
});

export const generateRecurringCostPeriodSchema = stationBase.extend({
  commandType: z.literal('GenerateRecurringCostPeriod'),
  templateId: uuid,
  periodStart: date,
});

export const recognizeRecurringCostSchema = stationBase.extend({
  commandType: z.literal('RecognizeRecurringCost'),
  periodId: uuid,
  recognitionDate: date,
});

export const reverseRecurringCostRecognitionSchema = stationBase.extend({
  commandType: z.literal('ReverseRecurringCostRecognition'),
  periodId: uuid,
  recognitionDate: date,
  reason,
});

export const adjustRecurringCostRecognitionSchema = stationBase.extend({
  commandType: z.literal('AdjustRecurringCostRecognition'),
  periodId: uuid,
  recognitionDate: date,
  amount: decimal,
  reason,
});

export const EXPENSE_COMMAND_SCHEMAS = {
  CreateExpenseCategory: createExpenseCategorySchema,
  SetExpensePolicy: setExpensePolicySchema,
  SubmitExpense: submitExpenseSchema,
  ApproveExpense: approveExpenseSchema,
  RejectExpense: rejectExpenseSchema,
  PostExpense: postExpenseSchema,
  ReverseExpense: reverseExpenseSchema,
  RecordExpensePayment: recordExpensePaymentSchema,
  ReverseExpensePayment: reverseExpensePaymentSchema,
  CreateRecurringCostTemplate: createRecurringCostTemplateSchema,
  GenerateRecurringCostPeriod: generateRecurringCostPeriodSchema,
  RecognizeRecurringCost: recognizeRecurringCostSchema,
  ReverseRecurringCostRecognition: reverseRecurringCostRecognitionSchema,
  AdjustRecurringCostRecognition: adjustRecurringCostRecognitionSchema,
} as const;

export type ExpenseCommandType = keyof typeof EXPENSE_COMMAND_SCHEMAS;
export const EXPENSE_COMMAND_TYPES = Object.keys(EXPENSE_COMMAND_SCHEMAS) as ExpenseCommandType[];

export type ExpenseCommandPolicy = Readonly<{
  permissionCode: PermissionCode;
  /** The command always needs a current step-up (high-risk permission). */
  alwaysStepUp: boolean;
  /** The command needs step-up at or above the configured policy threshold. */
  thresholdStepUp: boolean;
  requiresExpectedVersion: boolean;
  auditActionCode: string;
}>;

export const EXPENSE_COMMAND_POLICY: Readonly<Record<ExpenseCommandType, ExpenseCommandPolicy>> = {
  CreateExpenseCategory: {
    permissionCode: 'expense.manage',
    alwaysStepUp: false,
    thresholdStepUp: false,
    requiresExpectedVersion: false,
    auditActionCode: 'EXPENSE.CATEGORY_CREATED',
  },
  SetExpensePolicy: {
    permissionCode: 'expense.policy.manage',
    alwaysStepUp: true,
    thresholdStepUp: false,
    requiresExpectedVersion: false,
    auditActionCode: 'EXPENSE.POLICY_SET',
  },
  SubmitExpense: {
    permissionCode: 'expense.submit',
    alwaysStepUp: false,
    thresholdStepUp: false,
    requiresExpectedVersion: false,
    auditActionCode: 'EXPENSE.SUBMITTED',
  },
  ApproveExpense: {
    permissionCode: 'expense.approve',
    alwaysStepUp: false,
    thresholdStepUp: true,
    requiresExpectedVersion: true,
    auditActionCode: 'EXPENSE.APPROVED',
  },
  RejectExpense: {
    permissionCode: 'expense.approve',
    alwaysStepUp: false,
    thresholdStepUp: false,
    requiresExpectedVersion: true,
    auditActionCode: 'EXPENSE.REJECTED',
  },
  PostExpense: {
    permissionCode: 'expense.post',
    alwaysStepUp: false,
    thresholdStepUp: true,
    requiresExpectedVersion: true,
    auditActionCode: 'EXPENSE.POSTED',
  },
  ReverseExpense: {
    permissionCode: 'expense.reverse',
    alwaysStepUp: true,
    thresholdStepUp: false,
    requiresExpectedVersion: true,
    auditActionCode: 'EXPENSE.REVERSED',
  },
  RecordExpensePayment: {
    permissionCode: 'expense.payment.record',
    alwaysStepUp: false,
    thresholdStepUp: true,
    requiresExpectedVersion: true,
    auditActionCode: 'EXPENSE.PAYMENT_RECORDED',
  },
  ReverseExpensePayment: {
    permissionCode: 'expense.payment.reverse',
    alwaysStepUp: true,
    thresholdStepUp: false,
    requiresExpectedVersion: true,
    auditActionCode: 'EXPENSE.PAYMENT_REVERSED',
  },
  CreateRecurringCostTemplate: {
    permissionCode: 'expense.recurring.manage',
    alwaysStepUp: false,
    thresholdStepUp: false,
    requiresExpectedVersion: false,
    auditActionCode: 'EXPENSE.RECURRING_TEMPLATE_CREATED',
  },
  GenerateRecurringCostPeriod: {
    permissionCode: 'expense.recurring.manage',
    alwaysStepUp: false,
    thresholdStepUp: false,
    requiresExpectedVersion: false,
    auditActionCode: 'EXPENSE.RECURRING_PERIOD_GENERATED',
  },
  RecognizeRecurringCost: {
    permissionCode: 'expense.recurring.recognize',
    alwaysStepUp: false,
    thresholdStepUp: false,
    requiresExpectedVersion: false,
    auditActionCode: 'EXPENSE.RECURRING_COST_RECOGNIZED',
  },
  ReverseRecurringCostRecognition: {
    permissionCode: 'expense.recurring.recognize',
    alwaysStepUp: true,
    thresholdStepUp: false,
    requiresExpectedVersion: false,
    auditActionCode: 'EXPENSE.RECURRING_RECOGNITION_REVERSED',
  },
  AdjustRecurringCostRecognition: {
    permissionCode: 'expense.recurring.recognize',
    alwaysStepUp: true,
    thresholdStepUp: false,
    requiresExpectedVersion: false,
    auditActionCode: 'EXPENSE.RECURRING_RECOGNITION_ADJUSTED',
  },
};

export type ExpenseCommandInput<T extends ExpenseCommandType> = z.infer<
  (typeof EXPENSE_COMMAND_SCHEMAS)[T]
>;
