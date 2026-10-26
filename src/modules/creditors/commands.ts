import 'server-only';

import { z } from 'zod';
import { AppError } from '../../platform/errors';
import {
  authorizeSupplierCommand,
  executeSupplierCommand,
  requestHash,
  resolveSupplierCommandContext,
} from './application';
import {
  allocateSupplierPaymentInTransaction,
  createSupplierInTransaction,
  updateSupplierDetailsInTransaction,
  postSupplierDocumentInTransaction,
  postSupplierPaymentInTransaction,
  reverseSupplierDocumentInTransaction,
  reverseSupplierPaymentInTransaction,
  setSupplierCreditLimitInTransaction,
  submitSupplierDocumentInTransaction,
  submitSupplierPaymentInTransaction,
} from './persistence';
import { setPurchasingPolicyInTransaction } from './purchasing-persistence';

const uuid = z.string().uuid();
const decimal = z
  .string()
  .min(1)
  .regex(/^\d+(?:\.\d+)?$/, 'An exact decimal string is required');
const base = z.object({ tenantId: uuid, legalEntityId: uuid });

const creditLimitText = z
  .string()
  .regex(/^\d+(?:\.\d{1,4})?$/, 'An amount with at most four decimals is required');

const supplierDetailFields = {
  contactName: z.string().trim().max(200).nullable().optional(),
  contactPhone: z.string().trim().max(60).nullable().optional(),
  contactEmail: z.string().trim().max(200).nullable().optional(),
  /** Usual credit period in days; null clears it. */
  defaultCreditDays: z.number().int().min(0).max(365).nullable().optional(),
};

const createSupplierSchema = base.extend({
  commandType: z.literal('CreateSupplier'),
  code: z.string().trim().min(1).max(80),
  legalName: z.string().trim().min(1).max(240),
  registrationReference: z.string().trim().max(120).optional(),
  ...supplierDetailFields,
  /** The most the business wants to owe this supplier; null/omitted = no limit. */
  creditLimit: creditLimitText.nullable().optional(),
});

const updateSupplierDetailsSchema = base.extend({
  commandType: z.literal('UpdateSupplierDetails'),
  supplierId: uuid,
  expectedVersion: z.number().int().nonnegative(),
  ...supplierDetailFields,
});

const setCreditLimitSchema = base.extend({
  commandType: z.literal('SetSupplierCreditLimit'),
  supplierId: uuid,
  expectedVersion: z.number().int().nonnegative(),
  /** Null removes the limit. */
  creditLimit: creditLimitText.nullable(),
});

const percent = z.string().regex(/^\d+(?:\.\d+)?$/, 'An exact decimal string is required');

const invoiceLineSchema = z.object({
  productId: uuid.optional(),
  description: z.string().trim().min(1).max(300),
  quantity: decimal,
  unitPrice: decimal,
  amount: decimal.optional(),
  vatRate: percent.optional(),
  vatAmount: decimal.optional(),
  /** Attaches the line to one of the document's delivery links (same delivery/allocation). */
  deliveryId: uuid.optional(),
  allocationId: uuid.optional(),
});

const submitDocumentSchema = base.extend({
  commandType: z.literal('SubmitSupplierDocument'),
  supplierId: uuid,
  documentType: z.enum(['INVOICE', 'CREDIT_NOTE']),
  referenceNumber: z.string().trim().min(1).max(120),
  documentDate: z.string(),
  dueDate: z.string().optional(),
  /** Cash or credit. Omitted = not recorded (older callers); see credit-terms.ts. */
  paymentTerms: z.enum(['CASH', 'CREDIT']).optional(),
  /** Days after the invoice date that payment falls due; the due date is worked out from it. */
  creditPeriodDays: z.number().int().min(0).max(365).optional(),
  /** Payable total (net plus VAT). Must equal the sum of the lines exactly. */
  amount: decimal,
  netAmount: decimal.optional(),
  vatAmount: decimal.optional(),
  lines: z.array(invoiceLineSchema).max(200).optional(),
  deliveryReferences: z
    .array(
      z.object({
        stationId: uuid,
        deliveryId: uuid,
        allocationId: uuid.optional(),
        invoicedQuantityLitres: decimal.optional(),
        invoicedAmount: decimal.optional(),
      }),
    )
    .max(100)
    .optional(),
});

