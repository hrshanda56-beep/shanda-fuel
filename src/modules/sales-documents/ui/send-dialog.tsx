'use client';

import { useState, type FormEvent } from 'react';
import { Button, ErrorState, Field } from '@/design-system/primitives';
import { Modal } from '@/design-system/modal';
import { DOC_LABELS, formatAmount, friendlyDate } from '../format';
import type { SalesDocumentDetail } from '../queries';
import styles from './sales-documents.module.css';

/** Sends an issued document to the customer: by email (with the PDF) or by a WhatsApp message. */
export function SendDialog({
  open,
  tenantId,
  legalEntityId,
  doc,
  pdfHref,
  onClose,
  onSent,
}: {
  open: boolean;
  tenantId: string;
  legalEntityId: string;
  doc: SalesDocumentDetail;
  pdfHref: string;
  onClose: () => void;
  onSent: (message: string) => void;
}) {
  const [to, setTo] = useState(doc.recipientEmail ?? '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = DOC_LABELS[doc.docType].one;
  const company = doc.letterhead?.displayName ?? 'us';

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/sales-documents/send', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          legalEntityId,
          documentId: doc.id,
          to,
          ...(note.trim() ? { message: note.trim() } : {}),
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          message?: string;
          error?: { message?: string };
        };
        throw new Error(body.message ?? body.error?.message ?? 'The email could not be sent.');
      }
      onSent(`${label} ${doc.docNumber ?? ''} was emailed to ${to}.`.replace('  ', ' '));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The email could not be sent.');
    } finally {
      setBusy(false);
    }
  }

  const lines = [
    `Hello ${doc.recipientName},`,
    `${label} ${doc.docNumber ?? ''} from ${company}: ${doc.currency} ${formatAmount(doc.total)}.`,
  ];
  if (doc.docType === 'INVOICE' && doc.dueDate) lines.push(`Due ${friendlyDate(doc.dueDate)}.`);
  if (note.trim()) lines.push(note.trim());
  const whatsappHref = `https://wa.me/?text=${encodeURIComponent(lines.join('\n'))}`;

  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      title={`Send this ${label.toLowerCase()}`}
      description="Email sends the PDF for you. WhatsApp opens a message you finish yourself."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Close
          </Button>
          <Button type="submit" form="sd-send-form" loading={busy}>
            Email it
          </Button>
        </>
      }
    >
      <form id="sd-send-form" onSubmit={(e) => void submit(e)} className={styles.page}>
        <Field id="sd-send-to" label="Customer's email" required>
          <input
            id="sd-send-to"
            type="email"
            value={to}
            maxLength={200}
            onChange={(e) => setTo(e.target.value)}
          />
        </Field>
        <Field id="sd-send-note" label="Add a short message" optional>
          <textarea
            id="sd-send-note"
            rows={3}
            value={note}
            maxLength={1000}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        <p className={styles.muted} style={{ margin: 0 }}>
          Prefer WhatsApp?{' '}
          <a href={whatsappHref} target="_blank" rel="noopener noreferrer">
            Open WhatsApp with this message
          </a>
          , then attach the PDF.{' '}
          <a href={pdfHref} download>
            Download the PDF
          </a>
        </p>
        {error ? <ErrorState title="Not sent" message={error} /> : null}
      </form>
    </Modal>
  );
}
