import { z } from 'zod';
import type { PermissionCode } from '../../platform/security/permissions';

export const SALES_DOCUMENT_PERMISSION_CODES = [
  'sales_document.view',
  'sales_document.create',
  'sales_document.issue',
  'sales_document.void',
  'sales_document.profile.manage',
] as const satisfies readonly PermissionCode[];

const uuid = z.string().uuid();
/** Exact decimal strings only: JSON numbers are rejected so no value passes through a float. */
const decimal = (decimals: number) =>
  z
    .string()
    .min(1)
    .max(30)
    .regex(
      new RegExp(`^\\d+(?:\\.\\d{1,${decimals}})?$`),
      `An exact decimal string with at most ${decimals} decimals is required`,
    );
const money = decimal(4);
const percent = decimal(4).refine((value) => Number(value) <= 100, 'A percent from 0 to 100');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'A YYYY-MM-DD date is required');
const version = z.number().int().nonnegative();
const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) =>
  text(max)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional();
const prefix = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9-]{1,10}$/, '1 to 10 letters, numbers or dashes');

export const SALES_DOCUMENT_TYPES = ['QUOTATION', 'INVOICE', 'RECEIPT'] as const;
export type SalesDocumentTypeCode = (typeof SALES_DOCUMENT_TYPES)[number];
export const SALES_DOCUMENT_STATUSES = ['DRAFT', 'ISSUED', 'ACCEPTED', 'VOIDED'] as const;
export type SalesDocumentStatus = (typeof SALES_DOCUMENT_STATUSES)[number];

export const MAX_DOCUMENT_LINES = 60;

export const lineInputSchema = z.object({
  /** A fuel from the system, when the line is one. Its name is copied into the description. */
  productId: uuid.nullable().optional(),
  description: text(300).min(1),
  quantity: decimal(3).refine((value) => Number(value) > 0, 'Quantity must be more than zero'),
  unitLabel: optionalText(20),
  unitPrice: decimal(6),
  discountAmount: money.default('0'),
  taxRate: percent.default('0'),
});
export type SalesDocumentLineInput = z.infer<typeof lineInputSchema>;

export const saveSalesDocProfileSchema = z.object({
  commandType: z.literal('SaveSalesDocProfile'),
  tenantId: uuid,
  legalEntityId: uuid,
  expectedVersion: version.optional(),
  displayName: text(200).min(1),
  address: optionalText(500),
  phone: optionalText(60),
  email: optionalText(200),
  taxLabel: text(30).min(1).default('VAT'),
  taxNumber: optionalText(60),
  defaultTaxRate: percent.default('0'),
  bankDetails: optionalText(1000),
  defaultTerms: optionalText(2000),
  footer: optionalText(500),
  quotationPrefix: prefix.default('QT'),
  invoicePrefix: prefix.default('INV'),
  receiptPrefix: prefix.default('RC'),
  defaultValidDays: z.number().int().min(0).max(365).default(30),
  defaultDueDays: z.number().int().min(0).max(365).default(30),
});

export const saveSalesDocumentDraftSchema = z.object({
  commandType: z.literal('SaveSalesDocumentDraft'),
  tenantId: uuid,
  legalEntityId: uuid,
  /** Omit to start a new draft. */
  documentId: uuid.optional(),
  expectedVersion: version.optional(),
  /** Quotations and invoices only: receipts are made from an invoice by RecordSalesReceipt. */
  docType: z.enum(['QUOTATION', 'INVOICE']),
  customerId: uuid.nullable().optional(),
  recipientName: text(200).min(1),
  recipientAddress: optionalText(500),
  recipientTaxNumber: optionalText(60),
  recipientEmail: optionalText(200),
  issueDate: date,
  validUntil: date.nullable().optional(),
  dueDate: date.nullable().optional(),
  taxLabel: text(30).min(1).default('VAT'),
  notes: optionalText(2000),
  terms: optionalText(2000),
  lines: z.array(lineInputSchema).min(1).max(MAX_DOCUMENT_LINES),
});