const postDocumentSchema = base.extend({
  commandType: z.literal('PostSupplierDocument'),
  documentId: uuid,
  expectedVersion: z.number().int().nonnegative(),
  /** Needed only when the purchasing policy requires approval for out-of-tolerance invoices. */
  varianceApprovalReason: z.string().trim().min(1).max(500).optional(),
});

const reverseDocumentSchema = base.extend({
  commandType: z.literal('ReverseSupplierDocument'),
  documentId: uuid,
  expectedVersion: z.number().int().nonnegative(),
  reason: z.string().trim().min(1).max(500),
});

const submitPaymentSchema = base.extend({
  commandType: z.literal('SubmitSupplierPayment'),
  supplierId: uuid,
  paymentDate: z.string(),
  amount: decimal,
  reference: z.string().trim().min(1).max(120),
});

const postPaymentSchema = base.extend({
  commandType: z.literal('PostSupplierPayment'),
  paymentId: uuid,
  expectedVersion: z.number().int().nonnegative(),
});

const allocatePaymentSchema = base.extend({
  commandType: z.literal('AllocateSupplierPayment'),
  paymentId: uuid,
  expectedVersion: z.number().int().nonnegative(),
  allocations: z
    .array(z.object({ documentId: uuid, amount: decimal }))
    .min(1)
    .max(100),
});

const reversePaymentSchema = base.extend({
  commandType: z.literal('ReverseSupplierPayment'),
  paymentId: uuid,
  expectedVersion: z.number().int().nonnegative(),
  reason: z.string().trim().min(1).max(500),
});

const nullableDecimal = decimal.nullish();
const setPurchasingPolicySchema = base.extend({
  commandType: z.literal('SetPurchasingPolicy'),
  /** Omit (or null) for the tenant policy; set for a per-supplier override. */
  supplierId: uuid.nullish(),
  /** Omit when creating the policy; required when changing an existing one. */
  expectedVersion: z.number().int().nonnegative().optional(),
  reason: z.string().trim().min(1).max(500),
  quantityToleranceLitres: nullableDecimal,
  quantityTolerancePercent: nullableDecimal,
  priceTolerancePercent: nullableDecimal,
  amountTolerance: nullableDecimal,
  overReceiptToleranceLitres: nullableDecimal,
  overReceiptTolerancePercent: nullableDecimal,
  toleranceAction: z.enum(['FLAG', 'REQUIRE_APPROVAL']).nullish(),
  vatMode: z.enum(['NONE', 'EXCLUSIVE', 'INCLUSIVE']).nullish(),
  defaultVatRate: nullableDecimal,
  productVatRates: z.record(uuid, percent).optional(),
  requireInvoiceLines: z.boolean().nullish(),
});

function idempotencyKey(request: Request): string {
  return request.headers.get('idempotency-key') ?? '';
}

export async function createSupplierFromRequest(request: Request, body: unknown) {
  const input = createSupplierSchema.parse(body);
  const context = await resolveSupplierCommandContext({
    request,
    requestedTenantId: input.tenantId,
    legalEntityId: input.legalEntityId,
  });
  return executeSupplierCommand({
    context,
    commandType: input.commandType,
    permissionCode: 'supplier.manage',
    idempotencyKey: idempotencyKey(request),
    requestHash: requestHash(input),
    audit: { actionCode: 'SUPPLIER.CREATED', subjectType: 'Supplier', subjectId: input.code },
    execute: (transaction) => createSupplierInTransaction(transaction, context, input),
  });
}

export async function submitSupplierDocumentFromRequest(request: Request, body: unknown) {
  const input = submitDocumentSchema.parse(body);
  const context = await resolveSupplierCommandContext({
    request,
    requestedTenantId: input.tenantId,
    legalEntityId: input.legalEntityId,
  });
  // Tying a physical delivery to a payable is a separate permission from capturing the invoice.
  if ((input.deliveryReferences ?? []).length > 0) {
    authorizeSupplierCommand(context, 'supplier.delivery.link');
  }
  return executeSupplierCommand({
    context,
    commandType: input.commandType,
    permissionCode: 'supplier.document.create',
    idempotencyKey: idempotencyKey(request),
    requestHash: requestHash(input),
    audit: {
      actionCode: 'SUPPLIER.DOCUMENT_SUBMITTED',
      subjectType: 'SupplierDocument',
      subjectId: input.referenceNumber,
    },
    execute: (transaction) => submitSupplierDocumentInTransaction(transaction, context, input),
  });
}

