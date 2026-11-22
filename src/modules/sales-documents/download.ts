import 'server-only';

import { randomUUID } from 'node:crypto';
import { getAuditSigningKey } from '../../platform/config/env';
import { withTenantTransaction } from '../../platform/db/transaction';
import { authorize } from '../../platform/security/permissions';
import { appendSecurityEvent } from '../audit/contracts';
import type { AuthenticatedActorContext } from '../identity';
import { AppError } from '../../platform/errors';
import { saveSalesDocumentDraftSchema } from './contracts';
import { computeDocumentTotals } from './domain';
import { buildSalesDocumentPdf } from './pdf';
import { resolveSalesDocumentReadContext } from './read-context';
import {
  type SalesDocumentDetail,
  getSalesDocumentFromRequest,
  getSalesDocumentProfileFromRequest,
  salesDocumentDetailQuerySchema,
} from './queries';

/**
 * The PDF of one document, built from the stored snapshot. Same authorisation as viewing (sending
 * asks for the issue permission); what is then done with it is written to the signed audit log,
 * and if that cannot be written nothing is handed over. Drafts can be downloaded as a preview
 * (they are watermarked "DRAFT").
 */
export async function renderSalesDocumentPdf(
  request: Request,
  rawInput: unknown,
  actor: AuthenticatedActorContext | undefined,
  permissionCode: 'sales_document.view' | 'sales_document.issue',
) {
  const input = salesDocumentDetailQuerySchema.parse(rawInput);
  const doc = await getSalesDocumentFromRequest(request, input, actor);
  const context = await resolveSalesDocumentReadContext({
    request,
    tenantId: input.tenantId,
    legalEntityId: input.legalEntityId,
    authenticatedActor: actor,
  });
  authorize({
    actor: context.authority.authorization,
    permissionCode,
    requestedScope: context.scope,
  });
  // A draft has no letterhead copy yet, so the preview uses the company details as they are now.
  let printable = doc;
  if (!doc.letterhead) {
    const profile = await getSalesDocumentProfileFromRequest(
      request,
      { tenantId: input.tenantId, legalEntityId: input.legalEntityId },
      actor,
    );
    if (profile) {
      printable = {
        ...doc,
        letterhead: {
          displayName: profile.displayName,
          address: profile.address,
          phone: profile.phone,
          email: profile.email,
          taxLabel: profile.taxLabel,
          taxNumber: profile.taxNumber,
          bankDetails: profile.bankDetails,
          footer: profile.footer,
          logoJpegBase64: profile.logoJpegBase64,
          brandColour: profile.brandColour,
        },
      };
    }
  }
  const pdf = buildSalesDocumentPdf(printable);
  const base = doc.docNumber ?? `${doc.docType.toLowerCase()}-draft`;
  return { doc, context, pdf, filename: `${base.replace(/[^A-Za-z0-9._-]/g, '_')}.pdf` };
}

/**
 * The PDF of a document that has not been saved yet, drawn by the same code as a saved one so the
 * preview cannot differ from the printout. Nothing is stored and no number is used. Needs the same
 * permission as saving a draft. The letterhead always comes from the stored company details, never
 * from the browser.
 */
