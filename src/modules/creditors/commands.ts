import 'server-only';

import { z } from 'zod';
import { AppError } from '../../platform/errors';
import { executeSupplierCommand, requestHash, resolveSupplierCommandContext } from './application';
import {
  allocateSupplierPaymentInTransaction,
  createSupplierInTransaction,
  postSupplierDocumentInTransaction,
  postSupplierPaymentInTransaction,
  reverseSupplierDocumentInTransaction,
  reverseSupplierPaymentInTransaction,
  submitSupplierDocumentInTransaction,
  submitSupplierPaymentInTransaction,
} from './persistence';

const uuid = z.string().uuid();
const decimal = z
  .string()
  .min(1)
  .regex(/^\d+(?:\.\d+)?$/, 'An exact decimal string is required');
const base = z.object({ tenantId: uuid, legalEntityId: uuid });

const createSupplierSchema = base.extend({
  commandType: z.literal('CreateSupplier'),
  code: z.string().trim().min(1).max(80),
  legalName: z.string().trim().min(1).max(240),
  registrationReference: z.string().trim().max(120).optional(),
});

const submitDocumentSchema = base.extend({
  commandType: z.literal('SubmitSupplierDocument'),
  supplierId: uuid,
  documentType: z.enum(['INVOICE', 'CREDIT_NOTE']),
  referenceNumber: z.string().trim().min(1).max(120),
  documentDate: z.string(),
  dueDate: z.string().optional(),
  amount: decimal,
  deliveryReferences: z
    .array(z.object({ stationId: uuid, deliveryId: uuid, allocationId: uuid.optional() }))
    .max(100)
    .optional(),
});

const postDocumentSchema = base.extend({
  commandType: z.literal('PostSupplierDocument'),
  documentId: uuid,
  expectedVersion: z.number().int().nonnegative(),
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

export type SupplierCommandName =
  | 'CreateSupplier'
  | 'SubmitSupplierDocument'
  | 'PostSupplierDocument'
  | 'ReverseSupplierDocument'
  | 'SubmitSupplierPayment'
  | 'PostSupplierPayment'
  | 'AllocateSupplierPayment'
  | 'ReverseSupplierPayment';

export function assertSupplierCommandType(value: unknown): SupplierCommandName {
  if (
    value === 'CreateSupplier' ||
    value === 'SubmitSupplierDocument' ||
    value === 'PostSupplierDocument' ||
    value === 'ReverseSupplierDocument' ||
    value === 'SubmitSupplierPayment' ||
    value === 'PostSupplierPayment' ||
    value === 'AllocateSupplierPayment' ||
    value === 'ReverseSupplierPayment'
  ) {
    return value;
  }
  throw new AppError('VALIDATION_FAILED', 'Unsupported supplier command type');
}
