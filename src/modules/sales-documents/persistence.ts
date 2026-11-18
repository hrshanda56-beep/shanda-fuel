import 'server-only';

import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { AppError } from '../../platform/errors';
import { ExactDecimal } from '../../platform/domain/primitives';
import type { SalesDocumentContext, SalesDocumentTransaction } from './application';
import { formatAmount } from './format';
import type { SalesDocumentCommandInput, SalesDocumentLineInput } from './contracts';
import {
  computeDocumentTotals,
  formatDocumentNumber,
  invoiceBalance,
  type SalesDocumentType,
} from './domain';

type Tx = SalesDocumentTransaction;
type Ctx = SalesDocumentContext;

function actorId(context: Ctx): string {
  return context.authority.membership.membershipId;
}

function assertVersion(actual: number | string, expected: number | undefined, label: string): void {
  if (expected === undefined || Number(actual) !== expected) {
    throw new AppError('CONFLICT', `${label} changed since it was opened; reload and try again`);
  }
}

type ProfileRow = {
  id: string;
  display_name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  tax_label: string;
  tax_number: string | null;
  default_tax_rate: string;
  bank_details: string | null;
  default_terms: string | null;
  footer: string | null;
  quotation_prefix: string;
  invoice_prefix: string;
  receipt_prefix: string;
  default_valid_days: number;
  default_due_days: number;
  version: number;
};

async function loadProfile(tx: Tx, ctx: Ctx): Promise<ProfileRow | undefined> {
  const rows = await tx.execute<ProfileRow>(sql`
    select id, display_name, address, phone, email, tax_label, tax_number, default_tax_rate,
           bank_details, default_terms, footer, quotation_prefix, invoice_prefix, receipt_prefix,
           default_valid_days, default_due_days, version
    from app.sales_doc_profiles
    where tenant_id = ${ctx.tenantId} and legal_entity_id = ${ctx.legalEntityId}
  `);
  return rows[0];
}

async function requireProfile(tx: Tx, ctx: Ctx): Promise<ProfileRow> {
  const profile = await loadProfile(tx, ctx);
  if (!profile) {
    throw new AppError(
      'INVARIANT_VIOLATION',
      'Set up the company details for documents first (Settings > Company documents)',
    );
  }
  return profile;
}

/** What is copied onto an issued document so later edits to the company never change it. */
function letterheadSnapshot(profile: ProfileRow) {
  return {
    displayName: profile.display_name,
    address: profile.address,
    phone: profile.phone,
    email: profile.email,
    taxLabel: profile.tax_label,
    taxNumber: profile.tax_number,
    bankDetails: profile.bank_details,
    footer: profile.footer,
  };
}

