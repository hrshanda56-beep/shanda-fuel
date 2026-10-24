'use client';

import Decimal from 'decimal.js';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from '@/design-system/icons';
import { Checkbox } from '@/design-system/forms';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  StatusBadge,
} from '@/design-system/primitives';
import {
  coverageStatus,
  dateText,
  litresText,
  moneyText,
  needsInvoiceAttention,
} from './purchasing-format';
import { getJson } from './purchasing-client';
import type { ExposureData, ExposureSupplier } from './purchasing-types';
import styles from './purchasing.module.css';

function attention(supplier: ExposureSupplier) {
  return supplier.deliveries.filter((d) => needsInvoiceAttention(d.state));
}

export function ExposurePanel({
  tenantId,
  legalEntityId,
}: {
  tenantId: string;
  legalEntityId: string;
}) {
  const [data, setData] = useState<ExposureData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        setData(
          await getJson<ExposureData>(
            `/api/suppliers/exposure?${new URLSearchParams({ tenantId, legalEntityId })}`,
            'The list of fuel not yet invoiced could not be loaded.',
            signal,
          ),
        );
      } catch (cause) {
        if (signal?.aborted) return;
        setError(
          cause instanceof Error
            ? cause.message
            : 'The list of fuel not yet invoiced could not be loaded.',
        );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [tenantId, legalEntityId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => load(controller.signal));
    return () => controller.abort();
  }, [load]);

  const suppliers = useMemo(
    () => (data?.suppliers ?? []).filter((supplier) => showAll || attention(supplier).length > 0),
    [data, showAll],
  );
  const pendingDeliveries = (data?.suppliers ?? []).reduce(
    (sum, supplier) => sum + attention(supplier).length,
    0,
  );

  return (
    <div className={styles.stack}>
      <p className={styles.intro}>
        Fuel is often delivered before the supplier sends the invoice. This shows fuel we have
        received that has not been invoiced yet, so you know what bills are still to come.
      </p>
      {loading ? <LoadingState label="Loading" /> : null}
      {error ? (
        <ErrorState
          message={error}
          action={<Button onClick={() => void load()}>Try again</Button>}
        />
      ) : null}
      {data && !loading && !error ? (
        <>
          <Card as="section" className="panel" aria-labelledby="po-exposure-title">
            <div className={styles.headline}>
              <h3 id="po-exposure-title" className={styles.sectionTitle}>
                Received but not invoiced yet
              </h3>
              <p className={styles.headlineValue}>{moneyText(data.totals.unbilledValue)}</p>
              <p className={styles.muted}>
                {litresText(data.totals.unbilledLitres)} across {pendingDeliveries}{' '}
                {pendingDeliveries === 1 ? 'delivery' : 'deliveries'}, as of {dateText(data.asOf)}.
                This is not what you owe yet. It is what the suppliers have still to bill you for.
              </p>
              {new Decimal(data.totals.unpricedUnbilledLitres).gt(0) ? (
                <p className={styles.muted}>
                  Not counted above: {litresText(data.totals.unpricedUnbilledLitres)} that arrived
                  without a recorded cost, so we cannot put a price on it yet.
                </p>
              ) : null}
            </div>
          </Card>

          <Card as="section" className="panel" aria-labelledby="po-exposure-list-title">
            <div className={styles.toolbar}>
              <h3 id="po-exposure-list-title" className={styles.sectionTitle}>
                By supplier
              </h3>
              <div className={styles.toolbarEnd}>
                <Checkbox
                  label="Also show deliveries that are fully invoiced"
                  checked={showAll}
                  onChange={(event) => setShowAll(event.target.checked)}
                />
              </div>
            </div>
            {suppliers.length === 0 ? (
              <EmptyState
                layout="block"
                icon="check"
                title="Everything received has been invoiced"
                message="When fuel is delivered and the supplier has not billed for it yet, it will show here."
              />
            ) : (
              <div className={`${styles.table} ${styles.three}`}>
                <div className={`${styles.head} list-head`} aria-hidden="true">
                  <span>Supplier</span>
                  <span className={styles.numeric}>Not invoiced</span>
                  <span className={styles.numeric}>Worth about</span>
                  <span />
                </div>
                <ul className="list-rows" aria-label="Fuel not yet invoiced, by supplier">
                  {suppliers.map((supplier) => {
                    const key = supplier.supplierId ?? 'unassigned';
                    const expanded = open === key;
                    const rows = showAll ? supplier.deliveries : attention(supplier);
                    const name = supplier.supplierUnassigned
                      ? 'Supplier not recorded'
                      : (supplier.legalName ?? 'Supplier');
                    return (
                      <li key={key}>
                        <button
                          type="button"
                          className={`${styles.row} list-row`}
                          aria-expanded={expanded}
                          onClick={() => setOpen(expanded ? null : key)}
                        >
                          <span
                            className={`${styles.rowTitle} ${styles.cell}`}
                            data-label="Supplier"
                          >
                            <strong>{name}</strong>
                            <small>
                              {attention(supplier).length}{' '}
                              {attention(supplier).length === 1 ? 'delivery' : 'deliveries'} to be
                              invoiced
                            </small>
                          </span>
                          <span
                            className={`${styles.numeric} ${styles.cell}`}
                            data-label="Not invoiced"
                          >
                            {litresText(supplier.unbilledLitres)}
                          </span>
                          <span
                            className={`${styles.numeric} ${styles.cell}`}
                            data-label="Worth about"
                          >
                            {moneyText(supplier.unbilledValue)}
                          </span>
                          <span className={styles.chevron} aria-hidden="true">
                            <Icon name="chevron-right" />
                          </span>
                        </button>
                        {expanded ? (
                          <div className={styles.detailPanel}>
                            {supplier.supplierUnassigned ? (
                              <p className={styles.muted}>
                                These deliveries do not say who supplied them. Open the delivery on
                                the Inventory page and choose the supplier.
                              </p>
                            ) : null}
                            <ul className={styles.subRows} aria-label={`Deliveries from ${name}`}>
                              {rows.map((delivery) => {
                                const status = coverageStatus(delivery.state);
                                return (
                                  <li key={delivery.deliveryId} className={styles.subRow}>
                                    <span>
                                      Delivery note {delivery.deliveryNoteNumber}
                                      <br />
                                      <small>{dateText(delivery.businessDate)}</small>
                                    </span>
                                    <span>
                                      <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                                    </span>
                                    <span>Received {litresText(delivery.acceptedLitres)}</span>
                                    <span>Invoiced {litresText(delivery.netBilledLitres)}</span>
                                    <span>
                                      {delivery.unbilledValue
                                        ? `About ${moneyText(delivery.unbilledValue)}`
                                        : new Decimal(delivery.unbilledLitres).gt(0)
                                          ? 'Cost not recorded'
                                          : '—'}
                                    </span>
                                    {delivery.note ? (
                                      <span
                                        style={{ gridColumn: '1 / -1' }}
                                        className={styles.muted}
                                      >
                                        {delivery.note}
                                      </span>
                                    ) : null}
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
}