export async function previewSalesDocumentPdfFromRequest(
  request: Request,
  rawInput: unknown,
  actor?: AuthenticatedActorContext,
): Promise<{ filename: string; pdf: Buffer }> {
  const input = saveSalesDocumentDraftSchema.parse({
    ...(rawInput as Record<string, unknown>),
    commandType: 'SaveSalesDocumentDraft',
  });
  const context = await resolveSalesDocumentReadContext({
    request,
    tenantId: input.tenantId,
    legalEntityId: input.legalEntityId,
    authenticatedActor: actor,
  });
  authorize({
    actor: context.authority.authorization,
    permissionCode: 'sales_document.create',
    requestedScope: context.scope,
  });
  const profile = await getSalesDocumentProfileFromRequest(
    request,
    { tenantId: input.tenantId, legalEntityId: input.legalEntityId },
    actor,
  );
  if (!profile) throw new AppError('VALIDATION_FAILED', 'Set up the company details first');
  const totals = computeDocumentTotals(input.lines);
  const doc: SalesDocumentDetail = {
    id: 'preview',
    docType: input.docType,
    status: 'DRAFT',
    docNumber: null,
    recipientName: input.recipientName,
    issueDate: input.issueDate,
    validUntil: input.validUntil ?? null,
    dueDate: input.dueDate ?? null,
    total: totals.total,
    currency: 'USD',
    version: 1,
    paymentState: null,
    balance: null,
    revision: 1,
    recipientAddress: input.recipientAddress ?? null,
    recipientTaxNumber: input.recipientTaxNumber ?? null,
    recipientEmail: input.recipientEmail ?? null,
    customerId: input.customerId ?? null,
    taxLabel: input.taxLabel,
    subtotal: totals.subtotal,
    discountTotal: totals.discountTotal,
    taxTotal: totals.taxTotal,
    notes: input.notes ?? null,
    terms: input.terms ?? null,
    letterhead: {
      displayName: profile.displayName,
      address: profile.address,
      phone: profile.phone,
      email: profile.email,
      taxLabel: profile.taxLabel,
      taxNumber: profile.taxNumber,
      bankDetails: profile.bankDetails,
      footer: profile.footer,
      logoJpegBase64: profile.logoJpegBase64,
      brandColour: profile.brandColour,
    },
    sourceDocumentId: null,
    sourceDocNumber: null,
    paymentMethod: null,
    paymentReference: null,
    paidOn: null,
    voidReason: null,
    lines: input.lines.map((line, index) => ({
      lineNo: index + 1,
      productId: line.productId ?? null,
      description: line.description,
      quantity: line.quantity,
      unitLabel: line.unitLabel ?? null,
      unitPrice: line.unitPrice,
      discountAmount: line.discountAmount,
      taxRate: line.taxRate,
      netAmount: totals.lines[index]!.netAmount,
      taxAmount: totals.lines[index]!.taxAmount,
      lineTotal: totals.lines[index]!.lineTotal,
    })),
    receipts: [],
  };
  return { filename: 'preview.pdf', pdf: buildSalesDocumentPdf(doc) };
}

export type RenderedSalesDocument = Awaited<ReturnType<typeof renderSalesDocumentPdf>>;

/** Writes one signed audit event about a document. Metadata holds no personal contact details. */
export async function recordSalesDocumentEvent(
  rendered: RenderedSalesDocument,
  actionCode: 'SALES_DOCUMENT.PDF_DOWNLOADED' | 'SALES_DOCUMENT.EMAILED',
): Promise<void> {
  const { doc, context } = rendered;
  await withTenantTransaction(context.authority.transaction, async (transaction) => {
    await appendSecurityEvent(
      {
        eventId: randomUUID(),
        tenantId: context.tenantId,
        membershipId: context.authority.membership.membershipId,
        actorId: context.authority.actor.identityId,
        actorType: 'HUMAN',
        actionCode,
        subjectType: 'SALES_DOCUMENT',
        subjectId: doc.id,
        requestId: context.requestId,
        occurredAt: new Date().toISOString(),
        metadata: {
          legalEntityId: context.legalEntityId,
          docType: doc.docType,
          docNumber: doc.docNumber,
          status: doc.status,
        },
      },
      getAuditSigningKey(),
      transaction,
    );
  });
}

export async function downloadSalesDocumentPdfFromRequest(
  request: Request,
  rawInput: unknown,
  actor?: AuthenticatedActorContext,
): Promise<{ filename: string; pdf: Buffer }> {
  const rendered = await renderSalesDocumentPdf(request, rawInput, actor, 'sales_document.view');
  await recordSalesDocumentEvent(rendered, 'SALES_DOCUMENT.PDF_DOWNLOADED');
  return { filename: rendered.filename, pdf: rendered.pdf };
}