export async function saveSalesDocProfileInTransaction(
  tx: Tx,
  ctx: Ctx,
  input: SalesDocumentCommandInput<'SaveSalesDocProfile'>,
) {
  const existing = await loadProfile(tx, ctx);
  const values = {
    address: input.address ?? null,
    phone: input.phone ?? null,
    email: input.email ?? null,
    taxNumber: input.taxNumber ?? null,
    bankDetails: input.bankDetails ?? null,
    defaultTerms: input.defaultTerms ?? null,
    footer: input.footer ?? null,
  };
  if (!existing) {
    const profileId = randomUUID();
    await tx.execute(sql`
      insert into app.sales_doc_profiles (
        id, tenant_id, legal_entity_id, display_name, address, phone, email, tax_label, tax_number,
        default_tax_rate, bank_details, default_terms, footer, quotation_prefix, invoice_prefix,
        receipt_prefix, default_valid_days, default_due_days, version, updated_by
      ) values (
        ${profileId}, ${ctx.tenantId}, ${ctx.legalEntityId}, ${input.displayName}, ${values.address},
        ${values.phone}, ${values.email}, ${input.taxLabel}, ${values.taxNumber},
        ${input.defaultTaxRate}, ${values.bankDetails}, ${values.defaultTerms}, ${values.footer},
        ${input.quotationPrefix}, ${input.invoicePrefix}, ${input.receiptPrefix},
        ${input.defaultValidDays}, ${input.defaultDueDays}, 0, ${actorId(ctx)}
      )
    `);
    return { profileId, version: 0 };
  }
  assertVersion(existing.version, input.expectedVersion, 'The company details');
  await tx.execute(sql`
    update app.sales_doc_profiles set
      display_name = ${input.displayName}, address = ${values.address}, phone = ${values.phone},
      email = ${values.email}, tax_label = ${input.taxLabel}, tax_number = ${values.taxNumber},
      default_tax_rate = ${input.defaultTaxRate}, bank_details = ${values.bankDetails},
      default_terms = ${values.defaultTerms}, footer = ${values.footer},
      quotation_prefix = ${input.quotationPrefix}, invoice_prefix = ${input.invoicePrefix},
      receipt_prefix = ${input.receiptPrefix}, default_valid_days = ${input.defaultValidDays},
      default_due_days = ${input.defaultDueDays}, version = version + 1,
      updated_by = ${actorId(ctx)}, updated_at = now()
    where tenant_id = ${ctx.tenantId} and id = ${existing.id}
  `);
  return { profileId: existing.id, version: existing.version + 1 };
}

type DocumentRow = {
  id: string;
  doc_type: SalesDocumentType;
  status: 'DRAFT' | 'ISSUED' | 'ACCEPTED' | 'VOIDED';
  revision: number;
  version: number;
  doc_number: string | null;
  issue_date: string;
  total: string;
  recipient_name: string;
  recipient_address: string | null;
  recipient_tax_number: string | null;
  recipient_email: string | null;
  customer_id: string | null;
  tax_label: string;
  notes: string | null;
  terms: string | null;
  source_document_id: string | null;
};

async function lockDocument(tx: Tx, ctx: Ctx, documentId: string): Promise<DocumentRow> {
  const rows = await tx.execute<DocumentRow>(sql`
    select id, doc_type, status, revision, version, doc_number, issue_date::text as issue_date,
           total::text as total, recipient_name, recipient_address, recipient_tax_number,
           recipient_email, customer_id, tax_label, notes, terms, source_document_id
    from app.sales_documents
    where tenant_id = ${ctx.tenantId} and legal_entity_id = ${ctx.legalEntityId} and id = ${documentId}
    for update
  `);
  const row = rows[0];
  if (!row) throw new AppError('NOT_FOUND', 'The document was not found');
  return row;
}

async function insertLines(
  tx: Tx,
  ctx: Ctx,
  documentId: string,
  revision: number,
  lines: readonly SalesDocumentLineInput[],
) {
  const totals = computeDocumentTotals(
    lines.map((line) => ({
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discountAmount: line.discountAmount ?? '0',
      taxRate: line.taxRate ?? '0',
    })),
  );
  for (const [index, line] of lines.entries()) {
    const computed = totals.lines[index]!;
    await tx.execute(sql`
      insert into app.sales_document_lines (
        tenant_id, document_id, revision, line_no, product_id, description, quantity, unit_label,
        unit_price, discount_amount, tax_rate, net_amount, tax_amount, line_total
      ) values (
        ${ctx.tenantId}, ${documentId}, ${revision}, ${index + 1}, ${line.productId ?? null},
        ${line.description}, ${line.quantity}, ${line.unitLabel ?? null}, ${line.unitPrice},
        ${line.discountAmount ?? '0'}, ${line.taxRate ?? '0'}, ${computed.netAmount},
        ${computed.taxAmount}, ${computed.lineTotal}
      )
    `);
  }
  return totals;
}

