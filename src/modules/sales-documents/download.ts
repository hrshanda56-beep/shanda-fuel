import 'server-only';

import { randomUUID } from 'node:crypto';
import { getAuditSigningKey } from '../../platform/config/env';
import { withTenantTransaction } from '../../platform/db/transaction';
import { authorize } from '../../platform/security/permissions';
import { appendSecurityEvent } from '../audit/contracts';
import type { AuthenticatedActorContext } from '../identity';
import { buildSalesDocumentPdf } from './pdf';
import { resolveSalesDocumentReadContext } from './read-context';
import { getSalesDocumentFromRequest, salesDocumentDetailQuerySchema } from './queries';

/**
 * The PDF of one document, built from the stored snapshot. Same authorisation as viewing; the
 * download is written to the signed audit log, and if that cannot be written nothing is handed
 * over. Drafts can be downloaded as a preview (they are watermarked "DRAFT").
 */
export async function downloadSalesDocumentPdfFromRequest(
  request: Request,
  rawInput: unknown,
  actor?: AuthenticatedActorContext,
): Promise<{ filename: string; pdf: Buffer }> {
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
    permissionCode: 'sales_document.view',
    requestedScope: context.scope,
  });
  const pdf = buildSalesDocumentPdf(doc);
  await withTenantTransaction(context.authority.transaction, async (transaction) => {
    await appendSecurityEvent(
      {
        eventId: randomUUID(),
        tenantId: context.tenantId,
        membershipId: context.authority.membership.membershipId,
        actorId: context.authority.actor.identityId,
        actorType: 'HUMAN',
        actionCode: 'SALES_DOCUMENT.PDF_DOWNLOADED',
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
  const base = doc.docNumber ?? `${doc.docType.toLowerCase()}-draft`;
  return { filename: `${base.replace(/[^A-Za-z0-9._-]/g, '_')}.pdf`, pdf };
}
