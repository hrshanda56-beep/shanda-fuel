import 'server-only';

import { z } from 'zod';
import { AppError } from '../../platform/errors';
import { createResendEmailSender, EmailError } from '../../platform/email';
import type { AuthenticatedActorContext } from '../identity';
import { recordSalesDocumentEvent, renderSalesDocumentPdf } from './download';
import { DOC_LABELS, formatAmount, friendlyDate } from './format';

export const sendSalesDocumentSchema = z.object({
  tenantId: z.string().uuid(),
  legalEntityId: z.string().uuid(),
  documentId: z.string().uuid(),
  to: z.string().trim().email('Enter a valid email address').max(200),
  message: z.string().trim().max(1000).optional(),
});

const PLAIN = /[\r\n]+/g;

/**
 * Emails the PDF of an issued document to the address given. Needs the issue permission, refuses
 * drafts and cancelled documents, and is written to the signed audit log only after the email
 * provider has accepted it. The address itself is never written to the log.
 */
export async function sendSalesDocumentEmailFromRequest(
  request: Request,
  rawInput: unknown,
  actor?: AuthenticatedActorContext,
): Promise<{ sent: true }> {
  const input = sendSalesDocumentSchema.parse(rawInput);
  const rendered = await renderSalesDocumentPdf(
    request,
    { tenantId: input.tenantId, legalEntityId: input.legalEntityId, documentId: input.documentId },
    actor,
    'sales_document.issue',
  );
  const { doc, pdf, filename } = rendered;
  if (doc.status === 'DRAFT' || doc.status === 'VOIDED') {
    throw new AppError('CONFLICT', 'Only an issued document can be sent. Issue it first.');
  }

  const label = DOC_LABELS[doc.docType].one;
  const company = (doc.letterhead?.displayName ?? 'Our company').replace(PLAIN, ' ');
  const number = doc.docNumber ?? '';
  const lines = [
    `Hello ${doc.recipientName.replace(PLAIN, ' ')},`,
    '',
    `Please find ${label.toLowerCase()} ${number} attached.`,
    `Total: ${doc.currency} ${formatAmount(doc.total)}`,
  ];
  if (doc.docType === 'INVOICE' && doc.dueDate) lines.push(`Due: ${friendlyDate(doc.dueDate)}`);
  if (doc.docType === 'QUOTATION' && doc.validUntil) {
    lines.push(`Valid until: ${friendlyDate(doc.validUntil)}`);
  }
  if (input.message) lines.push('', input.message);
  lines.push('', 'Thank you,', company);
  if (doc.letterhead?.email) lines.push(`Reply to: ${doc.letterhead.email}`);

  try {
    await createResendEmailSender().send({
      to: input.to,
      subject: `${label} ${number} from ${company}`.trim(),
      text: lines.join('\n'),
      attachments: [{ filename, content: pdf }],
    });
  } catch (error) {
    if (error instanceof EmailError && error.code === 'configuration') {
      throw new AppError(
        'CONFLICT',
        'Email sending is not set up yet. Download the PDF and send it yourself for now.',
      );
    }
    throw new AppError('CONFLICT', 'The email could not be sent. Please try again in a moment.');
  }
  // The email has already gone. If the log write fails, say so honestly in the server log but do
  // not report a failure: a retry would send the customer the same document twice.
  try {
    await recordSalesDocumentEvent(rendered, 'SALES_DOCUMENT.EMAILED');
  } catch {
    console.error('sales-documents: email sent but the audit event could not be written', {
      documentId: doc.id,
    });
  }
  return { sent: true };
}
