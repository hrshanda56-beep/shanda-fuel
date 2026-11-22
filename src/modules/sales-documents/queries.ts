import 'server-only';

import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { authorize, isPermissionGranted } from '../../platform/security/permissions';
import { withTenantTransaction } from '../../platform/db/transaction';
import { AppError } from '../../platform/errors';
import type { AuthenticatedActorContext } from '../identity';
import type { SalesDocumentContext } from './application';
import { resolveSalesDocumentReadContext } from './read-context';
import { SALES_DOCUMENT_TYPES } from './contracts';
import { invoiceBalance, paymentState, type PaymentState } from './domain';

const uuid = z.string().uuid();

export const salesDocumentScopeQuerySchema = z.object({
  tenantId: uuid,
  legalEntityId: uuid,
});

export const salesDocumentListQuerySchema = salesDocumentScopeQuerySchema.extend({
  docType: z.enum(SALES_DOCUMENT_TYPES).optional(),
  status: z.enum(['DRAFT', 'ISSUED', 'ACCEPTED', 'VOIDED']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const salesDocumentDetailQuerySchema = salesDocumentScopeQuerySchema.extend({
  documentId: uuid,
});

async function readContext(
  request: Request,
  input: { tenantId: string; legalEntityId: string },
  actor?: AuthenticatedActorContext,
): Promise<SalesDocumentContext> {
  const context = await resolveSalesDocumentReadContext({
    request,
    tenantId: input.tenantId,
    legalEntityId: input.legalEntityId,
    authenticatedActor: actor,
  });
  authorize({
    actor: context.authority.authorization,
    permissionCode: 'sales_document.view',
    requestedScope: context.scope,
  });
  return context;
}

export type SalesDocumentListRow = {
  id: string;
  docType: (typeof SALES_DOCUMENT_TYPES)[number];
  status: 'DRAFT' | 'ISSUED' | 'ACCEPTED' | 'VOIDED';
  docNumber: string | null;
  recipientName: string;
  issueDate: string;
  validUntil: string | null;
  dueDate: string | null;
  total: string;
  currency: string;
  version: number;
  /** Invoices only. */
  paymentState: PaymentState | null;
  balance: string | null;
  /** Quotations only: an invoice that is not cancelled was already made from it. */
  hasInvoice: boolean;
};

export async function listSalesDocumentsFromRequest(
  request: Request,
  rawInput: unknown,
  actor?: AuthenticatedActorContext,
): Promise<SalesDocumentListRow[]> {
  const input = salesDocumentListQuerySchema.parse(rawInput);
  const context = await readContext(request, input, actor);
  return withTenantTransaction(context.authority.transaction, async (transaction) => {
    const rows = await transaction.execute<{
      id: string;
      doc_type: SalesDocumentListRow['docType'];
      status: SalesDocumentListRow['status'];
      doc_number: string | null;
      recipient_name: string;
      issue_date: string;
      valid_until: string | null;
      due_date: string | null;
      total: string;
      currency: string;
      version: number;
      receipts: string[] | null;
      has_invoice: boolean;
    }>(sql`
      select d.id, d.doc_type, d.status, d.doc_number, d.recipient_name,
             (d.doc_type = 'QUOTATION' and exists (
                select 1 from app.sales_documents i
                where i.tenant_id = d.tenant_id and i.source_document_id = d.id
                  and i.doc_type = 'INVOICE' and i.status <> 'VOIDED')) as has_invoice,
             d.issue_date::text as issue_date, d.valid_until::text as valid_until,
             d.due_date::text as due_date, d.total::text as total, d.currency, d.version,
             case when d.doc_type = 'INVOICE' then
               array(select r.total::text from app.sales_documents r
                     where r.tenant_id = d.tenant_id and r.source_document_id = d.id
                       and r.doc_type = 'RECEIPT' and r.status <> 'VOIDED')
             end as receipts
      from app.sales_documents d
      where d.tenant_id = ${context.tenantId} and d.legal_entity_id = ${context.legalEntityId}
        ${input.docType ? sql`and d.doc_type = ${input.docType}` : sql``}
        ${input.status ? sql`and d.status = ${input.status}` : sql``}
      order by d.created_at desc
      limit ${input.limit}
    `);
    return rows.map((row) => {
      const isLiveInvoice = row.doc_type === 'INVOICE' && row.status === 'ISSUED';
      const receipts = row.receipts ?? [];
      return {
        id: row.id,
        docType: row.doc_type,
        status: row.status,
        docNumber: row.doc_number,
        recipientName: row.recipient_name,
        issueDate: row.issue_date,
        validUntil: row.valid_until,
        dueDate: row.due_date,
        total: row.total,
        currency: row.currency,
        version: Number(row.version),
        paymentState: isLiveInvoice ? paymentState(row.total, receipts) : null,
        balance: isLiveInvoice ? invoiceBalance(row.total, receipts) : null,
        hasInvoice: row.has_invoice === true,
      };
    });
  });
}

export type SalesDocumentDetail = Omit<SalesDocumentListRow, 'hasInvoice'> & {
  revision: number;
  recipientAddress: string | null;
  recipientTaxNumber: string | null;
  recipientEmail: string | null;
  customerId: string | null;
  taxLabel: string;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  notes: string | null;
  terms: string | null;
  letterhead: Record<string, string | null> | null;
  sourceDocumentId: string | null;
  sourceDocNumber: string | null;
  paymentMethod: string | null;
  paymentReference: string | null;
  paidOn: string | null;
  voidReason: string | null;
  lines: {
    lineNo: number;
    productId: string | null;
    description: string;
    quantity: string;
    unitLabel: string | null;
    unitPrice: string;
    discountAmount: string;
    taxRate: string;
    netAmount: string;
    taxAmount: string;
    lineTotal: string;
  }[];
  /** Receipts made for this invoice, newest first (not voided). */
  receipts: { id: string; docNumber: string | null; paidOn: string | null; total: string }[];
};

/** Reads one document with its live lines. Also used by the PDF download. */
export async function getSalesDocumentFromRequest(
  request: Request,
  rawInput: unknown,
  actor?: AuthenticatedActorContext,
): Promise<SalesDocumentDetail> {
  const input = salesDocumentDetailQuerySchema.parse(rawInput);
  const context = await readContext(request, input, actor);
  return withTenantTransaction(context.authority.transaction, async (transaction) => {
    const docs = await transaction.execute<{
      id: string;
      doc_type: SalesDocumentDetail['docType'];
      status: SalesDocumentDetail['status'];
      revision: number;
      version: number;
      doc_number: string | null;
      recipient_name: string;
      recipient_address: string | null;
      recipient_tax_number: string | null;
      recipient_email: string | null;
      customer_id: string | null;
      issue_date: string;
      valid_until: string | null;
      due_date: string | null;
      currency: string;
      tax_label: string;
      subtotal: string;
      discount_total: string;
      tax_total: string;
      total: string;
      notes: string | null;
      terms: string | null;
      letterhead: Record<string, string | null> | null;
      source_document_id: string | null;
      source_doc_number: string | null;
      payment_method: string | null;
      payment_reference: string | null;
      paid_on: string | null;
      void_reason: string | null;
    }>(sql`
      select d.id, d.doc_type, d.status, d.revision, d.version, d.doc_number, d.recipient_name,
             d.recipient_address, d.recipient_tax_number, d.recipient_email, d.customer_id,
             d.issue_date::text as issue_date, d.valid_until::text as valid_until,
             d.due_date::text as due_date, d.currency, d.tax_label, d.subtotal::text as subtotal,
             d.discount_total::text as discount_total, d.tax_total::text as tax_total,
             d.total::text as total, d.notes, d.terms, d.letterhead, d.source_document_id,
             s.doc_number as source_doc_number, d.payment_method, d.payment_reference,
             d.paid_on::text as paid_on, d.void_reason
      from app.sales_documents d
      left join app.sales_documents s
        on s.tenant_id = d.tenant_id and s.id = d.source_document_id
      where d.tenant_id = ${context.tenantId} and d.legal_entity_id = ${context.legalEntityId}
        and d.id = ${input.documentId}
    `);
    const doc = docs[0];
    if (!doc) throw new AppError('NOT_FOUND', 'The document was not found');
    const lines = await transaction.execute<{
      line_no: number;
      product_id: string | null;
      description: string;
      quantity: string;
      unit_label: string | null;
      unit_price: string;
      discount_amount: string;
      tax_rate: string;
      net_amount: string;
      tax_amount: string;
      line_total: string;
    }>(sql`
      select line_no, product_id, description, quantity::text as quantity, unit_label,
             unit_price::text as unit_price, discount_amount::text as discount_amount,
             tax_rate::text as tax_rate, net_amount::text as net_amount,
             tax_amount::text as tax_amount, line_total::text as line_total
      from app.sales_document_lines
      where tenant_id = ${context.tenantId} and document_id = ${doc.id} and revision = ${doc.revision}
      order by line_no
    `);
    const receipts =
      doc.doc_type === 'INVOICE'
        ? await transaction.execute<{
            id: string;
            doc_number: string | null;
            paid_on: string | null;
            total: string;
          }>(sql`
            select id, doc_number, paid_on::text as paid_on, total::text as total
            from app.sales_documents
            where tenant_id = ${context.tenantId} and source_document_id = ${doc.id}
              and doc_type = 'RECEIPT' and status <> 'VOIDED'
            order by created_at desc
          `)
        : [];
    const live = doc.doc_type === 'INVOICE' && doc.status === 'ISSUED';
    const receiptTotals = receipts.map((row) => row.total);
    return {
      id: doc.id,
      docType: doc.doc_type,
      status: doc.status,
      docNumber: doc.doc_number,
      recipientName: doc.recipient_name,
      issueDate: doc.issue_date,
      validUntil: doc.valid_until,
      dueDate: doc.due_date,
      total: doc.total,
      currency: doc.currency,
      version: Number(doc.version),
      paymentState: live ? paymentState(doc.total, receiptTotals) : null,
      balance: live ? invoiceBalance(doc.total, receiptTotals) : null,
      revision: Number(doc.revision),
      recipientAddress: doc.recipient_address,
      recipientTaxNumber: doc.recipient_tax_number,
      recipientEmail: doc.recipient_email,
      customerId: doc.customer_id,
      taxLabel: doc.tax_label,
      subtotal: doc.subtotal,
      discountTotal: doc.discount_total,
      taxTotal: doc.tax_total,
      notes: doc.notes,
      terms: doc.terms,
      letterhead: doc.letterhead,
      sourceDocumentId: doc.source_document_id,
      sourceDocNumber: doc.source_doc_number,
      paymentMethod: doc.payment_method,
      paymentReference: doc.payment_reference,
      paidOn: doc.paid_on,
      voidReason: doc.void_reason,
      lines: lines.map((line) => ({
        lineNo: Number(line.line_no),
        productId: line.product_id,
        description: line.description,
        quantity: line.quantity,
        unitLabel: line.unit_label,
        unitPrice: line.unit_price,
        discountAmount: line.discount_amount,
        taxRate: line.tax_rate,
        netAmount: line.net_amount,
        taxAmount: line.tax_amount,
        lineTotal: line.line_total,
      })),
      receipts: receipts.map((row) => ({
        id: row.id,
        docNumber: row.doc_number,
        paidOn: row.paid_on,
        total: row.total,
      })),
    };
  });
}

export type SalesDocumentProfileView = {
  profileId: string;
  version: number;
  displayName: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  taxLabel: string;
  taxNumber: string | null;
  defaultTaxRate: string;
  bankDetails: string | null;
  defaultTerms: string | null;
  footer: string | null;
  logoJpegBase64: string | null;
  appLogoPngBase64: string | null;
  brandColour: string | null;
  quotationPrefix: string;
  invoicePrefix: string;
  receiptPrefix: string;
  defaultValidDays: number;
  defaultDueDays: number;
};

/** `null` until the company has set up its letterhead; the screen then asks for it first. */
export async function getSalesDocumentProfileFromRequest(
  request: Request,
  rawInput: unknown,
  actor?: AuthenticatedActorContext,
): Promise<SalesDocumentProfileView | null> {
  const input = salesDocumentScopeQuerySchema.parse(rawInput);
  const context = await readContext(request, input, actor);
  return withTenantTransaction(context.authority.transaction, async (transaction) => {
    const rows = await transaction.execute<{
      id: string;
      version: number;
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
      logo_jpeg_base64: string | null;
      app_logo_png_base64: string | null;
      brand_colour: string | null;
      quotation_prefix: string;
      invoice_prefix: string;
      receipt_prefix: string;
      default_valid_days: number;
      default_due_days: number;
    }>(sql`
      select id, version, display_name, address, phone, email, tax_label, tax_number,
             default_tax_rate::text as default_tax_rate, bank_details, default_terms, footer,
             logo_jpeg_base64, app_logo_png_base64, brand_colour, quotation_prefix, invoice_prefix, receipt_prefix, default_valid_days, default_due_days
      from app.sales_doc_profiles
      where tenant_id = ${context.tenantId} and legal_entity_id = ${context.legalEntityId}
    `);
    const row = rows[0];
    if (!row) return null;
    return {
      profileId: row.id,
      version: Number(row.version),
      displayName: row.display_name,
      address: row.address,
      phone: row.phone,
      email: row.email,
      taxLabel: row.tax_label,
      taxNumber: row.tax_number,
      defaultTaxRate: row.default_tax_rate,
      bankDetails: row.bank_details,
      defaultTerms: row.default_terms,
      footer: row.footer,
      logoJpegBase64: row.logo_jpeg_base64,
      appLogoPngBase64: row.app_logo_png_base64,
      brandColour: row.brand_colour,
      quotationPrefix: row.quotation_prefix,
      invoicePrefix: row.invoice_prefix,
      receiptPrefix: row.receipt_prefix,
      defaultValidDays: Number(row.default_valid_days),
      defaultDueDays: Number(row.default_due_days),
    };
  });
}

export type SalesDocumentFuelOption = {
  productId: string;
  name: string;
  unit: 'LITRES' | 'KILOGRAMS';
  /** Today's active selling price at each of this company's stations, as a starting point only. */
  prices: { stationId: string; stationName: string; unitPrice: string }[];
};

/**
 * Fuels the company sells, with their current station prices as a default the person can change.
 * This is a read-only suggestion; the pricing module owns prices (the same table the setup and
 * forecourt reads use), and nothing here writes to it.
 */
export async function getSalesDocumentFuelOptionsFromRequest(
  request: Request,
  rawInput: unknown,
  actor?: AuthenticatedActorContext,
): Promise<SalesDocumentFuelOption[]> {
  const input = salesDocumentScopeQuerySchema.parse(rawInput);
  const context = await readContext(request, input, actor);
  return withTenantTransaction(context.authority.transaction, async (transaction) => {
    const rows = await transaction.execute<{
      product_id: string;
      name: string;
      unit: 'LITRES' | 'KILOGRAMS';
      station_id: string | null;
      station_name: string | null;
      unit_price: string | null;
    }>(sql`
      select p.id as product_id, p.name, p.unit, st.id as station_id, st.name as station_name,
             sp.unit_price::text as unit_price
      from app.products p
      left join app.stations st
        on st.tenant_id = p.tenant_id and st.legal_entity_id = ${context.legalEntityId}
           and st.status <> 'ARCHIVED'
      left join app.selling_prices sp
        on sp.tenant_id = p.tenant_id and sp.station_id = st.id and sp.product_id = p.id
           and sp.state = 'ACTIVE'
      where p.tenant_id = ${context.tenantId} and p.status = 'ACTIVE'
      order by p.name, st.name
    `);
    const byProduct = new Map<string, SalesDocumentFuelOption>();
    for (const row of rows) {
      let option = byProduct.get(row.product_id);
      if (!option) {
        option = { productId: row.product_id, name: row.name, unit: row.unit, prices: [] };
        byProduct.set(row.product_id, option);
      }
      if (row.station_id && row.station_name && row.unit_price) {
        option.prices.push({
          stationId: row.station_id,
          stationName: row.station_name,
          unitPrice: row.unit_price,
        });
      }
    }
    return [...byProduct.values()];
  });
}

/** Saved customers of this company, by name only, for the "choose a customer" picker. */
export async function getSalesDocumentCustomersFromRequest(
  request: Request,
  rawInput: unknown,
  actor?: AuthenticatedActorContext,
): Promise<{ customerId: string; name: string }[]> {
  const input = salesDocumentScopeQuerySchema.parse(rawInput);
  const context = await readContext(request, input, actor);
  return withTenantTransaction(context.authority.transaction, async (transaction) => {
    const rows = await transaction.execute<{ id: string; display_name: string }>(sql`
      select id, display_name from app.customers
      where tenant_id = ${context.tenantId} and legal_entity_id = ${context.legalEntityId}
        and status = 'ACTIVE'
      order by display_name
      limit 500
    `);
    return rows.map((row) => ({ customerId: row.id, name: row.display_name }));
  });
}

export type SalesDocumentCapabilities = {
  create: boolean;
  issue: boolean;
  void: boolean;
  manageProfile: boolean;
};

export async function getSalesDocumentCapabilitiesFromRequest(
  request: Request,
  rawInput: unknown,
  actor?: AuthenticatedActorContext,
): Promise<SalesDocumentCapabilities> {
  const input = salesDocumentScopeQuerySchema.parse(rawInput);
  const context = await readContext(request, input, actor);
  const may = (permissionCode: Parameters<typeof isPermissionGranted>[0]['permissionCode']) =>
    isPermissionGranted({
      actor: context.authority.authorization,
      permissionCode,
      requestedScope: context.scope,
    });
  return {
    create: may('sales_document.create'),
    issue: may('sales_document.issue'),
    void: may('sales_document.void'),
    manageProfile: may('sales_document.profile.manage'),
  };
}
