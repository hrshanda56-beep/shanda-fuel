import Link from 'next/link';
import { buildContextHref, type ContextSelection } from '@/modules/context';
import { Card, EmptyState, StatusBadge } from '@/design-system/primitives';
import { formatTileMoney } from '@/modules/reporting/format';
import { DocumentAttachments } from '@/modules/documents/ui/document-attachments';
import { SUPPLIER_PAYMENT_PROOF_THRESHOLD_USD } from '../payment-proof';
import type { SupplierPaymentWithProof } from '../payment-proof-queries';
import { movementLabel } from './supplier-format';

/**
 * A supplier's payments with their proof of payment. A payment of US$1,000 or more with no proof
 * is marked "Needs proof". Proof never blocks a payment. Files are added here, one payment at a
 * time; opening a file asks for a short-lived private link.
 */
export function SupplierPaymentProofView({
  supplierName,
  supplierId,
  payments,
  selection,
  search,
}: {
  supplierName: string;
  supplierId: string;
  payments: readonly SupplierPaymentWithProof[];
  selection: ContextSelection;
  search: string;
}) {
  const missing = payments.filter((payment) => payment.needsProof).length;
  const backHref = buildContextHref(
    `/suppliers/${encodeURIComponent(supplierId)}`,
    search,
    selection,
  );
  const threshold = formatTileMoney(SUPPLIER_PAYMENT_PROOF_THRESHOLD_USD);

  return (
    <div className="content-grid wide-workspace">
      <Card as="section" className="panel content-span" aria-labelledby="payment-proof-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">{supplierName}</p>
            <h2 id="payment-proof-title">Payments and proof of payment</h2>
          </div>
          <Link className="button button-secondary" href={backHref}>
            Back to supplier
          </Link>
        </div>
        <p className="field-hint">
          Add a photo or PDF of the bank slip or transfer confirmation to each payment. Proof is
          optional, but a payment of {threshold} or more without proof is flagged for review.
        </p>
        {missing > 0 ? (
          <p role="status">
            <StatusBadge tone="warning">
              {missing} {missing === 1 ? 'payment needs' : 'payments need'} proof
            </StatusBadge>
          </p>
        ) : null}

        {payments.length === 0 ? (
          <EmptyState
            layout="block"
            icon="receipt"
            title="No payments recorded"
            message="Payments to this supplier appear here once they are submitted."
          />
        ) : (
          <ul className="list-rows" aria-label="Supplier payments">
            {payments.map((payment) => (
              <li key={payment.paymentId} className="list-item">
                <details>
                  <summary className="list-row">
                    <span className="list-cell" data-label="Date">
                      {payment.paymentDate}
                    </span>
                    <span className="list-cell" data-label="Reference">
                      {payment.reference}
                    </span>
                    <span className="list-cell list-amount" data-label="Amount">
                      {formatTileMoney(payment.amount, payment.currency)}
                    </span>
                    <span className="list-cell" data-label="Status">
                      {movementLabel(payment.state)}
                    </span>
                    <span className="list-cell" data-label="Proof">
                      {payment.needsProof ? (
                        <StatusBadge tone="warning">Needs proof</StatusBadge>
                      ) : payment.proofCount > 0 ? (
                        <StatusBadge tone="neutral">
                          {payment.proofCount} {payment.proofCount === 1 ? 'file' : 'files'}
                        </StatusBadge>
                      ) : (
                        <StatusBadge tone="neutral">No proof</StatusBadge>
                      )}
                    </span>
                  </summary>
                  {selection.stationId ? (
                    <DocumentAttachments
                      tenantId={selection.organisationId}
                      stationId={selection.stationId}
                      subjectType="SUPPLIER_PAYMENT"
                      subjectId={payment.paymentId}
                      defaultKind="RECEIPT"
                      title="Proof of payment"
                    />
                  ) : (
                    <p className="field-hint">
                      Choose a station in the work context above to add or open proof of payment.
                    </p>
                  )}
                </details>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
