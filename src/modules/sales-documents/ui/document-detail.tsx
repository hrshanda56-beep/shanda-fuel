'use client';

import { useState, type FormEvent } from 'react';
import {
  Button,
  Card,
  ErrorState,
  Field,
  NumericInput,
  StatusBadge,
} from '@/design-system/primitives';
import { Modal } from '@/design-system/modal';
import { todayInBusinessTime } from '@/modules/expenses/ui/expense-format';
import { DOC_LABELS, formatAmount, friendlyDate } from '../format';
import type { SalesDocumentCapabilities, SalesDocumentDetail } from '../queries';
import styles from './sales-documents.module.css';
import { statusView } from './status';
import { useSalesCommand } from './use-sales-command';

type Dialog = 'receipt' | 'void' | null;

export function DocumentDetail({
  tenantId,
  legalEntityId,
  doc,
  capabilities,
  onChanged,
  onOpen,
  onEdit,
}: {
  tenantId: string;
  legalEntityId: string;
  doc: SalesDocumentDetail;
  capabilities: SalesDocumentCapabilities;
  /** Called after a change so the page can reload. */
  onChanged: (message: string, documentId?: string) => void;
  onOpen: (documentId: string) => void;
  onEdit: () => void;
}) {
  const command = useSalesCommand(tenantId);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [amount, setAmount] = useState(doc.balance ?? '');
  const [method, setMethod] = useState('Cash');
  const [reference, setReference] = useState('');
  const [paidOn, setPaidOn] = useState(todayInBusinessTime());
  const [reason, setReason] = useState('');

  const label = DOC_LABELS[doc.docType].one;
  const view = statusView(doc);
  const scope = { tenantId, legalEntityId };
  const pdfHref = `/api/sales-documents/pdf?${new URLSearchParams({
    ...scope,
    documentId: doc.id,
  }).toString()}`;

  const isDraft = doc.status === 'DRAFT';
  const isLive = doc.status === 'ISSUED' || doc.status === 'ACCEPTED';

  function run(
    body: Record<string, unknown>,
    message: string,
    nextId?: (r: Record<string, unknown>) => string | undefined,
  ) {
    void command.send({ ...scope, ...body }, (result) => {
      setDialog(null);
      onChanged(message, nextId?.(result));
    });
  }

  function submitReceipt(event: FormEvent) {
    event.preventDefault();
    run(
      {
        commandType: 'RecordSalesReceipt',
        invoiceId: doc.id,
        amount,
        paymentMethod: method,
        paymentReference: reference,
        paidOn,
      },
      'Payment recorded and a receipt was made.',
      (result) => String(result.documentId),
    );
  }

  function submitVoid(event: FormEvent) {
    event.preventDefault();
    run(
      {
        commandType: 'VoidSalesDocument',
        documentId: doc.id,
        expectedVersion: doc.version,
        reason,
      },
      `${label} cancelled. The number is kept so there is no gap.`,
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <div>
          <h2 style={{ margin: 0 }}>
            {doc.docNumber ?? `${label} (draft)`}{' '}
            <StatusBadge tone={view.tone}>{view.text}</StatusBadge>
          </h2>
          <p className={styles.muted} style={{ margin: 0 }}>
            {doc.recipientName} · {friendlyDate(doc.issueDate)}
          </p>
        </div>
        <div className={styles.actions}>
          <a className="button button-secondary" href={pdfHref} download>
            Download PDF
          </a>
          {isDraft && capabilities.create ? (
            <Button variant="secondary" onClick={onEdit}>
              Edit
            </Button>
          ) : null}
          {isDraft && capabilities.issue ? (
            <Button
              loading={command.busy}
              onClick={() =>
                run(
                  {
                    commandType: 'IssueSalesDocument',
                    documentId: doc.id,
                    expectedVersion: doc.version,
                  },
                  `${label} issued. It now has its number and can no longer be changed.`,
                )
              }
            >
              Issue {label.toLowerCase()}
            </Button>
          ) : null}
          {doc.docType === 'QUOTATION' && doc.status === 'ISSUED' && capabilities.issue ? (
            <Button
              variant="secondary"
              loading={command.busy}
              onClick={() =>
                run(
                  {
                    commandType: 'AcceptQuotation',
                    documentId: doc.id,
                    expectedVersion: doc.version,
                  },
                  'Marked as accepted by the customer.',
                )
              }
            >
              Mark accepted
            </Button>
          ) : null}
          {doc.docType === 'QUOTATION' && isLive && capabilities.create ? (
            <Button
              variant="secondary"
              loading={command.busy}
              onClick={() =>
                run(
                  {
                    commandType: 'ConvertQuotationToInvoice',
                    quotationId: doc.id,
                    issueDate: todayInBusinessTime(),
                  },
                  'An invoice draft was made from this quotation. Check it, then issue it.',
                  (result) => String(result.documentId),
                )
              }
            >
              Make an invoice
            </Button>
          ) : null}
          {doc.docType === 'INVOICE' && doc.status === 'ISSUED' && capabilities.issue ? (
            <Button onClick={() => setDialog('receipt')}>Record a payment</Button>
          ) : null}
          {isLive && capabilities.void ? (
            <Button variant="danger" onClick={() => setDialog('void')}>
              Cancel {label.toLowerCase()}
            </Button>
          ) : null}
        </div>
      </div>

      {command.error ? (
        <ErrorState title="That did not go through" message={command.error} />
      ) : null}

      {doc.status === 'VOIDED' ? (
        <div className={styles.notice} role="status">
          Cancelled{doc.voidReason ? `: ${doc.voidReason}` : '.'}
        </div>
      ) : null}
      {isDraft ? (
        <div className={styles.notice} role="status">
          This is a draft. It has no number yet, and nothing is final until you issue it.
        </div>
      ) : null}

      {doc.docType === 'INVOICE' && doc.status === 'ISSUED' ? (
        <Card className={styles.card}>
          <div className={styles.totalRow}>
            <span>Paid so far</span>
            <strong>
              {doc.currency} {formatAmount(subtract(doc.total, doc.balance ?? doc.total))}
            </strong>
          </div>
          <div className={styles.totalRow}>
            <span>Still owed</span>
            <strong>
              {doc.currency} {formatAmount(doc.balance ?? doc.total)}
            </strong>
          </div>
        </Card>
      ) : null}

      <Card className={styles.card}>
        <h3 className={styles.sectionTitle}>Items</h3>
        {doc.docType === 'RECEIPT' ? (
          <p>
            Payment of {doc.currency} {formatAmount(doc.total)}
            {doc.paymentMethod ? ` by ${doc.paymentMethod}` : ''}
            {doc.paymentReference ? ` (ref ${doc.paymentReference})` : ''}
            {doc.paidOn ? ` on ${friendlyDate(doc.paidOn)}` : ''}.
            {doc.sourceDocumentId ? (
              <>
                {' '}
                For{' '}
                <Button variant="quiet" size="sm" onClick={() => onOpen(doc.sourceDocumentId!)}>
                  invoice {doc.sourceDocNumber}
                </Button>
              </>
            ) : null}
          </p>
        ) : (
          <>
            <div className={styles.detailTable}>
              {doc.lines.map((line) => (
                <div key={line.lineNo} className={styles.detailLine}>
                  <div>
                    <div>{line.description}</div>
                    <div className={`${styles.muted} ${styles.rowMeta}`}>
                      {formatAmount(line.quantity, 3, 0)}
                      {line.unitLabel ? ` ${line.unitLabel}` : ''} ×{' '}
                      {formatAmount(line.unitPrice, 4, 2)}
                    </div>
                  </div>
                  <strong>{formatAmount(line.netAmount)}</strong>
                </div>
              ))}
            </div>
            <div className={styles.totals}>
              {Number(doc.discountTotal) > 0 || Number(doc.taxTotal) > 0 ? (
                <div className={styles.totalRow}>
                  <span>Subtotal</span>
                  <span>{formatAmount(doc.subtotal)}</span>
                </div>
              ) : null}
              {Number(doc.discountTotal) > 0 ? (
                <div className={styles.totalRow}>
                  <span>Discount</span>
                  <span>-{formatAmount(doc.discountTotal)}</span>
                </div>
              ) : null}
              {Number(doc.taxTotal) > 0 ? (
                <div className={styles.totalRow}>
                  <span>{doc.taxLabel}</span>
                  <span>{formatAmount(doc.taxTotal)}</span>
                </div>
              ) : null}
              <div className={`${styles.totalRow} ${styles.totalStrong}`}>
                <span>Total ({doc.currency})</span>
                <span>{formatAmount(doc.total)}</span>
              </div>
            </div>
          </>
        )}
      </Card>

      {doc.receipts.length > 0 ? (
        <Card className={styles.card}>
          <h3 className={styles.sectionTitle}>Payments received</h3>
          <div className={styles.detailTable}>
            {doc.receipts.map((receipt) => (
              <button
                key={receipt.id}
                type="button"
                className={styles.row}
                onClick={() => onOpen(receipt.id)}
              >
                <span className={styles.rowTitle}>{receipt.docNumber}</span>
                <span className={styles.rowAmount}>{formatAmount(receipt.total)}</span>
                <span className={styles.rowMeta}>{friendlyDate(receipt.paidOn)}</span>
              </button>
            ))}
          </div>
        </Card>
      ) : null}

      {doc.sourceDocNumber && doc.docType === 'INVOICE' && doc.sourceDocumentId ? (
        <p className={styles.muted}>
          Made from quotation{' '}
          <Button variant="quiet" size="sm" onClick={() => onOpen(doc.sourceDocumentId!)}>
            {doc.sourceDocNumber}
          </Button>
        </p>
      ) : null}

      {doc.notes || doc.terms ? (
        <Card className={styles.card}>
          {doc.notes ? (
            <>
              <h3 className={styles.sectionTitle}>Note</h3>
              <p className={styles.pre}>{doc.notes}</p>
            </>
          ) : null}
          {doc.terms ? (
            <>
              <h3 className={styles.sectionTitle}>Terms</h3>
              <p className={styles.pre}>{doc.terms}</p>
            </>
          ) : null}
        </Card>
      ) : null}

      <Modal
        open={dialog === 'receipt'}
        onClose={() => !command.busy && setDialog(null)}
        title="Record a payment"
        description="This makes a receipt for the customer. It does not change your customer accounts or cash."
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialog(null)} disabled={command.busy}>
              Cancel
            </Button>
            <Button type="submit" form="sd-receipt-form" loading={command.busy}>
              Make receipt
            </Button>
          </>
        }
      >
        <form id="sd-receipt-form" onSubmit={submitReceipt} className={styles.page}>
          <NumericInput
            id="sd-rc-amount"
            label="Amount received"
            required
            hint={`Still owed: ${doc.currency} ${formatAmount(doc.balance ?? doc.total)}`}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <Field id="sd-rc-method" label="How was it paid?" required>
            <input
              id="sd-rc-method"
              value={method}
              maxLength={60}
              onChange={(e) => setMethod(e.target.value)}
            />
          </Field>
          <Field id="sd-rc-ref" label="Reference" optional>
            <input
              id="sd-rc-ref"
              value={reference}
              maxLength={120}
              onChange={(e) => setReference(e.target.value)}
            />
          </Field>
          <Field id="sd-rc-date" label="Date received" required>
            <input
              id="sd-rc-date"
              type="date"
              value={paidOn}
              onChange={(e) => setPaidOn(e.target.value)}
            />
          </Field>
          {command.error ? <ErrorState title="Not recorded" message={command.error} /> : null}
        </form>
      </Modal>

      <Modal
        open={dialog === 'void'}
        onClose={() => !command.busy && setDialog(null)}
        title={`Cancel this ${label.toLowerCase()}?`}
        description="It stays on record with its number and is marked cancelled. This cannot be undone."
        role="alertdialog"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialog(null)} disabled={command.busy}>
              Keep it
            </Button>
            <Button type="submit" form="sd-void-form" variant="danger" loading={command.busy}>
              Cancel {label.toLowerCase()}
            </Button>
          </>
        }
      >
        <form id="sd-void-form" onSubmit={submitVoid} className={styles.page}>
          <Field id="sd-void-reason" label="Why is it being cancelled?" required>
            <textarea
              id="sd-void-reason"
              rows={3}
              value={reason}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          {command.error ? <ErrorState title="Not cancelled" message={command.error} /> : null}
        </form>
      </Modal>
      {command.stepUp}
    </div>
  );
}

/** a - b on 4-decimal strings, exactly. */
function subtract(a: string, b: string): string {
  const scale = (v: string): bigint => {
    const [i = '0', f = ''] = v.split('.');
    return BigInt(i + f.padEnd(4, '0').slice(0, 4));
  };
  const diff = scale(a) - scale(b);
  const digits = (diff < 0n ? -diff : diff).toString().padStart(5, '0');
  return `${diff < 0n ? '-' : ''}${digits.slice(0, -4)}.${digits.slice(-4)}`;
}