export async function saveSalesDocumentDraftInTransaction(
  tx: Tx,
  ctx: Ctx,
  input: SalesDocumentCommandInput<'SaveSalesDocumentDraft'>,
) {
  if (input.validUntil && input.validUntil < input.issueDate) {
    throw new AppError('VALIDATION_FAILED', 'The valid-until date is before the document date');
  }
  if (input.dueDate && input.dueDate < input.issueDate) {
    throw new AppError('VALIDATION_FAILED', 'The due date is before the document date');
  }
  const totals = computeDocumentTotals(
    input.lines.map((line) => ({
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discountAmount: line.discountAmount ?? '0',
      taxRate: line.taxRate ?? '0',
    })),
  );
  if (!input.documentId) {
    const documentId = randomUUID();
    await tx.execute(sql`
      insert into app.sales_documents (
        id, tenant_id, legal_entity_id, doc_type, status, revision, customer_id, recipient_name,
        recipient_address, recipient_tax_number, recipient_email, issue_date, valid_until, due_date,
        tax_label, subtotal, discount_total, tax_total, total, notes, terms, version,
        created_by, updated_by
      ) values (
        ${documentId}, ${ctx.tenantId}, ${ctx.legalEntityId}, ${input.docType}, 'DRAFT', 1,
        ${input.customerId ?? null}, ${input.recipientName}, ${input.recipientAddress ?? null},
        ${input.recipientTaxNumber ?? null}, ${input.recipientEmail ?? null}, ${input.issueDate},
        ${input.docType === 'QUOTATION' ? (input.validUntil ?? null) : null},
        ${input.docType === 'INVOICE' ? (input.dueDate ?? null) : null},
        ${input.taxLabel}, ${totals.subtotal}, ${totals.discountTotal}, ${totals.taxTotal},
        ${totals.total}, ${input.notes ?? null}, ${input.terms ?? null}, 0,
        ${actorId(ctx)}, ${actorId(ctx)}
      )
    `);
    await insertLines(tx, ctx, documentId, 1, input.lines);
    return { documentId, status: 'DRAFT' as const, version: 0, total: totals.total };
  }
  const current = await lockDocument(tx, ctx, input.documentId);
  if (current.status !== 'DRAFT') {
    throw new AppError(
      'INVARIANT_VIOLATION',
      'Only a draft can be edited; void it and start again',
    );
  }
  if (current.doc_type !== input.docType) {
    throw new AppError('INVARIANT_VIOLATION', 'A draft cannot change its type');
  }
  assertVersion(current.version, input.expectedVersion, 'The draft');
  const revision = current.revision + 1;
  await tx.execute(sql`
    update app.sales_documents set
      revision = ${revision}, customer_id = ${input.customerId ?? null},
      recipient_name = ${input.recipientName}, recipient_address = ${input.recipientAddress ?? null},
      recipient_tax_number = ${input.recipientTaxNumber ?? null},
      recipient_email = ${input.recipientEmail ?? null}, issue_date = ${input.issueDate},
      valid_until = ${input.docType === 'QUOTATION' ? (input.validUntil ?? null) : null},
      due_date = ${input.docType === 'INVOICE' ? (input.dueDate ?? null) : null},
      tax_label = ${input.taxLabel}, subtotal = ${totals.subtotal},
      discount_total = ${totals.discountTotal}, tax_total = ${totals.taxTotal},
      total = ${totals.total}, notes = ${input.notes ?? null}, terms = ${input.terms ?? null},
      version = version + 1, updated_by = ${actorId(ctx)}, updated_at = now()
    where tenant_id = ${ctx.tenantId} and id = ${current.id}
  `);
  await insertLines(tx, ctx, current.id, revision, input.lines);
  return {
    documentId: current.id,
    status: 'DRAFT' as const,
    version: current.version + 1,
    total: totals.total,
  };
}

