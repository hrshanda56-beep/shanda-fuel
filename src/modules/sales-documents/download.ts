import 'server-only';

import { randomUUID } from 'node:crypto';
import { getAuditSigningKey } from '../../platform/config/env';
import { withTenantTransaction } from '../../platform/db/transaction';
import { authorize } from '../../platform/security/permissions';
import { appendSecurityEvent } from '../audit/contracts';
import type { AuthenticatedActorContext } from '../identity';
import { buildSalesDocumentPdf } from './pdf';
import { resolveSalesDocumentReadContext } from './read-context';
import {
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
