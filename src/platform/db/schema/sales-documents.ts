import { sql } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { appSchema } from './namespaces';
import { customers } from './a8';
import { legalEntities, memberships } from './a1';
import { products } from './a3';

const id = () =>
  uuid('id')
    .default(sql`gen_random_uuid()`)
    .primaryKey();
const tenantId = () => uuid('tenant_id').notNull();
const utcTimestamp = (name: string) => timestamp(name, { withTimezone: true });
const money = (name: string) => numeric(name, { precision: 20, scale: 4 });
const percent = (name: string) => numeric(name, { precision: 9, scale: 4 });

/** One letterhead and numbering setup per company (DEC-045). */
export const salesDocProfiles = appSchema.table(
  'sales_doc_profiles',
  {
    id: id(),
    tenantId: tenantId(),
    legalEntityId: uuid('legal_entity_id').notNull(),
    displayName: text('display_name').notNull(),
    address: text('address'),
    phone: text('phone'),
    email: text('email'),
    taxLabel: text('tax_label').notNull().default('VAT'),
    taxNumber: text('tax_number'),
    tin: text('tin'),
    registrationNumber: text('registration_number'),
    defaultTaxRate: percent('default_tax_rate').notNull().default('0'),
    bankDetails: text('bank_details'),
    defaultTerms: text('default_terms'),
    footer: text('footer'),
    logoJpegBase64: text('logo_jpeg_base64'),
    appLogoPngBase64: text('app_logo_png_base64'),
    brandColour: text('brand_colour'),
    quotationPrefix: text('quotation_prefix').notNull().default('QT'),
    invoicePrefix: text('invoice_prefix').notNull().default('INV'),
    receiptPrefix: text('receipt_prefix').notNull().default('RC'),
    defaultValidDays: integer('default_valid_days').notNull().default(30),
    defaultDueDays: integer('default_due_days').notNull().default(30),
    version: integer('version').notNull().default(0),
    updatedBy: uuid('updated_by').notNull(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('sales_doc_profiles_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('sales_doc_profiles_entity_uidx').on(table.tenantId, table.legalEntityId),
    foreignKey({
      columns: [table.tenantId, table.legalEntityId],
      foreignColumns: [legalEntities.tenantId, legalEntities.id],
      name: 'sales_doc_profiles_entity_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.updatedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'sales_doc_profiles_updated_by_fk',
    }),
  ],
);

/** Gap-free numbering: one row per company, document type and year. */
export const salesDocCounters = appSchema.table(
  'sales_doc_counters',
  {
    tenantId: tenantId(),
    legalEntityId: uuid('legal_entity_id').notNull(),
    docType: text('doc_type').notNull(),
    docYear: integer('doc_year').notNull(),
    lastNumber: integer('last_number').notNull().default(0),
  },
  (table) => [
    primaryKey({
      columns: [table.tenantId, table.legalEntityId, table.docType, table.docYear],
      name: 'sales_doc_counters_pk',
    }),
    foreignKey({
      columns: [table.tenantId, table.legalEntityId],
      foreignColumns: [legalEntities.tenantId, legalEntities.id],
      name: 'sales_doc_counters_entity_fk',
    }),
    check('sales_doc_counters_type_ck', sql`${table.docType} in ('QUOTATION','INVOICE','RECEIPT')`),
  ],
);

export const salesDocuments = appSchema.table(
  'sales_documents',
  {
    id: id(),
    tenantId: tenantId(),
    legalEntityId: uuid('legal_entity_id').notNull(),
    docType: text('doc_type').notNull(),
    status: text('status').notNull().default('DRAFT'),
    revision: integer('revision').notNull().default(1),
    docYear: integer('doc_year'),
    docSeq: integer('doc_seq'),
    docNumber: text('doc_number'),
    customerId: uuid('customer_id'),
    recipientName: text('recipient_name').notNull(),
    recipientAddress: text('recipient_address'),
    recipientTaxNumber: text('recipient_tax_number'),
    recipientEmail: text('recipient_email'),
    issueDate: date('issue_date').notNull(),
    validUntil: date('valid_until'),
    dueDate: date('due_date'),
    currency: text('currency').notNull().default('USD'),
    taxLabel: text('tax_label').notNull().default('VAT'),
    subtotal: money('subtotal').notNull().default('0'),
    discountTotal: money('discount_total').notNull().default('0'),
    taxTotal: money('tax_total').notNull().default('0'),
    total: money('total').notNull().default('0'),
    notes: text('notes'),
    terms: text('terms'),
    /** Company details as they were when the document was issued. */
    letterhead: jsonb('letterhead'),
    sourceDocumentId: uuid('source_document_id'),
    paymentMethod: text('payment_method'),
    paymentReference: text('payment_reference'),
    paidOn: date('paid_on'),
    issuedAt: utcTimestamp('issued_at'),
    issuedBy: uuid('issued_by'),
    acceptedAt: utcTimestamp('accepted_at'),
    voidedAt: utcTimestamp('voided_at'),
    voidedBy: uuid('voided_by'),
    voidReason: text('void_reason'),
    version: integer('version').notNull().default(0),
    createdBy: uuid('created_by').notNull(),
    updatedBy: uuid('updated_by').notNull(),
    createdAt: utcTimestamp('created_at').notNull().defaultNow(),
    updatedAt: utcTimestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    unique('sales_documents_tenant_id_id_uidx').on(table.tenantId, table.id),
    uniqueIndex('sales_documents_number_uidx')
      .on(table.tenantId, table.legalEntityId, table.docType, table.docNumber)
      .where(sql`${table.docNumber} is not null`),
    index('sales_documents_list_idx').on(
      table.tenantId,
      table.legalEntityId,
      table.docType,
      table.createdAt.desc(),
    ),
    index('sales_documents_source_idx')
      .on(table.tenantId, table.sourceDocumentId)
      .where(sql`${table.sourceDocumentId} is not null`),
    foreignKey({
      columns: [table.tenantId, table.legalEntityId],
      foreignColumns: [legalEntities.tenantId, legalEntities.id],
      name: 'sales_documents_entity_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.customerId],
      foreignColumns: [customers.tenantId, customers.id],
      name: 'sales_documents_customer_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.sourceDocumentId],
      foreignColumns: [table.tenantId, table.id],
      name: 'sales_documents_source_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.createdBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'sales_documents_created_by_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.updatedBy],
      foreignColumns: [memberships.tenantId, memberships.id],
      name: 'sales_documents_updated_by_fk',
    }),
    check('sales_documents_type_ck', sql`${table.docType} in ('QUOTATION','INVOICE','RECEIPT')`),
    check(
      'sales_documents_status_ck',
      sql`${table.status} in ('DRAFT','ISSUED','ACCEPTED','VOIDED')`,
    ),
  ],
);

/** Append-only. A draft edit writes a new revision; the document's `revision` says which is live. */
export const salesDocumentLines = appSchema.table(
  'sales_document_lines',
  {
    id: id(),
    tenantId: tenantId(),
    documentId: uuid('document_id').notNull(),
    revision: integer('revision').notNull(),
    lineNo: integer('line_no').notNull(),
    productId: uuid('product_id'),
    description: text('description').notNull(),
    quantity: numeric('quantity', { precision: 18, scale: 3 }).notNull(),
    unitLabel: text('unit_label'),
    unitPrice: numeric('unit_price', { precision: 20, scale: 6 }).notNull(),
    discountAmount: money('discount_amount').notNull().default('0'),
    taxRate: percent('tax_rate').notNull().default('0'),
    netAmount: money('net_amount').notNull(),
    taxAmount: money('tax_amount').notNull(),
    lineTotal: money('line_total').notNull(),
  },
  (table) => [
    unique('sales_document_lines_tenant_id_id_uidx').on(table.tenantId, table.id),
    unique('sales_document_lines_position_uidx').on(
      table.tenantId,
      table.documentId,
      table.revision,
      table.lineNo,
    ),
    foreignKey({
      columns: [table.tenantId, table.documentId],
      foreignColumns: [salesDocuments.tenantId, salesDocuments.id],
      name: 'sales_document_lines_document_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.productId],
      foreignColumns: [products.tenantId, products.id],
      name: 'sales_document_lines_product_fk',
    }),
  ],
);
