'use client';

import { useRef, useState, type FormEvent } from 'react';
import { Modal } from '@/design-system/modal';
import { Button, ErrorState, Field } from '@/design-system/primitives';
import { Select } from '@/design-system/forms';
import { checkOrderLines, todayBusinessDate, type OrderLineInput } from './purchasing-format';
import { newKey, postJson } from './purchasing-client';
import type { OrderReference, PurchaseOrder } from './purchasing-types';
import styles from './purchasing.module.css';

type Props = {
  open: boolean;
  tenantId: string;
  stationId: string;
  reference: OrderReference | null;
  /** Present when editing an existing order. */
  order?: PurchaseOrder | null;
  onClose: () => void;
  onSaved: (message: string, purchaseOrderId: string) => void;
};

function blankLine(reference: OrderReference | null): OrderLineInput {
  const only = reference?.products.length === 1 ? reference.products[0] : undefined;
  return { productId: only?.id ?? '', litres: '', price: '' };
}

/** Create a new order, or change an existing one. The form is remounted each time it opens. */
export function OrderForm(props: Props) {
  if (!props.open) return null;
  return <OrderFormBody {...props} />;
}

function OrderFormBody({ tenantId, stationId, reference, order, onClose, onSaved }: Props) {
  const editing = Boolean(order);
  const suppliers = reference?.suppliers ?? [];
  const products = reference?.products ?? [];
  const [supplierId, setSupplierId] = useState(
    order?.supplierId ?? (suppliers.length === 1 ? (suppliers[0]?.id ?? '') : ''),
  );
  const [orderDate, setOrderDate] = useState(order?.orderDate ?? todayBusinessDate());
  const [expected, setExpected] = useState(order?.expectedDeliveryDate ?? '');
  const [notes, setNotes] = useState(order?.notes ?? '');
  const [reason, setReason] = useState('');
  const [lines, setLines] = useState<OrderLineInput[]>(
    order
      ? order.lines
          .filter((line) => line.status === 'ACTIVE')
          .map((line) => ({
            lineId: line.lineId,
            productId: line.productId,
            litres: line.orderedLitres.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, ''),
            price: line.agreedUnitPrice
              ? line.agreedUnitPrice.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
              : '',
          }))
      : [blankLine(reference)],
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);

  function updateLine(index: number, patch: Partial<OrderLineInput>) {
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!editing && !supplierId) return setError('Choose the supplier you are ordering from.');
    if (!orderDate) return setError('Choose the date of the order.');
    if (expected && expected < orderDate) {
      return setError('The expected delivery date cannot be before the order date.');
    }
    const checked = checkOrderLines(lines);
    if (!checked.ok) return setError(checked.message);
    if (editing && !reason.trim()) return setError('Say briefly why you are changing this order.');

    const body: Record<string, unknown> = editing
      ? {
          commandType: 'AmendPurchaseOrder',
          tenantId,
          stationId,
          purchaseOrderId: order!.purchaseOrderId,
          expectedVersion: order!.version,
          reason: reason.trim(),
          orderDate,
          expectedDeliveryDate: expected || null,
          notes: notes.trim() || null,
          lines: checked.lines,
        }
      : {
          commandType: 'CreatePurchaseOrder',
          tenantId,
          stationId,
          supplierId,
          orderDate,
          ...(expected ? { expectedDeliveryDate: expected } : {}),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
          lines: checked.lines,
        };
    const fingerprint = JSON.stringify(body);
    if (attempt.current?.fingerprint !== fingerprint) {
      attempt.current = { fingerprint, key: newKey() };
    }
    setBusy(true);
    try {
      const result = await postJson<{ purchaseOrderId: string; orderNumber?: string }>(
        '/api/purchasing/commands',
        body,
        attempt.current.key,
        'The order could not be saved.',
      );
      attempt.current = null;
      onSaved(
        editing
          ? order!.state === 'APPROVED'
            ? 'Order changed. It needs to be approved again before more fuel is linked to it.'
            : 'Order changed.'
          : `Order ${result.orderNumber ?? ''} saved as a draft. Send it for approval when it is ready.`,
        result.purchaseOrderId,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The order could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  const lockedProduct = (line: OrderLineInput) => Boolean(line.lineId);

  return (
    <Modal
      open
      onClose={() => {
        if (!busy) onClose();
      }}
      title={editing ? `Change order ${order!.orderNumber}` : 'New purchase order'}
      description={
        editing
          ? order!.state === 'APPROVED'
            ? 'This order is already approved. After you save, it goes back to waiting for approval.'
            : 'Update what you are ordering. The change is recorded.'
          : 'Tell the supplier what fuel you want. It stays a draft until you send it for approval.'
      }
      size="lg"
      dismissible={!busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form="purchase-order-form" loading={busy}>
            {editing ? 'Save changes' : 'Save order'}
          </Button>
        </>
      }
    >
      {error ? <ErrorState title="Please check the form" message={error} /> : null}
      <form id="purchase-order-form" className={styles.formGrid} onSubmit={(e) => void submit(e)}>
        {editing ? (
          <p className={styles.muted}>Supplier: {order!.supplierName}</p>
        ) : (
          <Field
            id="po-supplier"
            label="Supplier"
            required
            hint={
              suppliers.length === 0
                ? 'There are no active suppliers yet. Add one on the Suppliers page first.'
                : undefined
            }
          >
            <Select
              id="po-supplier"
              value={supplierId}
              onChange={(event) => setSupplierId(event.target.value)}
              placeholder="Choose a supplier"
              options={suppliers.map((s) => ({ value: s.id, label: s.legalName }))}
            />
          </Field>
        )}
        <div className={styles.pair}>
          <Field id="po-date" label="Order date" required>
            <input
              id="po-date"
              type="date"
              value={orderDate}
              onChange={(event) => setOrderDate(event.target.value)}
            />
          </Field>
          <Field id="po-expected" label="Fuel expected by" optional>
            <input
              id="po-expected"
              type="date"
              value={expected}
              min={orderDate}
              onChange={(event) => setExpected(event.target.value)}
            />
          </Field>
        </div>

        <fieldset className={styles.fieldset}>
          <legend>Fuel you are ordering</legend>
          {lines.map((line, index) => (
            <div key={line.lineId ?? index} className={styles.lineCard}>
              <Field id={`po-product-${index}`} label={index === 0 ? 'Fuel' : `Fuel ${index + 1}`}>
                <Select
                  id={`po-product-${index}`}
                  value={line.productId}
                  disabled={lockedProduct(line)}
                  onChange={(event) => updateLine(index, { productId: event.target.value })}
                  placeholder="Choose the fuel"
                  options={products.map((p) => ({ value: p.id, label: p.name }))}
                />
              </Field>
              <Field id={`po-litres-${index}`} label="Litres">
                <input
                  id={`po-litres-${index}`}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="e.g. 10000"
                  value={line.litres}
                  onChange={(event) => updateLine(index, { litres: event.target.value })}
                />
              </Field>
              <Field id={`po-price-${index}`} label="Agreed price per litre" optional>
                <input
                  id={`po-price-${index}`}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="e.g. 1.45"
                  value={line.price}
                  onChange={(event) => updateLine(index, { price: event.target.value })}
                />
              </Field>
              {lines.length > 1 && !lockedProduct(line) ? (
                <Button
                  variant="quiet"
                  aria-label={`Remove fuel line ${index + 1}`}
                  onClick={() => setLines((current) => current.filter((_, i) => i !== index))}
                >
                  Remove
                </Button>
              ) : (
                <span />
              )}
            </div>
          ))}
          <div>
            <Button
              variant="secondary"
              onClick={() => setLines((current) => [...current, blankLine(reference)])}
            >
              Add another fuel
            </Button>
          </div>
          <p className={styles.muted}>
            The agreed price is used later to check the supplier&apos;s invoice. Leave it empty if
            you have not agreed one.
          </p>
        </fieldset>

        <Field id="po-notes" label="Notes for yourself or the supplier" optional>
          <textarea
            id="po-notes"
            rows={2}
            maxLength={1000}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </Field>

        {editing ? (
          <Field
            id="po-reason"
            label="Why are you changing this order?"
            required
            hint="This is kept in the order history."
          >
            <input
              id="po-reason"
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="e.g. Supplier agreed a new price"
            />
          </Field>
        ) : null}
      </form>
    </Modal>
  );
}