export async function postSupplierDocumentFromRequest(request: Request, body: unknown) {
  const input = postDocumentSchema.parse(body);
  const context = await resolveSupplierCommandContext({
    request,
    requestedTenantId: input.tenantId,
    legalEntityId: input.legalEntityId,
  });
  return executeSupplierCommand({
    context,
    commandType: input.commandType,
    permissionCode: 'supplier.document.post',
    idempotencyKey: idempotencyKey(request),
    requestHash: requestHash(input),
    audit: {
      actionCode: 'SUPPLIER.DOCUMENT_POSTED',
      subjectType: 'SupplierDocument',
      subjectId: input.documentId,
    },
    execute: (transaction) => postSupplierDocumentInTransaction(transaction, context, input),
  });
}

export async function reverseSupplierDocumentFromRequest(request: Request, body: unknown) {
  const input = reverseDocumentSchema.parse(body);
  const context = await resolveSupplierCommandContext({
    request,
    requestedTenantId: input.tenantId,
    legalEntityId: input.legalEntityId,
  });
  return executeSupplierCommand({
    context,
    commandType: input.commandType,
    permissionCode: 'supplier.document.reverse',
    idempotencyKey: idempotencyKey(request),
    requestHash: requestHash(input),
    audit: {
      actionCode: 'SUPPLIER.DOCUMENT_REVERSED',
      subjectType: 'SupplierDocument',
      subjectId: input.documentId,
      reason: input.reason,
    },
    execute: (transaction) => reverseSupplierDocumentInTransaction(transaction, context, input),
  });
}

export async function submitSupplierPaymentFromRequest(request: Request, body: unknown) {
  const input = submitPaymentSchema.parse(body);
  const context = await resolveSupplierCommandContext({
    request,
    requestedTenantId: input.tenantId,
    legalEntityId: input.legalEntityId,
  });
  return executeSupplierCommand({
    context,
    commandType: input.commandType,
    permissionCode: 'supplier.payment.create',
    idempotencyKey: idempotencyKey(request),
    requestHash: requestHash(input),
    audit: {
      actionCode: 'SUPPLIER.PAYMENT_SUBMITTED',
      subjectType: 'SupplierPayment',
      subjectId: input.reference,
    },
    execute: (transaction) => submitSupplierPaymentInTransaction(transaction, context, input),
  });
}

export async function postSupplierPaymentFromRequest(request: Request, body: unknown) {
  const input = postPaymentSchema.parse(body);
  const context = await resolveSupplierCommandContext({
    request,
    requestedTenantId: input.tenantId,
    legalEntityId: input.legalEntityId,
  });
  return executeSupplierCommand({
    context,
    commandType: input.commandType,
    permissionCode: 'supplier.payment.post',
    idempotencyKey: idempotencyKey(request),
    requestHash: requestHash(input),
    audit: {
      actionCode: 'SUPPLIER.PAYMENT_POSTED',
      subjectType: 'SupplierPayment',
      subjectId: input.paymentId,
    },
    execute: (transaction) => postSupplierPaymentInTransaction(transaction, context, input),
  });
}

export async function allocateSupplierPaymentFromRequest(request: Request, body: unknown) {
  const input = allocatePaymentSchema.parse(body);
  const context = await resolveSupplierCommandContext({
    request,
    requestedTenantId: input.tenantId,
    legalEntityId: input.legalEntityId,
  });
  return executeSupplierCommand({
    context,
    commandType: input.commandType,
    permissionCode: 'supplier.payment.allocate',
    idempotencyKey: idempotencyKey(request),
    requestHash: requestHash(input),
    audit: {
      actionCode: 'SUPPLIER.PAYMENT_ALLOCATED',
      subjectType: 'SupplierPayment',
      subjectId: input.paymentId,
    },
    execute: (transaction) => allocateSupplierPaymentInTransaction(transaction, context, input),
  });
}

