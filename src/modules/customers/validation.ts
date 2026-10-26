import { z } from 'zod';

const uuid = z.string().uuid();
const decimalText = z
  .string()
  .trim()
  .regex(
    /^\d+(?:\.\d+)?$/,
    'Enter a number using digits and an optional decimal point, for example 250.00',
  );
const currency = z
  .string()
  .trim()
  .regex(/^[A-Z]{3}$/, 'Use a three-letter currency code in capitals, for example USD');
const instant = z.string().datetime({ offset: true });
const statementPeriod = z
  .string()
  .trim()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'A statement period must use YYYY-MM');

const requiredText = (max: number) => z.string().trim().min(1).max(max);

/**
 * S13: what is written down about one account transaction. Every field is optional on its own (the
 * owner has not said which are mandatory); at least one must be given. Voucher numbers are NOT
 * required to be unique (open owner decision).
 */
export const customerEntryDetailsSchema = z
  .object({
    /** Stored in capitals so "abc 1234" and "ABC 1234" are the same vehicle. */
    vehicleRegistration: requiredText(20)
      .transform((value) => value.toUpperCase())
      .optional(),
    driverName: requiredText(120).optional(),
    voucherNumber: requiredText(60).optional(),
    /** The person (membership) who approved the transaction. */
    approvedByMembershipId: uuid.optional(),
    /** An already-uploaded supporting document (see the documents module). */
    documentId: uuid.optional(),
  })
  .strict()
  .refine((details) => Object.values(details).some((value) => value !== undefined), {
    message: 'Add at least one of vehicle, driver, voucher number, approver or document.',
  });

export const recordCustomerEntryDetailsSchema = z.object({
  commandType: z.literal('RecordCustomerEntryDetails'),
  tenantId: uuid,
  /** The station where the transaction happened or the cash was received. */
  stationId: uuid,
  ledgerEntryId: uuid,
  details: customerEntryDetailsSchema,
});

export const overrideCustomerCreditLimitSchema = z.object({
  commandType: z.literal('OverrideCustomerCreditLimit'),
  tenantId: uuid,
  accountId: uuid,
  expectedVersion: z.number().int().nonnegative(),
  newLimit: decimalText.refine((value) => /[1-9]/.test(value), 'A credit limit must be above zero'),
  approvedByMembershipId: uuid,
  reason: z.string().trim().min(1, 'Say why the limit is being changed').max(500),
});

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
  /** The one legal entity this customer's credit is with (ADR-017). */
  legalEntityId: uuid.optional(),
});

const customerLifecycleCommandBase = z.object({
  tenantId: uuid,
  customerId: uuid,
  expectedVersion: z.number().int().nonnegative(),
});

export const updateCustomerSchema = customerLifecycleCommandBase
  .extend({
    commandType: z.literal('UpdateCustomer'),
    accountReference: z.string().trim().min(1).max(80).optional(),
    displayName: z.string().trim().min(1).max(200).optional(),
    contactMetadata: z.record(z.string(), z.string().trim().max(200)).optional(),
  })
  .superRefine((input, refinement) => {
    if (
      input.accountReference === undefined &&
      input.displayName === undefined &&
      input.contactMetadata === undefined
    ) {
      refinement.addIssue({
        code: 'custom',
        path: ['accountReference'],
        message: 'Change at least one detail before saving.',
      });
    }
  });

export const activateCustomerSchema = customerLifecycleCommandBase.extend({
  commandType: z.literal('ActivateCustomer'),
});

export const deactivateCustomerSchema = customerLifecycleCommandBase.extend({
  commandType: z.literal('DeactivateCustomer'),
});

export const setCustomerLegalEntitySchema = customerLifecycleCommandBase.extend({
  commandType: z.literal('SetCustomerLegalEntity'),
  legalEntityId: uuid,
});

export const customerAccountStationScopeSchema = z.enum(['ALL', 'SELECTED']);

function refineStationScope(
  input: { stationScope?: 'ALL' | 'SELECTED' | undefined; stationIds?: string[] | undefined },
  refinement: z.RefinementCtx,
) {
  const count = input.stationIds?.length ?? 0;
  if (input.stationScope === 'SELECTED' && count === 0) {
    refinement.addIssue({
      code: 'custom',
      path: ['stationIds'],
      message: 'Choose at least one station, or use all stations.',
    });
  }
  if (input.stationScope !== 'SELECTED' && count > 0) {
    refinement.addIssue({
      code: 'custom',
      path: ['stationIds'],
      message: 'Stations can only be listed when you choose specific stations.',
    });
  }
  if (new Set(input.stationIds).size !== count) {
    refinement.addIssue({
      code: 'custom',
      path: ['stationIds'],
      message: 'Each station can only be listed once.',
    });
  }
}

