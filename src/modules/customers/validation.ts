import { z } from 'zod';

const uuid = z.string().uuid();
const decimalText = z
  .string()
  .trim()
  .regex(/^\d+(?:\.\d+)?$/, 'A non-negative decimal string is required');
const currency = z
  .string()
  .trim()
  .regex(/^[A-Z]{3}$/, 'An uppercase ISO-style currency code is required');
const instant = z.string().datetime({ offset: true });

export const customerAccountTypeSchema = z.enum(['CREDIT', 'PREPAID_VALUE', 'PREPAID_LITRES']);
export const customerSourceSchema = z.object({
  sourceType: z.enum([
    'A5_RECONCILIATION_CUSTOMER_FUEL',
    'CUSTOMER_PAYMENT',
    'PREPAID_TOPUP',
    'MANUAL_ADJUSTMENT',
    'LEDGER_REVERSAL',
  ]),
  sourceId: uuid,
  sourceRevisionId: uuid.optional(),
});

export const createCustomerSchema = z.object({
  commandType: z.literal('CreateCustomer'),
  tenantId: uuid,
  accountReference: z.string().trim().min(1).max(80),
  displayName: z.string().trim().min(1).max(200),
  contactMetadata: z.record(z.string(), z.string().trim().max(200)).optional(),
});

export const createCustomerAccountSchema = z
  .object({
    commandType: z.literal('CreateCustomerAccount'),
    tenantId: uuid,
    customerId: uuid,
    accountType: customerAccountTypeSchema,
    currency,
    creditLimit: decimalText.optional(),
  })
  .superRefine((input, refinement) => {
    if (
      input.accountType === 'CREDIT' &&
      (!input.creditLimit || !/[1-9]/.test(input.creditLimit))
    ) {
      refinement.addIssue({
        code: 'custom',
        path: ['creditLimit'],
        message: 'Credit accounts require a positive credit limit',
      });
    }
    if (input.accountType !== 'CREDIT' && input.creditLimit) {
      refinement.addIssue({
        code: 'custom',
        path: ['creditLimit'],
        message: 'Credit limits apply only to credit accounts',
      });
    }
  });

const fuelValueSchema = z.object({
  productId: uuid,
  litres: decimalText,
  amount: z.object({ amount: decimalText, currency }),
});

export const requestCustomerFuelAuthorizationSchema = z.object({
  commandType: z.literal('RequestCustomerFuelAuthorization'),
  tenantId: uuid,
  stationId: uuid,
  accountId: uuid,
  authorizationId: uuid,
  requested: fuelValueSchema,
  requestedAt: instant,
  source: customerSourceSchema,
});

export const completeCustomerFuelTransactionSchema = z.object({
  commandType: z.literal('CompleteCustomerFuelTransaction'),
  tenantId: uuid,
  stationId: uuid,
  accountId: uuid,
  authorizationId: uuid,
  entryId: uuid,
  fuelAllocationId: uuid,
  used: fuelValueSchema,
  evidence: z.object({
    reconciliationId: uuid,
    reconciliationRevisionId: uuid,
    paymentEvidenceId: uuid,
  }),
  occurredAt: instant,
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const authorizeCustomerFuelSchema = z.object({
  commandType: z.literal('AuthorizeCustomerFuel'),
  tenantId: uuid,
  stationId: uuid,
  authorizationId: uuid,
  expectedVersion: z.number().int().nonnegative(),
});

export const cancelCustomerFuelAuthorizationSchema = z.object({
  commandType: z.literal('CancelCustomerFuelAuthorization'),
  tenantId: uuid,
  stationId: uuid,
  authorizationId: uuid,
  expectedVersion: z.number().int().nonnegative(),
  reason: z.string().trim().min(1).max(500),
});

export const expireCustomerFuelAuthorizationSchema = z.object({
  commandType: z.literal('ExpireCustomerFuelAuthorization'),
  tenantId: uuid,
  stationId: uuid,
  authorizationId: uuid,
  expectedVersion: z.number().int().nonnegative(),
});

export const recordCustomerPaymentSchema = z.object({
  commandType: z.literal('RecordCustomerPayment'),
  tenantId: uuid,
  accountId: uuid,
  amount: z.object({ amount: decimalText, currency }),
  source: customerSourceSchema,
  occurredAt: instant,
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().trim().max(500).optional(),
});

export const recordPrepaidTopUpSchema = z
  .object({
    commandType: z.literal('RecordPrepaidTopUp'),
    tenantId: uuid,
    accountId: uuid,
    accountType: z.enum(['PREPAID_VALUE', 'PREPAID_LITRES']),
    amount: z.object({ amount: decimalText, currency }).optional(),
    productId: uuid.optional(),
    litres: decimalText.optional(),
    source: customerSourceSchema,
    occurredAt: instant,
    businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .superRefine((input, refinement) => {
    if (
      input.accountType === 'PREPAID_VALUE' &&
      (!input.amount || input.productId || input.litres)
    ) {
      refinement.addIssue({
        code: 'custom',
        path: ['amount'],
        message: 'Prepaid value top-ups require only a monetary amount',
      });
    }
    if (
      input.accountType === 'PREPAID_LITRES' &&
      (!input.productId || !input.litres || input.amount)
    ) {
      refinement.addIssue({
        code: 'custom',
        path: ['litres'],
        message: 'Prepaid litre top-ups require a product and litres',
      });
    }
  });

export const customerStatementQuerySchema = z.object({
  tenantId: uuid,
  accountId: uuid,
  asOf: instant.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().trim().min(1).max(200).optional(),
});

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type CreateCustomerAccountInput = z.infer<typeof createCustomerAccountSchema>;
export type CompleteCustomerFuelTransactionInput = z.infer<
  typeof completeCustomerFuelTransactionSchema
>;
export type RecordCustomerPaymentInput = z.infer<typeof recordCustomerPaymentSchema>;
export type RecordPrepaidTopUpInput = z.infer<typeof recordPrepaidTopUpSchema>;
export type RequestCustomerFuelAuthorizationInput = z.infer<
  typeof requestCustomerFuelAuthorizationSchema
>;
