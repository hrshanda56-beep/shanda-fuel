import type { StatusTone } from '@/design-system/primitives';

type Statusish = {
  docType: 'QUOTATION' | 'INVOICE' | 'RECEIPT';
  status: 'DRAFT' | 'ISSUED' | 'ACCEPTED' | 'VOIDED';
  paymentState: 'UNPAID' | 'PART_PAID' | 'PAID' | 'OVERPAID' | null;
  dueDate?: string | null;
};

/** An issued invoice that still has a balance and is past its due date. Dates compare as text. */
export function isOverdue(doc: Statusish, today: string | null | undefined): boolean {
  return (
    doc.docType === 'INVOICE' &&
    doc.status === 'ISSUED' &&
    (doc.paymentState === 'UNPAID' || doc.paymentState === 'PART_PAID') &&
    Boolean(doc.dueDate) &&
    Boolean(today) &&
    (doc.dueDate as string) < (today as string)
  );
}

/** One plain-language status per document, in the same words everywhere. */
export function statusView(
  doc: Statusish,
  today?: string | null,
): { text: string; tone: StatusTone } {
  if (doc.status === 'VOIDED') return { text: 'Cancelled', tone: 'critical' };
  if (doc.status === 'DRAFT') return { text: 'Draft', tone: 'pending' };
  if (doc.docType === 'INVOICE') {
    if (isOverdue(doc, today)) return { text: 'Overdue', tone: 'critical' };
    if (doc.paymentState === 'PAID') return { text: 'Paid', tone: 'positive' };
    if (doc.paymentState === 'PART_PAID') return { text: 'Part paid', tone: 'warning' };
    if (doc.paymentState === 'OVERPAID') return { text: 'Overpaid', tone: 'warning' };
    return { text: 'Unpaid', tone: 'informational' };
  }
  if (doc.docType === 'QUOTATION') {
    return doc.status === 'ACCEPTED'
      ? { text: 'Accepted', tone: 'positive' }
      : { text: 'Issued', tone: 'informational' };
  }
  return { text: 'Issued', tone: 'positive' };
}