/** Gap-free: the counter row is locked by the update, so two issues can never share a number. */
async function takeNumber(
  tx: Tx,
  ctx: Ctx,
  profile: ProfileRow,
  docType: SalesDocumentType,
  year: number,
) {
  const rows = await tx.execute<{ last_number: number }>(sql`
    insert into app.sales_doc_counters (tenant_id, legal_entity_id, doc_type, doc_year, last_number)
    values (${ctx.tenantId}, ${ctx.legalEntityId}, ${docType}, ${year}, 1)
    on conflict (tenant_id, legal_entity_id, doc_type, doc_year)
    do update set last_number = app.sales_doc_counters.last_number + 1
    returning last_number
  `);
  const sequence = Number(rows[0]!.last_number);
  const prefix =
    docType === 'QUOTATION'
      ? profile.quotation_prefix
      : docType === 'INVOICE'
        ? profile.invoice_prefix
        : profile.receipt_prefix;
  return { sequence, number: formatDocumentNumber(prefix, year, sequence) };
}

export async function issueSalesDocumentInTransaction(
  tx: Tx,
  ctx: Ctx,
  input: SalesDocumentCommandInput<'IssueSalesDocument'>,
) {
  const current = await lockDocument(tx, ctx, input.documentId);
  if (current.status !== 'DRAFT') {
    throw new AppError('INVARIANT_VIOLATION', 'This document has already been issued');
  }
  if (current.doc_type === 'RECEIPT') {
    throw new AppError('INVARIANT_VIOLATION', 'Receipts are issued when the payment is recorded');
  }
  assertVersion(current.version, input.expectedVersion, 'The draft');
  const profile = await requireProfile(tx, ctx);
  const year = Number(current.issue_date.slice(0, 4));
  const { sequence, number } = await takeNumber(tx, ctx, profile, current.doc_type, year);
  await tx.execute(sql`
    update app.sales_documents set
      status = 'ISSUED', doc_year = ${year}, doc_seq = ${sequence}, doc_number = ${number},
      letterhead = ${JSON.stringify(letterheadSnapshot(profile))}::jsonb,
      issued_at = now(), issued_by = ${actorId(ctx)}, version = version + 1,
      updated_by = ${actorId(ctx)}, updated_at = now()
    where tenant_id = ${ctx.tenantId} and id = ${current.id}
  `);
  return {
    documentId: current.id,
    status: 'ISSUED' as const,
    docNumber: number,
    version: current.version + 1,
  };
}

export async function acceptQuotationInTransaction(
  tx: Tx,
  ctx: Ctx,
  input: SalesDocumentCommandInput<'AcceptQuotation'>,
) {
  const current = await lockDocument(tx, ctx, input.documentId);
  if (current.doc_type !== 'QUOTATION' || current.status !== 'ISSUED') {
    throw new AppError('INVARIANT_VIOLATION', 'Only an issued quotation can be marked accepted');
  }
  assertVersion(current.version, input.expectedVersion, 'The quotation');
  await tx.execute(sql`
    update app.sales_documents set status = 'ACCEPTED', accepted_at = now(),
      version = version + 1, updated_by = ${actorId(ctx)}, updated_at = now()
    where tenant_id = ${ctx.tenantId} and id = ${current.id}
  `);
  return {
    documentId: current.id,
    status: 'ACCEPTED' as const,
    docNumber: current.doc_number,
    version: current.version + 1,
  };
}

export async function voidSalesDocumentInTransaction(
  tx: Tx,
  ctx: Ctx,
  input: SalesDocumentCommandInput<'VoidSalesDocument'>,
) {
  const current = await lockDocument(tx, ctx, input.documentId);
  if (current.status !== 'ISSUED' && current.status !== 'ACCEPTED') {
    throw new AppError(
      'INVARIANT_VIOLATION',
      current.status === 'DRAFT'
        ? 'A draft was never issued, so there is nothing to void'
        : 'This document is already void',
    );
  }
  assertVersion(current.version, input.expectedVersion, 'The document');
  if (current.doc_type === 'INVOICE') {
    const live = await tx.execute<{ n: string }>(sql`
      select count(*)::text as n from app.sales_documents
      where tenant_id = ${ctx.tenantId} and source_document_id = ${current.id}
        and doc_type = 'RECEIPT' and status <> 'VOIDED'
    `);
    if (Number(live[0]?.n ?? 0) > 0) {
      throw new AppError('INVARIANT_VIOLATION', 'Void the receipts for this invoice first');
    }
  }
  await tx.execute(sql`
    update app.sales_documents set status = 'VOIDED', voided_at = now(),
      voided_by = ${actorId(ctx)}, void_reason = ${input.reason}, version = version + 1,
      updated_by = ${actorId(ctx)}, updated_at = now()
    where tenant_id = ${ctx.tenantId} and id = ${current.id}
  `);
  return {
    documentId: current.id,
    status: 'VOIDED' as const,
    docNumber: current.doc_number,
    version: current.version + 1,
  };
}