export const setCustomerAccountStationsSchema = z
  .object({
    commandType: z.literal('SetCustomerAccountStations'),
    tenantId: uuid,
    accountId: uuid,
    expectedVersion: z.number().int().nonnegative(),
    stationScope: customerAccountStationScopeSchema,
    stationIds: z.array(uuid).max(100).optional(),
  })
  .superRefine(refineStationScope);

export const createCustomerAccountSchema = z
  .object({
    commandType: z.literal('CreateCustomerAccount'),
    tenantId: uuid,
    customerId: uuid,
    accountType: customerAccountTypeSchema,
    currency,
    creditLimit: decimalText.optional(),
    /** Usual days to pay (0 to 365). Informational: it never blocks a sale. */
    creditDays: z.number().int().min(0).max(365).optional(),
    /**
     * Marks the credit account as a staff fuel benefit. The credit limit is then the monthly USD
     * limit (PROPOSED default, awaiting owner sign-off). Changing it later needs the credit-limit
     * override approval.
     */
    staffBenefit: z
      .object({
        staffName: z.string().trim().min(1, 'Enter the staff member’s name.').max(200),
        staffMembershipId: uuid.optional(),
      })
      .optional(),
    /** Optional during onboarding; omitted scope remains unconfigured. */
    stationScope: customerAccountStationScopeSchema.optional(),
    stationIds: z.array(uuid).max(100).optional(),
  })
  .superRefine((input, refinement) => {
    refineStationScope(input, refinement);
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
        message: 'Only credit accounts have a credit limit.',
      });
    }
    if (input.creditDays !== undefined && input.accountType !== 'CREDIT') {
      refinement.addIssue({
        code: 'custom',
        path: ['creditDays'],
        message: 'Only credit accounts have a credit period.',
      });
    }
    if (input.staffBenefit && input.accountType !== 'CREDIT') {
      refinement.addIssue({
        code: 'custom',
        path: ['staffBenefit'],
        message: 'A staff fuel benefit uses a credit account.',
      });
    }
    if (input.staffBenefit && input.currency !== 'USD') {
      refinement.addIssue({
        code: 'custom',
        path: ['currency'],
        message: 'A staff fuel benefit limit is in US dollars.',
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
  entryDetails: customerEntryDetailsSchema.optional(),
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
  /** The station where the cash was received (ADR-017). */
  receivingStationId: uuid,
  amount: z.object({ amount: decimalText, currency }),
  source: customerSourceSchema,
  occurredAt: instant,
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().trim().max(500).optional(),
  entryDetails: customerEntryDetailsSchema.optional(),
});

export const recordPrepaidTopUpSchema = z
  .object({
    commandType: z.literal('RecordPrepaidTopUp'),
    tenantId: uuid,
    /** Optional station context; when supplied it is checked against account scope. */
    stationId: uuid.optional(),
    accountId: uuid,
    accountType: z.enum(['PREPAID_VALUE', 'PREPAID_LITRES']),
    amount: z.object({ amount: decimalText, currency }).optional(),
    productId: uuid.optional(),
    litres: decimalText.optional(),
    source: customerSourceSchema,
    occurredAt: instant,
    businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    entryDetails: customerEntryDetailsSchema.optional(),
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
        message: 'Prepaid fuel top-ups need a fuel and a number of litres.',
      });
    }
  });

export const customerStatementQuerySchema = z
  .object({
    tenantId: uuid,
    accountId: uuid,
    /** Business-date month used for a monthly statement read model. */
    period: statementPeriod.optional(),
    asOf: instant.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    cursor: z.string().trim().min(1).max(200).optional(),
  })
  .superRefine((input, refinement) => {
    if (input.period && input.asOf) {
      refinement.addIssue({
        code: 'custom',
        path: ['period'],
        message: 'A statement period cannot be combined with asOf',
      });
    }
  });

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
export type ActivateCustomerInput = z.infer<typeof activateCustomerSchema>;
export type DeactivateCustomerInput = z.infer<typeof deactivateCustomerSchema>;
export type CreateCustomerAccountInput = z.infer<typeof createCustomerAccountSchema>;
export type SetCustomerLegalEntityInput = z.infer<typeof setCustomerLegalEntitySchema>;
export type SetCustomerAccountStationsInput = z.infer<typeof setCustomerAccountStationsSchema>;
export type CompleteCustomerFuelTransactionInput = z.infer<
  typeof completeCustomerFuelTransactionSchema
>;
export type CustomerEntryDetailsInput = z.infer<typeof customerEntryDetailsSchema>;
export type RecordCustomerEntryDetailsInput = z.infer<typeof recordCustomerEntryDetailsSchema>;
export type OverrideCustomerCreditLimitInput = z.infer<typeof overrideCustomerCreditLimitSchema>;
export type RecordCustomerPaymentInput = z.infer<typeof recordCustomerPaymentSchema>;
export type RecordPrepaidTopUpInput = z.infer<typeof recordPrepaidTopUpSchema>;
export type RequestCustomerFuelAuthorizationInput = z.infer<
  typeof requestCustomerFuelAuthorizationSchema
>;
