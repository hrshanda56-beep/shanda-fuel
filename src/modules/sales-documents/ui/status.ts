import type { StatusTone } from '@/design-system/primitives';

type Statusish = {
  docType: 'QUOTATION' | 'INVOICE' | 'RECEIPT';
  status: 'DRAFT' | 'ISSUED' | 'ACCEPTED' | 'VOIDED';
  paymentState: 'UNPAID' | 'PART_PAID' | 'PAID' | 'OVERPAID' | null;
};

/** One plain-language status per document, in the same words everywhere. */
export function statusView(doc: Statusish): { text: string; tone: StatusTone } {
  if (doc.status === 'VOIDED') return { text: 'Cancelled', tone: 'critical' };
  if (doc.status === 'DRAFT') return { text: 'Draft', tone: 'pending' };
  if (doc.docType === 'INVOICE') {
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