export async function convertQuotationToInvoiceInTransaction(
  tx: Tx,
  ctx: Ctx,
  input: SalesDocumentCommandInput<'ConvertQuotationToInvoice'>,
) {
  const quotation = await lockDocument(tx, ctx, input.quotationId);
  if (
    quotation.doc_type !== 'QUOTATION' ||
    (quotation.status !== 'ISSUED' && quotation.status !== 'ACCEPTED')
  ) {
    throw new AppError('INVARIANT_VIOLATION', 'Only an issued quotation can become an invoice');
  }
  const already = await tx.execute<{ doc_number: string | null }>(sql`
    select doc_number from app.sales_documents
    where tenant_id = ${ctx.tenantId} and source_document_id = ${quotation.id}
      and doc_type = 'INVOICE' and status <> 'VOIDED'
    limit 1
  `);
  if (already[0]) {
    throw new AppError(
      'CONFLICT',
      `An invoice already exists for this quotation${already[0].doc_number ? ` (${already[0].doc_number})` : ''}`,
    );
  }
  const profile = await requireProfile(tx, ctx);
  const lines = await tx.execute<{
    product_id: string | null;
    description: string;
    quantity: string;
    unit_label: string | null;
    unit_price: string;
    discount_amount: string;
    tax_rate: string;
  }>(sql`
    select product_id, description, quantity::text as quantity, unit_label,
           unit_price::text as unit_price, discount_amount::text as discount_amount,
           tax_rate::text as tax_rate
    from app.sales_document_lines
    where tenant_id = ${ctx.tenantId} and document_id = ${quotation.id}
      and revision = ${quotation.revision}
    order by line_no
  `);
  if (lines.length === 0) throw new AppError('INVARIANT_VIOLATION', 'The quotation has no lines');
  const lineInputs: SalesDocumentLineInput[] = lines.map((line) => ({
    productId: line.product_id,
    description: line.description,
    quantity: line.quantity,
    unitLabel: line.unit_label,
    unitPrice: line.unit_price,
    discountAmount: line.discount_amount,
    taxRate: line.tax_rate,
  }));
  const totals = computeDocumentTotals(
    lineInputs.map((line) => ({
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discountAmount: line.discountAmount ?? '0',
      taxRate: line.taxRate ?? '0',
    })),
  );
  const invoiceId = randomUUID();
  await tx.execute(sql`
    insert into app.sales_documents (
      id, tenant_id, legal_entity_id, doc_type, status, revision, customer_id, recipient_name,
      recipient_address, recipient_tax_number, recipient_email, issue_date, due_date, tax_label,
      subtotal, discount_total, tax_total, total, notes, terms, source_document_id, version,
      created_by, updated_by
    ) values (
      ${invoiceId}, ${ctx.tenantId}, ${ctx.legalEntityId}, 'INVOICE', 'DRAFT', 1,
      ${quotation.customer_id}, ${quotation.recipient_name}, ${quotation.recipient_address},
      ${quotation.recipient_tax_number}, ${quotation.recipient_email}, ${input.issueDate},
      (${input.issueDate}::date + ${profile.default_due_days}::int), ${quotation.tax_label},
      ${totals.subtotal}, ${totals.discountTotal}, ${totals.taxTotal}, ${totals.total},
      ${quotation.notes}, ${quotation.terms}, ${quotation.id}, 0, ${actorId(ctx)}, ${actorId(ctx)}
    )
  `);
  await insertLines(tx, ctx, invoiceId, 1, lineInputs);
  return {
    documentId: invoiceId,
    status: 'DRAFT' as const,
    version: 0,
    sourceDocumentId: quotation.id,
    total: totals.total,
  };
}

