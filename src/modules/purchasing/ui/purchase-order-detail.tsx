'use client';

import Decimal from 'decimal.js';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ContextResolution } from '@/modules/context';
import { ConfirmDialog } from '@/design-system/dialogs';
import { PageHeader } from '@/design-system/layout';
import { Modal } from '@/design-system/modal';
import { Select } from '@/design-system/forms';
import {
  Button,
  Card,
  ContextRequiredState,
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
  dateText,
  litresText,
  orderStatus,
  pricePerLitreText,
  totalOrderedLitres,
} from './purchasing-format';
import { PurchasingRequestError, getJson, newKey, ordersHref, postJson } from './purchasing-client';
import type { OrderReference, PurchaseOrderDetailData } from './purchasing-types';
import styles from './purchasing.module.css';

type Action = 'submit' | 'approve' | 'cancel' | 'close' | null;

const DELIVERY_STATUS: Record<string, string> = {
  DRAFT: 'Recorded, not confirmed yet',
  CONFIRMED: 'Received and confirmed',
};

export function PurchaseOrderDetail({
  purchaseOrderId,
  resolution,
  capabilities,
}: {
  purchaseOrderId: string;
  resolution: ContextResolution;
  capabilities: PurchasingCapabilities;
}) {
  const searchParams = useSearchParams();
  const current = resolution.current;
  const tenantId = current?.organisationId ?? '';
  const stationId = searchParams.get('stationId') ?? current?.stationId ?? '';
  const stationName = useMemo(() => {
    for (const org of resolution.available.organisations) {
      for (const entity of org.legalEntities) {
        const station = entity.stations.find((s) => s.id === stationId);
        if (station) return station.name;
      }
    }
    return null;
  }, [resolution, stationId]);

  const [order, setOrder] = useState<PurchaseOrderDetailData | null>(null);
  const [reference, setReference] = useState<OrderReference | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [action, setAction] = useState<Action>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [unlinkId, setUnlinkId] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!tenantId || !stationId) return;
      setLoading(true);
      setError(null);
      try {
        const scope = new URLSearchParams({ tenantId, stationId });
        const [detail, ref] = await Promise.all([
          getJson<PurchaseOrderDetailData>(
            `/api/purchasing/detail?${new URLSearchParams({ tenantId, stationId, purchaseOrderId })}`,
            'This order could not be loaded.',
            signal,
          ),
          getJson<OrderReference>(
            `/api/purchasing/reference?${scope}`,
            'The supplier and fuel lists could not be loaded.',
            signal,
          ).catch(() => null),
        ]);
        setOrder(detail);
        setReference(ref);
      } catch (cause) {
        if (signal?.aborted) return;
        setError(cause instanceof Error ? cause.message : 'This order could not be loaded.');
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [tenantId, stationId, purchaseOrderId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => load(controller.signal));
    return () => controller.abort();
  }, [load]);

  const backHref = ordersHref({
    tenantId,
    legalEntityId: current?.legalEntityId ?? null,
    stationId: stationId || null,
  });

  if (!current || !stationId) {
    return (
      <div className="content-grid wide-workspace">
        <ContextRequiredState
          title="Open this order from the list"
          message="An order belongs to one station. Go back to Purchase orders and open it from there."
        />
        <Link className="button button-secondary" href={backHref}>
          Back to purchase orders
        </Link>
      </div>
    );
  }
  if (!capabilities.viewOrders) {
    return (
      <div className="content-grid wide-workspace">
        <ErrorState
          title="You cannot see purchase orders"
          message="Ask the owner or a manager to give you access to purchase orders."
        />
      </div>
    );
  }

  async function run(body: Record<string, unknown>, success: string) {
    setBusy(true);
    setActionError(null);
    try {
      await postJson(
        '/api/purchasing/commands',
        { ...body, tenantId, stationId, purchaseOrderId },
        newKey(),
        'That could not be done.',
      );
      setAction(null);
      setUnlinkId(null);
      setLinkOpen(false);
      setReason('');
      setNotice(success);
      await load();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'That could not be done.');
      if (cause instanceof PurchasingRequestError && cause.status === 409) void load();
    } finally {
      setBusy(false);
    }
  }

  const state = order?.state ?? '';
  const display = order?.displayState ?? state;
  const status = orderStatus(display);
  const anyReceived = order?.lines.some((line) => new Decimal(line.receivedLitres).gt(0)) ?? false;
  const openLitres = (order?.lines ?? [])
    .filter((line) => line.status === 'ACTIVE')
    .reduce((sum, line) => sum.add(line.openLitres), new Decimal(0));
  const activeLinks = order?.deliveries.filter((d) => d.state === 'ACTIVE') ?? [];
  const canEdit =
    capabilities.createOrders &&
    (state === 'DRAFT' || state === 'SUBMITTED' || state === 'APPROVED');
  const canCancel =
    capabilities.cancelOrders &&
    !anyReceived &&
    (state === 'DRAFT' || state === 'SUBMITTED' || state === 'APPROVED');
  const canClose = capabilities.cancelOrders && state === 'APPROVED';
  const canLink = capabilities.createOrders && state === 'APPROVED';

  const primary =
    state === 'DRAFT' && capabilities.createOrders ? (
      <Button onClick={() => setAction('submit')}>Send for approval</Button>
    ) : state === 'SUBMITTED' && capabilities.approveOrders ? (
      <Button onClick={() => setAction('approve')}>Approve order</Button>
    ) : canLink && display !== 'RECEIVED' ? (
      <Button onClick={() => setLinkOpen(true)}>Link a delivery</Button>
    ) : null;

  const lineName = (lineId: string) =>
    order?.lines.find((line) => line.lineId === lineId)?.productName ?? 'Fuel';

  return (
    <div className="content-grid wide-workspace">
      <PageHeader
        eyebrow={order ? `${order.supplierName} · ${stationName ?? 'Station'}` : 'Purchase order'}
        title={order ? `Order ${order.orderNumber}` : 'Purchase order'}
        headingLevel="h2"
        titleId="purchase-order-title"
        description={
          order ? (
            <span className={styles.next}>
              <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
              <span>{status.next}</span>
            </span>
          ) : undefined
        }
        actions={
          <div className={styles.actions}>
            {primary}
            <Link className="button button-quiet" href={backHref}>
              Back to purchase orders
            </Link>
          </div>
        }
      />

      {notice ? <SuccessState title="Done" message={notice} /> : null}
      {loading && !order ? <LoadingState label="Loading order" /> : null}
      {error ? (
        <ErrorState
          message={error}
          action={<Button onClick={() => void load()}>Try again</Button>}
        />
      ) : null}

      {order ? (
        <>
          <Card as="section" className="panel content-span" aria-labelledby="po-lines-title">
            <h3 id="po-lines-title">Fuel on this order</h3>
            <div className={`${styles.table} ${styles.stack}`}>
              <div className={styles.head + ' list-head'} aria-hidden="true">
                <span>Fuel</span>
                <span className={styles.numeric}>Ordered</span>
                <span className={styles.numeric}>Delivered so far</span>
                <span className={styles.numeric}>Still to come</span>
                <span className={styles.numeric}>Agreed price</span>
              </div>
              <ul className="list-rows" aria-label="Fuel on this order">
                {order.lines
                  .filter((line) => line.status === 'ACTIVE')
                  .map((line) => (
                    <li key={line.lineId}>
                      <div className={`${styles.row} list-row`} style={{ cursor: 'default' }}>
                        <span className={`${styles.rowTitle} ${styles.cell}`} data-label="Fuel">
                          <strong>{line.productName}</strong>
                          {line.shortClosedLitres ? (
                            <small>
                              {litresText(line.shortClosedLitres)} was not delivered; the order was
                              closed.
                            </small>
                          ) : null}
                        </span>
                        <span className={`${styles.numeric} ${styles.cell}`} data-label="Ordered">
                          {litresText(line.orderedLitres)}
                        </span>
                        <span
                          className={`${styles.numeric} ${styles.cell}`}
                          data-label="Delivered so far"
                        >
                          {litresText(line.receivedLitres)}
                          {new Decimal(line.pendingLitres).gt(0) ? (
                            <small> (+{litresText(line.pendingLitres)} not confirmed yet)</small>
                          ) : null}
                        </span>
                        <span
                          className={`${styles.numeric} ${styles.cell}`}
                          data-label="Still to come"
                        >
                          {litresText(line.openLitres)}
                        </span>
                        <span
                          className={`${styles.numeric} ${styles.cell}`}
                          data-label="Agreed price"
                        >
                          {pricePerLitreText(line.agreedUnitPrice)}
                        </span>
                      </div>
                    </li>
                  ))}
              </ul>
              <p className={styles.muted}>
                Total ordered: {litresText(totalOrderedLitres(order.lines))}
              </p>
            </div>
          </Card>

          <Card as="section" className="panel content-span" aria-labelledby="po-deliveries-title">
            <div className={styles.toolbar}>
              <h3 id="po-deliveries-title">Deliveries linked to this order</h3>
              {canLink ? (
                <Button
                  className={styles.toolbarEnd}
                  variant="secondary"
                  onClick={() => setLinkOpen(true)}
                >
                  Link a delivery
                </Button>
              ) : null}
            </div>
            {activeLinks.length === 0 ? (
              <EmptyState
                title="No fuel linked yet"
                message={
                  state === 'APPROVED'
                    ? 'When a delivery arrives, record it on the Inventory page, then link it here.'
                    : 'Deliveries can be linked once the order is approved.'
                }
              />
            ) : (
              <ul className={styles.subRows} aria-label="Linked deliveries">
                {activeLinks.map((link) => (
                  <li key={link.linkId} className={styles.subRow}>
                    <span>Delivery note {link.deliveryNoteNumber}</span>
                    <span>{lineName(link.purchaseOrderLineId)}</span>
                    <span>{litresText(link.actualQuantityLitres)}</span>
                    <span>{DELIVERY_STATUS[link.deliveryStatus] ?? 'Recorded'}</span>
                    {canLink ? (
                      <Button
                        variant="quiet"
                        aria-label={`Unlink delivery ${link.deliveryNoteNumber}`}
                        onClick={() => {
                          setReason('');
                          setActionError(null);
                          setUnlinkId(link.deliveryId);
                        }}
                      >
                        Unlink
                      </Button>
                    ) : (
                      <span />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card as="section" className="panel content-span" aria-labelledby="po-details-title">
            <div className={styles.toolbar}>
              <h3 id="po-details-title">Order details</h3>
              {canEdit || canCancel || canClose ? (
                <div className={`${styles.actions} ${styles.toolbarEnd}`}>
                  {canEdit ? (
                    <Button variant="secondary" onClick={() => setEditOpen(true)}>
                      Change order
                    </Button>
                  ) : null}
                  {canClose ? (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setReason('');
                        setActionError(null);
                        setAction('close');
                      }}
                    >
                      Close order
                    </Button>
                  ) : null}
                  {canCancel ? (
                    <Button
                      variant="danger"
                      onClick={() => {
                        setReason('');
                        setActionError(null);
                        setAction('cancel');
                      }}
                    >
                      Cancel order
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
            <dl className={styles.facts}>
              <div>
                <dt>Supplier</dt>
                <dd>{order.supplierName}</dd>
              </div>
              <div>
                <dt>Order date</dt>
                <dd>{dateText(order.orderDate)}</dd>
              </div>
              <div>
                <dt>Fuel expected by</dt>
                <dd>
                  {order.expectedDeliveryDate ? dateText(order.expectedDeliveryDate) : 'Not set'}
                </dd>
              </div>
              {order.approvedAt ? (
                <div>
                  <dt>Approved on</dt>
                  <dd>{dateText(order.approvedAt)}</dd>
                </div>
              ) : null}
              {order.cancelledAt ? (
                <div>
                  <dt>Cancelled on</dt>
                  <dd>
                    {dateText(order.cancelledAt)}
                    {order.cancellationReason ? ` — ${order.cancellationReason}` : ''}
                  </dd>
                </div>
              ) : null}
              {order.closedAt ? (
                <div>
                  <dt>Closed on</dt>
                  <dd>
                    {dateText(order.closedAt)}
                    {order.closeReason ? ` — ${order.closeReason}` : ''}
                  </dd>
                </div>
              ) : null}
              {order.notes ? (
                <div>
                  <dt>Notes</dt>
                  <dd>{order.notes}</dd>
                </div>
              ) : null}
            </dl>
          </Card>

          {order.revisions.filter((revision) => revision.reason).length > 0 ? (
            <Card as="section" className="panel content-span" aria-labelledby="po-history-title">
              <h3 id="po-history-title">Changes made to this order</h3>
              <ul className={styles.subRows} aria-label="Order changes">
                {order.revisions
                  .filter((revision) => revision.reason)
                  .map((revision) => (
                    <li key={revision.revisionNo} className={styles.subRow}>
                      <span>{dateText(revision.createdAt)}</span>
                      <span style={{ gridColumn: 'span 4' }}>{revision.reason}</span>
                    </li>
                  ))}
              </ul>
            </Card>
          ) : null}
        </>
      ) : null}

      <OrderForm
        open={editOpen}
        tenantId={tenantId}
        stationId={stationId}
        reference={reference}
        order={order}
        onClose={() => setEditOpen(false)}
        onSaved={(message) => {
          setEditOpen(false);
          setNotice(message);
          void load();
        }}
      />

      <ConfirmDialog
        open={action === 'submit'}
        onClose={() => setAction(null)}
        onConfirm={() =>
          void run(
            { commandType: 'SubmitPurchaseOrder', expectedVersion: order?.version },
            'The order was sent for approval.',
          )
        }
        title={`Send order ${order?.orderNumber ?? ''} for approval?`}
        consequence="A manager will review it. You can still change it while it waits."
        confirmLabel="Send for approval"
        pending={busy}
        error={actionError ?? undefined}
      />
      <ConfirmDialog
        open={action === 'approve'}
        onClose={() => setAction(null)}
        onConfirm={() =>
          void run(
            { commandType: 'ApprovePurchaseOrder', expectedVersion: order?.version },
            'The order is approved. Link the delivery to it when the fuel arrives.',
          )
        }
        title={`Approve order ${order?.orderNumber ?? ''}?`}
        consequence="Approving says this order is agreed. It does not pay anything. If it is changed later, it needs approving again."
        details={
          order
            ? [
                { label: 'Supplier', value: order.supplierName },
                { label: 'Total fuel', value: litresText(totalOrderedLitres(order.lines)) },
              ]
            : undefined
        }
        confirmLabel="Approve order"
        pending={busy}
        error={actionError ?? undefined}
      />
      <ConfirmDialog
        open={action === 'cancel'}
        onClose={() => setAction(null)}
        onConfirm={() => {
          if (!reason.trim())
            return setActionError('Say briefly why you are cancelling this order.');
          void run(
            {
              commandType: 'CancelPurchaseOrder',
              expectedVersion: order?.version,
              reason: reason.trim(),
            },
            'The order was cancelled.',
          );
        }}
        title={`Cancel order ${order?.orderNumber ?? ''}?`}
        tone="danger"
        consequence={
          <div className={styles.confirmBox}>
            <p>
              This stops the order. No fuel has arrived on it, and nothing is paid or deducted. It
              cannot be undone.
            </p>
            <Field id="po-cancel-reason" label="Why are you cancelling it?" required>
              <input
                id="po-cancel-reason"
                value={reason}
                maxLength={500}
                onChange={(event) => setReason(event.target.value)}
                placeholder="e.g. Supplier could not deliver"
              />
            </Field>
          </div>
        }
        confirmLabel="Cancel order"
        cancelLabel="Keep order"
        pending={busy}
        error={actionError ?? undefined}
      />
      <ConfirmDialog
        open={action === 'close'}
        onClose={() => setAction(null)}
        onConfirm={() => {
          if (!reason.trim()) return setActionError('Say briefly why you are closing this order.');
          void run(
            {
              commandType: 'ClosePurchaseOrder',
              expectedVersion: order?.version,
              reason: reason.trim(),
            },
            'The order is closed.',
          );
        }}
        title={`Close order ${order?.orderNumber ?? ''}?`}
        tone="warning"
        consequence={
          <div className={styles.confirmBox}>
            <p>
              Closing means you are not expecting any more fuel on this order.
              {openLitres.gt(0)
                ? ` The ${litresText(openLitres.toFixed(3))} that has not arrived will be recorded as not delivered.`
                : ''}{' '}
              It cannot be undone.
            </p>
            <Field id="po-close-reason" label="Why are you closing it?" required>
              <input
                id="po-close-reason"
                value={reason}
                maxLength={500}
                onChange={(event) => setReason(event.target.value)}
                placeholder="e.g. Supplier delivered less than ordered"
              />
            </Field>
          </div>
        }
        confirmLabel="Close order"
        cancelLabel="Keep open"
        pending={busy}
        error={actionError ?? undefined}
      />
      <ConfirmDialog
        open={unlinkId !== null}
        onClose={() => setUnlinkId(null)}
        onConfirm={() => {
          if (!reason.trim()) return setActionError('Say briefly why you are unlinking it.');
          void run(
            {
              commandType: 'UnlinkDeliveryFromPurchaseOrder',
              deliveryId: unlinkId,
              reason: reason.trim(),
            },
            'The delivery was unlinked from this order.',
          );
        }}
        title="Unlink this delivery?"
        consequence={
          <div className={styles.confirmBox}>
            <p>
              The delivery stays recorded in your stock. It will just no longer count towards this
              order.
            </p>
            <Field id="po-unlink-reason" label="Why are you unlinking it?" required>
              <input
                id="po-unlink-reason"
                value={reason}
                maxLength={500}
                onChange={(event) => setReason(event.target.value)}
                placeholder="e.g. Linked to the wrong order"
              />
            </Field>
          </div>
        }
        confirmLabel="Unlink delivery"
        pending={busy}
        error={actionError ?? undefined}
      />

      <LinkDeliveryDialog
        open={linkOpen && order !== null}
        order={order}
        reference={reference}
        busy={busy}
        error={actionError}
        onClose={() => setLinkOpen(false)}
        onLink={(lineId, deliveryId) =>
          void run(
            {
              commandType: 'LinkDeliveryToPurchaseOrder',
              purchaseOrderLineId: lineId,
              deliveryId,
            },
            'The delivery is now linked to this order.',
          )
        }
      />
    </div>
  );
}

function LinkDeliveryDialog({
  open,
  order,
  reference,
  busy,
  error,
  onClose,
  onLink,
}: {
  open: boolean;
  order: PurchaseOrderDetailData | null;
  reference: OrderReference | null;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onLink: (lineId: string, deliveryId: string) => void;
}) {
  if (!open || !order) return null;
  return (
    <LinkDeliveryBody
      order={order}
      reference={reference}
      busy={busy}
      error={error}
      onClose={onClose}
      onLink={onLink}
    />
  );
}

function LinkDeliveryBody({
  order,
  reference,
  busy,
  error,
  onClose,
  onLink,
}: {
  order: PurchaseOrderDetailData;
  reference: OrderReference | null;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onLink: (lineId: string, deliveryId: string) => void;
}) {
  const lines = order.lines.filter((line) => line.status === 'ACTIVE');
  const [lineId, setLineId] = useState(lines[0]?.lineId ?? '');
  const [deliveryId, setDeliveryId] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const line = lines.find((row) => row.lineId === lineId);
  const deliveries = (reference?.linkableDeliveries ?? []).filter(
    (delivery) => delivery.productId === line?.productId,
  );
  return (
    <Modal
      open
      onClose={() => {
        if (!busy) onClose();
      }}
      title="Link a delivery"
      description="Choose the fuel delivery that came in against this order. Only deliveries from the same supplier can be linked."
      size="md"
      dismissible={!busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            loading={busy}
            onClick={() => {
              if (!lineId || !deliveryId) return setProblem('Choose the delivery to link.');
              setProblem(null);
              onLink(lineId, deliveryId);
            }}
          >
            Link delivery
          </Button>
        </>
      }
    >
      {problem || error ? (
        <ErrorState title="Not linked yet" message={(problem ?? error)!} />
      ) : null}
      <div className={styles.formGrid}>
        {lines.length > 1 ? (
          <Field id="link-line" label="Which fuel on the order?" required>
            <Select
              id="link-line"
              value={lineId}
              onChange={(event) => {
                setLineId(event.target.value);
                setDeliveryId('');
              }}
              options={lines.map((row) => ({
                value: row.lineId,
                label: `${row.productName} — ${litresText(row.openLitres)} still to come`,
              }))}
            />
          </Field>
        ) : null}
        {deliveries.length === 0 ? (
          <EmptyState
            title="No delivery to link"
            message={`There is no unlinked ${line?.productName ?? 'fuel'} delivery at this station. Record the delivery on the Inventory page first, then come back.`}
          />
        ) : (
          <Field id="link-delivery" label="Delivery" required>
            <Select
              id="link-delivery"
              value={deliveryId}
              onChange={(event) => setDeliveryId(event.target.value)}
              placeholder="Choose a delivery"
              options={deliveries.map((d) => ({
                value: d.id,
                label: `Note ${d.deliveryNoteNumber} · ${dateText(d.businessDate)} · ${litresText(d.actualQuantityLitres)}${d.status === 'DRAFT' ? ' (not confirmed yet)' : ''}`,
              }))}
            />
          </Field>
        )}
      </div>
    </Modal>
  );
}
