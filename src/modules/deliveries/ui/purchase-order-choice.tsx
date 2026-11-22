'use client';

import { useEffect, useMemo, useState } from 'react';
import { Field } from '@/design-system/primitives';
import {
  LINKED_CHOICE,
  NO_PO_NOTE_MAX,
  NO_PO_REASONS,
  linkableOrderOptions,
  type LinkableOrder,
} from '../purchase-order-choice';

/**
 * "Is there a purchase order for this delivery?" as a plain, required choice: pick an open order
 * of this supplier for this fuel, or say why there is none. Used by the record form, the
 * "one step left" panel and the delivery page, so all three ask it the same way.
 */
export function PurchaseOrderChoice({
  id,
  tenantId,
  stationId,
  supplierId,
  productId,
  value,
  note,
  onChange,
  linkedOrderNumber,
  error,
  disabled = false,
}: Readonly<{
  /** Prefix for the field ids, so two copies on one page do not clash. */
  id: string;
  tenantId: string;
  stationId: string;
  /** Orders are only offered once the supplier is known. */
  supplierId: string;
  productId: string;
  value: string;
  note: string;
  onChange: (next: { value: string; note: string }) => void;
  /** Set when the delivery is already linked to an order, so that stays a valid answer. */
  linkedOrderNumber?: string;
  error?: string;
  disabled?: boolean;
}>) {
  const [orders, setOrders] = useState<LinkableOrder[]>([]);

  useEffect(() => {
    if (!supplierId) return;
    const controller = new AbortController();
    const params = new URLSearchParams({
      tenantId,
      stationId,
      supplierId,
      state: 'APPROVED',
      limit: '100',
    });
    fetch(`/api/purchasing/list?${params}`, {
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('failed'))))
      .then((body: { orders?: LinkableOrder[] }) => setOrders(body.orders ?? []))
      // Someone who cannot see orders still gets the reasons below.
      .catch(() => {
        if (!controller.signal.aborted) setOrders([]);
      });
    return () => controller.abort();
  }, [tenantId, stationId, supplierId]);

  const options = useMemo(
    () => (supplierId ? linkableOrderOptions(orders, { supplierId, productId }) : []),
    [orders, supplierId, productId],
  );
  const offered = options.some((option) => option.value === value);
  // A chosen order that no longer fits (the supplier or fuel changed) must not stay selected.
  const stale = value.startsWith('PO:') && !offered;
  useEffect(() => {
    if (stale) onChange({ value: '', note });
  }, [stale, note, onChange]);

  const selected = stale ? '' : value;
  return (
    <>
      <Field
        id={`${id}-choice`}
        label="Is there a purchase order for this delivery?"
        hint={
          supplierId
            ? 'Pick the order this fuel was bought on. If there is no order, say why.'
            : 'Choose the supplier first to see its open orders. If there is no order, say why.'
        }
        error={error}
        required
      >
        <select
          id={`${id}-choice`}
          value={selected}
          disabled={disabled}
          onChange={(event) => onChange({ value: event.target.value, note })}
        >
          <option value="">Choose one</option>
          {linkedOrderNumber ? (
            <option value={LINKED_CHOICE}>Order {linkedOrderNumber} (already linked)</option>
          ) : null}
          {options.length > 0 ? (
            <optgroup label="Yes, this order">
              {options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </optgroup>
          ) : null}
          <optgroup label="No purchase order">
            {NO_PO_REASONS.map((reason) => (
              <option key={reason.value} value={reason.value}>
                No order: {reason.label}
              </option>
            ))}
          </optgroup>
        </select>
      </Field>
      {selected === 'OTHER' ? (
        <Field id={`${id}-note`} label="Why is there no purchase order?" required>
          <input
            id={`${id}-note`}
            value={note}
            maxLength={NO_PO_NOTE_MAX}
            disabled={disabled}
            onChange={(event) => onChange({ value: selected, note: event.target.value })}
          />
        </Field>
      ) : null}
    </>
  );
}