export async function recordSalesReceiptInTransaction(
  tx: Tx,
  ctx: Ctx,
  input: SalesDocumentCommandInput<'RecordSalesReceipt'>,
) {
  const invoice = await lockDocument(tx, ctx, input.invoiceId);
  if (invoice.doc_type !== 'INVOICE' || invoice.status !== 'ISSUED') {
    throw new AppError('INVARIANT_VIOLATION', 'A receipt can only be made for an issued invoice');
  }
  const paid = await tx.execute<{ total: string }>(sql`
    select total::text as total from app.sales_documents
    where tenant_id = ${ctx.tenantId} and source_document_id = ${invoice.id}
      and doc_type = 'RECEIPT' and status <> 'VOIDED'
  `);
  const balance = invoiceBalance(
    invoice.total,
    paid.map((row) => row.total),
  );
  if (new ExactDecimal(input.amount).value.gt(new ExactDecimal(balance).value)) {
    throw new AppError(
      'INVARIANT_VIOLATION',
      `That is more than what is still owed on this invoice (${formatAmount(balance, 2)} left).`,
    );
  }
  const profile = await requireProfile(tx, ctx);
  const year = Number(input.paidOn.slice(0, 4));
  const { sequence, number } = await takeNumber(tx, ctx, profile, 'RECEIPT', year);
  const receiptId = randomUUID();
  const description = `Payment received for invoice ${invoice.doc_number ?? ''}`.trim();
  await tx.execute(sql`
    insert into app.sales_documents (
      id, tenant_id, legal_entity_id, doc_type, status, revision, doc_year, doc_seq, doc_number,
      customer_id, recipient_name, recipient_address, recipient_tax_number, recipient_email,
      issue_date, tax_label, subtotal, discount_total, tax_total, total, letterhead,
      source_document_id, payment_method, payment_reference, paid_on, issued_at, issued_by,
      version, created_by, updated_by
    ) values (
      ${receiptId}, ${ctx.tenantId}, ${ctx.legalEntityId}, 'RECEIPT', 'ISSUED', 1, ${year},
      ${sequence}, ${number}, ${invoice.customer_id}, ${invoice.recipient_name},
      ${invoice.recipient_address}, ${invoice.recipient_tax_number}, ${invoice.recipient_email},
      ${input.paidOn}, ${invoice.tax_label}, ${input.amount}, 0, 0, ${input.amount},
      ${JSON.stringify(letterheadSnapshot(profile))}::jsonb, ${invoice.id}, ${input.paymentMethod},
      ${input.paymentReference ?? null}, ${input.paidOn}, now(), ${actorId(ctx)}, 0,
      ${actorId(ctx)}, ${actorId(ctx)}
    )
  `);
  await tx.execute(sql`
    insert into app.sales_document_lines (
      tenant_id, document_id, revision, line_no, description, quantity, unit_price,
      discount_amount, tax_rate, net_amount, tax_amount, line_total
    ) values (
      ${ctx.tenantId}, ${receiptId}, 1, 1, ${description}, 1, ${input.amount}, 0, 0,
      ${input.amount}, 0, ${input.amount}
    )
  `);
  return {
    documentId: receiptId,
    status: 'ISSUED' as const,
    docNumber: number,
    invoiceId: invoice.id,
    invoiceBalanceAfter: invoiceBalance(invoice.total, [
      ...paid.map((row) => row.total),
      input.amount,
    ]),
    version: 0,
  };
}
