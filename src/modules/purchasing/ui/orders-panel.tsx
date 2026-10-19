'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Select } from '@/design-system/forms';
import { Icon } from '@/design-system/icons';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  StatusBadge,
  SuccessState,
} from '@/design-system/primitives';
import type { PurchasingCapabilities } from '../capabilities-types';
import { OrderForm } from './order-form';
import {
  ORDER_FILTERS,
  dateText,
  litresText,
  orderFuelSummary,
  orderMatchesFilter,
  orderStatus,
  totalOrderedLitres,
  type OrderFilter,
} from './purchasing-format';
import { getJson, orderHref } from './purchasing-client';
import type { OrderReference, PurchaseOrder, StationOption } from './purchasing-types';
import styles from './purchasing.module.css';

export function OrdersPanel({
  tenantId,
  legalEntityId,
  stations,
  initialStationId,
  capabilities,
}: {
  tenantId: string;
  legalEntityId: string;
  stations: StationOption[];
  initialStationId: string | null;
  capabilities: PurchasingCapabilities;
}) {
  const router = useRouter();
  const [stationId, setStationId] = useState(initialStationId ?? stations[0]?.id ?? '');
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [reference, setReference] = useState<OrderReference | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<OrderFilter>('all');
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!stationId) return;
      setLoading(true);
      setError(null);
      try {
        const scope = new URLSearchParams({ tenantId, stationId });
        const list = await getJson<{ orders: PurchaseOrder[] }>(
          `/api/purchasing/list?${new URLSearchParams({ tenantId, stationId, limit: '200' })}`,
          'The purchase orders could not be loaded.',
          signal,
        );
        setOrders(list.orders);
        const ref = await getJson<OrderReference>(
          `/api/purchasing/reference?${scope}`,
          'The supplier and fuel lists could not be loaded.',
          signal,
        ).catch(() => null);
        setReference(ref);
      } catch (cause) {
        if (signal?.aborted) return;
        setError(
          cause instanceof Error ? cause.message : 'The purchase orders could not be loaded.',
        );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [tenantId, stationId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => load(controller.signal));
    return () => controller.abort();
  }, [load]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    return orders.filter(
      (order) =>
        orderMatchesFilter(order.displayState, filter) &&
        (!query || `${order.orderNumber} ${order.supplierName}`.toLowerCase().includes(query)),
    );
  }, [orders, filter, search]);
  const count = (value: OrderFilter) =>
    loading || error ? '—' : orders.filter((o) => orderMatchesFilter(o.displayState, value)).length;

  if (stations.length === 0) {
    return (
      <EmptyState
        layout="block"
        icon="building"
        title="No station to order for"
        message="Purchase orders are placed for a station. Ask the owner to add a station to this company."
      />
    );
  }

  return (
    <div className={styles.stack}>
      <p className={styles.intro}>
        An order is what you ask a supplier to deliver. When the fuel arrives, link the delivery to
        its order so the supplier&apos;s invoice can be checked against it.
      </p>
      {notice ? <SuccessState title="Done" message={notice} /> : null}
      <Card as="section" className="panel" aria-labelledby="po-orders-title">
        <h3 id="po-orders-title" className="visually-hidden">
          Purchase orders
        </h3>
        <div className="list-toolbar">
          {stations.length > 1 ? (
            <Field id="po-station" label="Station">
              <Select
                id="po-station"
                value={stationId}
                onChange={(event) => setStationId(event.target.value)}
                options={stations.map((s) => ({ value: s.id, label: s.name }))}
              />
            </Field>
          ) : null}
          {orders.length > 0 ? (
            <>
              <label className="list-search">
                <Icon name="search" />
                <input
                  type="search"
                  aria-label="Search orders by number or supplier"
                  placeholder="Search orders…"
                  value={search}
                  autoComplete="off"
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>
              <div className="list-filters" role="group" aria-label="Show orders">
                {ORDER_FILTERS.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    className="list-filter"
                    aria-pressed={filter === item.value}
                    onClick={() => setFilter(item.value)}
                  >
                    {item.label}
                    <span>{count(item.value)}</span>
                  </button>
                ))}
              </div>
            </>
          ) : null}
          {capabilities.createOrders ? (
            <Button className="list-toolbar-action" onClick={() => setCreateOpen(true)}>
              New purchase order
            </Button>
          ) : null}
        </div>

        {loading ? <LoadingState label="Loading purchase orders" /> : null}
        {error ? (
          <ErrorState
            message={error}
            action={<Button onClick={() => void load()}>Try again</Button>}
          />
        ) : null}
        {!loading && !error && orders.length === 0 ? (
          <EmptyState
            layout="block"
            icon="inbox"
            title="No purchase orders yet"
            message={
              capabilities.createOrders
                ? 'Use New purchase order to ask a supplier for fuel. It stays a draft until you send it for approval.'
                : 'Orders placed for this station will show here.'
            }
          />
        ) : null}
        {!loading && !error && orders.length > 0 && visible.length === 0 ? (
          <EmptyState
            layout="block"
            icon="search"
            title="No matching orders"
            message="Try a different search, or choose All orders."
          />
        ) : null}
        {!loading && !error && visible.length > 0 ? (
          <div className={styles.table}>
            <div className={`${styles.head} list-head`} aria-hidden="true">
              <span>Order</span>
              <span>Status</span>
              <span>Fuel</span>
              <span className={styles.numeric}>Total</span>
              <span className={styles.numeric}>Fuel expected by</span>
            </div>
            <ul className="list-rows" aria-label="Purchase orders">
              {visible.map((order) => {
                const status = orderStatus(order.displayState);
                return (
                  <li key={order.purchaseOrderId}>
                    <Link
                      className={`${styles.row} list-row`}
                      href={orderHref(order.purchaseOrderId, {
                        tenantId,
                        legalEntityId,
                        stationId,
                      })}
                    >
                      <span className={`${styles.rowTitle} ${styles.cell}`} data-label="Order">
                        <strong>{order.supplierName}</strong>
                        <small>
                          Order {order.orderNumber} · {dateText(order.orderDate)}
                        </small>
                      </span>
                      <span className={styles.cell} data-label="Status">
                        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                      </span>
                      <span className={styles.cell} data-label="Fuel">
                        {orderFuelSummary(order.lines) || '—'}
                      </span>
                      <span className={`${styles.numeric} ${styles.cell}`} data-label="Total">
                        {litresText(totalOrderedLitres(order.lines))}
                      </span>
                      <span
                        className={`${styles.numeric} ${styles.cell}`}
                        data-label="Fuel expected by"
                      >
                        {order.expectedDeliveryDate ? dateText(order.expectedDeliveryDate) : '—'}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </Card>

      <OrderForm
        open={createOpen}
        tenantId={tenantId}
        stationId={stationId}
        reference={reference}
        onClose={() => setCreateOpen(false)}
        onSaved={(message, purchaseOrderId) => {
          setCreateOpen(false);
          setNotice(message);
          router.push(orderHref(purchaseOrderId, { tenantId, legalEntityId, stationId }));
        }}
      />
    </div>
  );
}
