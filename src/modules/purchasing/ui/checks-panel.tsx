'use client';

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
  checkHeadline,
  dateText,
  differenceText,
  litresText,
  pricePerLitreText,
  priceBasisText,
} from './purchasing-format';
import { getJson } from './purchasing-client';
import type { CheckRow, ChecksData, SupplierName } from './purchasing-types';
import styles from './purchasing.module.css';

export function ChecksPanel({
  tenantId,
  legalEntityId,
  suppliers,
}: {
  tenantId: string;
  legalEntityId: string;
  suppliers: SupplierName[];
}) {
  const [data, setData] = useState<ChecksData | null>(null);
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
          await getJson<ChecksData>(
            `/api/suppliers/variance?${new URLSearchParams({ tenantId, legalEntityId })}`,
            'The invoice checks could not be loaded.',
            signal,
          ),
        );
      } catch (cause) {
        if (signal?.aborted) return;
        setError(
          cause instanceof Error ? cause.message : 'The invoice checks could not be loaded.',
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

  const nameOf = (row: CheckRow) =>
    row.supplierUnassigned
      ? 'Supplier not recorded'
      : (suppliers.find((s) => s.supplierId === row.supplierId)?.legalName ?? 'Supplier');

  const rows = useMemo(() => {
    const all = [...(data?.deliveries ?? [])].sort((a, b) =>
      b.businessDate.localeCompare(a.businessDate),
    );
    return showAll ? all : all.filter((row) => row.exceeded);
  }, [data, showAll]);
  const problemCount = (data?.deliveries ?? []).filter((row) => row.exceeded).length;

  return (
    <div className={styles.stack}>
      <p className={styles.intro}>
        When the supplier sends an invoice, we compare it with what was ordered and what actually
        arrived. Anything that is more than your settings allow shows here, so you can query it
        before you pay.
      </p>
      {loading ? <LoadingState label="Loading" /> : null}
      {error ? (
        <ErrorState
          message={error}
          action={<Button onClick={() => void load()}>Try again</Button>}
        />
      ) : null}
      {data && !loading && !error ? (
        <Card as="section" className="panel" aria-labelledby="po-checks-title">
          <div className={styles.toolbar}>
            <div className={styles.headline}>
              <h3 id="po-checks-title" className={styles.sectionTitle}>
                Deliveries and invoices
              </h3>
              <p className={styles.muted}>
                {problemCount === 0
                  ? 'Nothing needs a look right now.'
                  : `${problemCount} ${problemCount === 1 ? 'delivery needs' : 'deliveries need'} a look.`}
              </p>
            </div>
            <div className={styles.toolbarEnd}>
              <Checkbox
                label="Show every delivery, not only the ones that need a look"
                checked={showAll}
                onChange={(event) => setShowAll(event.target.checked)}
              />
            </div>
          </div>
          {rows.length === 0 ? (
            <EmptyState
              layout="block"
              icon="check"
              title={showAll ? 'No deliveries yet' : 'No invoice problems found'}
              message={
                showAll
                  ? 'Once fuel is delivered, it will show here with its invoice.'
                  : 'Every invoice matches what was ordered and delivered, within your allowed differences.'
              }
            />
          ) : (
            <div className={`${styles.table} ${styles.three}`}>
              <div className={`${styles.head} list-head`} aria-hidden="true">
                <span>Delivery</span>
                <span>Result</span>
                <span className={styles.numeric}>Received</span>
                <span />
              </div>
              <ul className="list-rows" aria-label="Invoice checks">
                {rows.map((row) => {
                  const headline = checkHeadline(row);
                  const expanded = open === row.deliveryId;
                  const basis = priceBasisText(row.priceBasis, row.purchaseOrderNumber);
                  const agreed =
                    row.priceBasis === 'PURCHASE_ORDER'
                      ? row.purchaseOrderUnitPrice
                      : row.receiptUnitCost;
                  return (
                    <li key={row.deliveryId}>
                      <button
                        type="button"
                        className={`${styles.row} list-row`}
                        aria-expanded={expanded}
                        onClick={() => setOpen(expanded ? null : row.deliveryId)}
                      >
                        <span className={`${styles.rowTitle} ${styles.cell}`} data-label="Delivery">
                          <strong>{nameOf(row)}</strong>
                          <small>
                            Delivery note {row.deliveryNoteNumber} · {dateText(row.businessDate)}
                          </small>
                        </span>
                        <span className={styles.cell} data-label="Result">
                          <StatusBadge tone={headline.tone}>{headline.label}</StatusBadge>
                        </span>
                        <span className={`${styles.numeric} ${styles.cell}`} data-label="Received">
                          {litresText(row.acceptedLitres)}
                        </span>
                        <span className={styles.chevron} aria-hidden="true">
                          <Icon name="chevron-right" />
                        </span>
                      </button>
                      {expanded ? (
                        <div className={styles.detailPanel}>
                          {row.findings.length > 0 ? (
                            <ul className={styles.reasons} aria-label="What we found">
                              {row.findings.map((finding) => (
                                <li key={finding.code}>{finding.message}</li>
                              ))}
                            </ul>
                          ) : null}
                          {row.exceeded ? (
                            <p className={styles.muted}>
                              {row.toleranceAction === 'REQUIRE_APPROVAL'
                                ? 'Your settings hold an invoice like this until a manager approves it.'
                                : 'Your settings only flag differences like this for review. Query it with the supplier before paying.'}
                            </p>
                          ) : null}
                          <dl className={styles.facts}>
                            <div>
                              <dt>Delivery note said</dt>
                              <dd>{litresText(row.noteLitres)}</dd>
                            </div>
                            <div>
                              <dt>We received</dt>
                              <dd>
                                {litresText(row.acceptedLitres)}
                                {differenceText(row.receivedVsNoteLitres, 'litres') !==
                                'no difference'
                                  ? ` (${differenceText(row.receivedVsNoteLitres, 'litres')} than the note)`
                                  : ''}
                              </dd>
                            </div>
                            <div>
                              <dt>Invoice charged for</dt>
                              <dd>
                                {row.invoicedLitres === null
                                  ? 'No invoice yet'
                                  : `${litresText(row.invoicedLitres)}${
                                      row.invoicedVsAcceptedLitres &&
                                      differenceText(row.invoicedVsAcceptedLitres, 'litres') !==
                                        'no difference'
                                        ? ` (${differenceText(row.invoicedVsAcceptedLitres, 'litres')} than received)`
                                        : ''
                                    }`}
                              </dd>
                            </div>
                            <div>
                              <dt>Invoice price</dt>
                              <dd>
                                {row.invoicedUnitPrice
                                  ? `${pricePerLitreText(row.invoicedUnitPrice)}${
                                      row.priceDifference && basis
                                        ? ` (${differenceText(row.priceDifference, 'price')} than ${basis})`
                                        : ''
                                    }`
                                  : 'No priced invoice line yet'}
                              </dd>
                            </div>
                            {agreed ? (
                              <div>
                                <dt>Price we expected</dt>
                                <dd>
                                  {pricePerLitreText(agreed)}
                                  {basis ? ` — ${basis}` : ''}
                                </dd>
                              </div>
                            ) : null}
                          </dl>
                          {row.skipped.length > 0 ? (
                            <p className={styles.muted}>
                              Some checks could not run yet:{' '}
                              {row.skipped
                                .map((s) =>
                                  s.replace(/^[A-Za-z ]+ check skipped: /, '').replace(/\.$/, ''),
                                )
                                .join('; ')}
                              .
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </Card>
      ) : null}
    </div>
  );
}