export async function reverseSupplierPaymentFromRequest(request: Request, body: unknown) {
  const input = reversePaymentSchema.parse(body);
  const context = await resolveSupplierCommandContext({
    request,
    requestedTenantId: input.tenantId,
    legalEntityId: input.legalEntityId,
  });
  return executeSupplierCommand({
    context,
    commandType: input.commandType,
    permissionCode: 'supplier.payment.reverse',
    idempotencyKey: idempotencyKey(request),
    requestHash: requestHash(input),
    audit: {
      actionCode: 'SUPPLIER.PAYMENT_REVERSED',
      subjectType: 'SupplierPayment',
      subjectId: input.paymentId,
      reason: input.reason,
    },
    execute: (transaction) => reverseSupplierPaymentInTransaction(transaction, context, input),
  });
}

export async function setPurchasingPolicyFromRequest(request: Request, body: unknown) {
  const input = setPurchasingPolicySchema.parse(body);
  const context = await resolveSupplierCommandContext({
    request,
    requestedTenantId: input.tenantId,
    legalEntityId: input.legalEntityId,
  });
  return executeSupplierCommand({
    context,
    commandType: input.commandType,
    // High-risk permission: authorize() requires a current strong-authentication step-up.
    permissionCode: 'purchasing.policy.manage',
    idempotencyKey: idempotencyKey(request),
    requestHash: requestHash(input),
    audit: {
      actionCode: 'PURCHASING.POLICY_SET',
      subjectType: 'PurchasingPolicy',
      subjectId: (result) => (result as { policyId: string }).policyId,
      reason: input.reason,
    },
    execute: (transaction) => setPurchasingPolicyInTransaction(transaction, context, input),
  });
}

export async function setSupplierCreditLimitFromRequest(request: Request, body: unknown) {
  const input = setCreditLimitSchema.parse(body);
  const context = await resolveSupplierCommandContext({
    request,
    requestedTenantId: input.tenantId,
    legalEntityId: input.legalEntityId,
  });
  return executeSupplierCommand({
    context,
    commandType: input.commandType,
    permissionCode: 'supplier.manage',
    idempotencyKey: idempotencyKey(request),
    requestHash: requestHash(input),
    audit: {
      actionCode: 'SUPPLIER.CREDIT_LIMIT_SET',
      subjectType: 'Supplier',
      subjectId: input.supplierId,
    },
    execute: (transaction) => setSupplierCreditLimitInTransaction(transaction, context, input),
  });
}

export async function updateSupplierDetailsFromRequest(request: Request, body: unknown) {
  const input = updateSupplierDetailsSchema.parse(body);
  const context = await resolveSupplierCommandContext({
    request,
    requestedTenantId: input.tenantId,
    legalEntityId: input.legalEntityId,
  });
  return executeSupplierCommand({
    context,
    commandType: input.commandType,
    permissionCode: 'supplier.manage',
    idempotencyKey: idempotencyKey(request),
    requestHash: requestHash(input),
    audit: {
      actionCode: 'SUPPLIER.DETAILS_UPDATED',
      subjectType: 'Supplier',
      subjectId: input.supplierId,
    },
    execute: (transaction) => updateSupplierDetailsInTransaction(transaction, context, input),
  });
}

export type SupplierCommandName =
  | 'UpdateSupplierDetails'
  | 'SetSupplierCreditLimit'
  | 'CreateSupplier'
  | 'SubmitSupplierDocument'
  | 'PostSupplierDocument'
  | 'ReverseSupplierDocument'
  | 'SubmitSupplierPayment'
  | 'PostSupplierPayment'
  | 'AllocateSupplierPayment'
  | 'ReverseSupplierPayment'
  | 'SetPurchasingPolicy';

export function assertSupplierCommandType(value: unknown): SupplierCommandName {
  if (
    value === 'CreateSupplier' ||
    value === 'UpdateSupplierDetails' ||
    value === 'SubmitSupplierDocument' ||
    value === 'PostSupplierDocument' ||
    value === 'ReverseSupplierDocument' ||
    value === 'SubmitSupplierPayment' ||
    value === 'PostSupplierPayment' ||
    value === 'AllocateSupplierPayment' ||
    value === 'ReverseSupplierPayment' ||
    value === 'SetPurchasingPolicy' ||
    value === 'SetSupplierCreditLimit'
  ) {
    return value;
  }
  throw new AppError('VALIDATION_FAILED', 'Unsupported supplier command type');
}