export const issueSalesDocumentSchema = z.object({
  commandType: z.literal('IssueSalesDocument'),
  tenantId: uuid,
  legalEntityId: uuid,
  documentId: uuid,
  expectedVersion: version,
});

export const voidSalesDocumentSchema = z.object({
  commandType: z.literal('VoidSalesDocument'),
  tenantId: uuid,
  legalEntityId: uuid,
  documentId: uuid,
  expectedVersion: version,
  reason: text(500).min(1),
});

export const acceptQuotationSchema = z.object({
  commandType: z.literal('AcceptQuotation'),
  tenantId: uuid,
  legalEntityId: uuid,
  documentId: uuid,
  expectedVersion: version,
});

/** Starts an invoice draft that copies an issued or accepted quotation's recipient and lines. */
export const convertQuotationToInvoiceSchema = z.object({
  commandType: z.literal('ConvertQuotationToInvoice'),
  tenantId: uuid,
  legalEntityId: uuid,
  quotationId: uuid,
  issueDate: date,
});

/** A receipt is issued straight away against an issued invoice; it is never a draft. */
export const recordSalesReceiptSchema = z.object({
  commandType: z.literal('RecordSalesReceipt'),
  tenantId: uuid,
  legalEntityId: uuid,
  invoiceId: uuid,
  amount: money.refine((value) => Number(value) > 0, 'The amount must be more than zero'),
  paymentMethod: text(60).min(1),
  paymentReference: optionalText(120),
  paidOn: date,
});

export const SALES_DOCUMENT_COMMAND_SCHEMAS = {
  SaveSalesDocProfile: saveSalesDocProfileSchema,
  SaveSalesDocumentDraft: saveSalesDocumentDraftSchema,
  IssueSalesDocument: issueSalesDocumentSchema,
  VoidSalesDocument: voidSalesDocumentSchema,
  AcceptQuotation: acceptQuotationSchema,
  ConvertQuotationToInvoice: convertQuotationToInvoiceSchema,
  RecordSalesReceipt: recordSalesReceiptSchema,
} as const;

export type SalesDocumentCommandType = keyof typeof SALES_DOCUMENT_COMMAND_SCHEMAS;
export type SalesDocumentCommandInput<T extends SalesDocumentCommandType> = z.infer<
  (typeof SALES_DOCUMENT_COMMAND_SCHEMAS)[T]
>;

export const SALES_DOCUMENT_COMMAND_TYPES = Object.keys(
  SALES_DOCUMENT_COMMAND_SCHEMAS,
) as SalesDocumentCommandType[];

export const SALES_DOCUMENT_COMMAND_POLICY: Record<
  SalesDocumentCommandType,
  { permissionCode: PermissionCode; auditActionCode: string }
> = {
  SaveSalesDocProfile: {
    permissionCode: 'sales_document.profile.manage',
    auditActionCode: 'SALES_DOCUMENT.PROFILE_SAVED',
  },
  SaveSalesDocumentDraft: {
    permissionCode: 'sales_document.create',
    auditActionCode: 'SALES_DOCUMENT.DRAFT_SAVED',
  },
  IssueSalesDocument: {
    permissionCode: 'sales_document.issue',
    auditActionCode: 'SALES_DOCUMENT.ISSUED',
  },
  // Voiding is also in the platform high-risk list, so it needs a fresh identity check.
  VoidSalesDocument: {
    permissionCode: 'sales_document.void',
    auditActionCode: 'SALES_DOCUMENT.VOIDED',
  },
  AcceptQuotation: {
    permissionCode: 'sales_document.issue',
    auditActionCode: 'SALES_DOCUMENT.QUOTATION_ACCEPTED',
  },
  ConvertQuotationToInvoice: {
    permissionCode: 'sales_document.create',
    auditActionCode: 'SALES_DOCUMENT.CONVERTED_TO_INVOICE',
  },
  RecordSalesReceipt: {
    permissionCode: 'sales_document.issue',
    auditActionCode: 'SALES_DOCUMENT.RECEIPT_ISSUED',
  },
};
