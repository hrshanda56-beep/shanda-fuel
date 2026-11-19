'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Icon } from '@/design-system/icons';
import { Notice } from '@/design-system/feedback';
import { useToast } from '@/design-system/feedback-provider';
import { Checkbox } from '@/design-system/forms';
import { formatBusinessDate, formatQuantity } from '@/design-system/formatters';
import { Modal } from '@/design-system/modal';
import { Button, Card, StatusBadge } from '@/design-system/primitives';
import { Pagination, usePagination } from '@/design-system/pagination';
import { TableScrollRegion } from '@/design-system/table';
import type { DeliveryList } from '../queries';
import { RecordDelivery } from './record-delivery';
import { InfoTip } from '@/design-system/info-tip';
import { NotchedCard } from '@/design-system/notched-card';

export function DeliveriesList({
  context,
  contextQuery,
  initialData,
}: {
  context: { tenantId: string; stationId: string; stationName: string };
  /** Station selection to carry onto the detail page, e.g. "organisation=…&station=…". */
  contextQuery: string;
  initialData: DeliveryList;
}) {
  const toast = useToast();
  const [required, setRequired] = useState(initialData.waterTestRequired);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function changeRule(next: boolean) {
    setSaving(true);
    setProblem(null);
    try {
      const response = await fetch('/api/deliveries/commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({
          commandType: 'SetWaterTestRequired',
          tenantId: context.tenantId,
          stationId: context.stationId,
          required: next,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) {
        throw new Error(body.message || 'Only an owner can change this.');
      }
      setRequired(next);
      toast.success(
        next
          ? 'Saved. A water test is now required.'
          : 'Saved. A water test is no longer required.',
      );
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'That could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  const { deliveries } = initialData;
  const [recording, setRecording] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'ALL' | 'CONFIRMED' | 'DRAFT' | 'CANCELLED'>('ALL');
  const searched = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return deliveries;
    return deliveries.filter((delivery) =>
      [delivery.deliveryNoteNumber, delivery.productName, delivery.supplierName ?? '']
        .join(' ')
        .toLowerCase()
        .includes(needle),
    );
  }, [deliveries, search]);
  const visible = useMemo(
    () => (status === 'ALL' ? searched : searched.filter((delivery) => delivery.status === status)),
    [searched, status],
  );
  const page = usePagination(visible, { resetKey: `${search}|${status}` });
  const missing = (delivery: (typeof deliveries)[number]) =>
    [
      delivery.compartmentCount === 0 ? 'truck compartments' : null,
      delivery.hasWaterTest ? null : 'water test',
      delivery.driverConfirmed ? null : 'driver confirmation',
    ].filter(Boolean) as string[];
  return (
    <div className="pg">
      <NotchedCard
        title={
          <>
            Deliveries
            {deliveries.length > 0 ? (
              <span className="deliveries-count"> {deliveries.length}</span>
            ) : null}
          </>
        }
        titleId="deliveries-title"
        titleAside={
          deliveries.length > 0 ? <InfoTip>Open a delivery to see its full details.</InfoTip> : null
        }
        className="pg-card deliveries-card"
        notchWidth={10.5}
        actions={
          initialData.canRecord ? (
            <Button type="button" onClick={() => setRecording(true)}>
              Record delivery
            </Button>
          ) : null
        }
      >
        {deliveries.length === 0 ? (
          <p className="deliveries-empty table-secondary">
            No deliveries yet.
            {initialData.canRecord ? ' Record one when a fuel truck arrives.' : ''}
          </p>
        ) : (
          <>
            <div className="deliveries-toolbar">
              <label className="list-search">
                <Icon name="search" />
                <input
                  type="search"
                  aria-label="Search deliveries"
                  placeholder="Search deliveries"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  autoComplete="off"
                />
              </label>
              <div className="list-filters" role="group" aria-label="Filter deliveries">
                {(
                  [
                    ['ALL', 'All'],
                    ['CONFIRMED', 'Confirmed'],
                    ['DRAFT', 'Not confirmed yet'],
                    ['CANCELLED', 'Cancelled'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className="list-filter"
                    aria-pressed={status === value}
                    onClick={() => setStatus(value)}
                  >
                    {label}
                    <span>
                      {value === 'ALL'
                        ? searched.length
                        : searched.filter((delivery) => delivery.status === value).length}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            {visible.length === 0 ? (
              <p className="deliveries-empty table-secondary">No deliveries match.</p>
            ) : null}
            <TableScrollRegion label="Fuel deliveries">
              <table className="data-table">
                <caption className="visually-hidden">Fuel deliveries</caption>
                <thead>
                  <tr>
                    <th scope="col">Delivery note</th>
                    <th scope="col">Fuel</th>
                    <th scope="col">On the note</th>
                    <th scope="col">Received</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {page.rows.map((delivery) => {
                    const gaps = delivery.status === 'DRAFT' ? missing(delivery) : [];
                    return (
                      <tr key={delivery.id}>
                        <th scope="row">
                          <Link
                            className="row-link"
                            href={`/inventory/deliveries/${delivery.id}${contextQuery ? `?${contextQuery}` : ''}`}
                          >
                            {delivery.deliveryNoteNumber}
                          </Link>
                          <span className="table-secondary">
                            {formatBusinessDate(delivery.businessDate)}
                            {delivery.supplierName ? ` · ${delivery.supplierName}` : ''}
                          </span>
                        </th>
                        <td data-label="Fuel">{delivery.productName}</td>
                        <td data-label="On the note">
                          {formatQuantity(delivery.noteLitres, delivery.unit)}
                        </td>
                        <td data-label="Received">
                          {formatQuantity(delivery.receivedLitres, delivery.unit)}
                          {delivery.receipt === 'FULL' ? null : (
                            <span className="table-secondary">
                              {delivery.receipt === 'PARTIAL'
                                ? 'Less than the note'
                                : 'More than the note'}
                            </span>
                          )}
                        </td>
                        <td data-label="Status">
                          <StatusBadge
                            tone={
                              delivery.status === 'CONFIRMED'
                                ? 'positive'
                                : delivery.status === 'DRAFT'
                                  ? 'pending'
                                  : 'neutral'
                            }
                          >
                            {delivery.status === 'CONFIRMED'
                              ? 'Confirmed'
                              : delivery.status === 'DRAFT'
                                ? 'Not confirmed yet'
                                : 'Cancelled'}
                          </StatusBadge>
                          {gaps.length > 0 ? (
                            <span className="table-secondary">Still needs: {gaps.join(', ')}</span>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableScrollRegion>
            <Pagination slice={page} label="Deliveries pages" noun="deliveries" />
          </>
        )}
      </NotchedCard>
      {initialData.canSetWaterTestRule ? (
        <Card className="pg-card">
          <details className="deliveries-rules">
            <summary>Delivery rules</summary>
            <InfoTip>
              Only an owner can change this. It applies to every station in the organisation.
            </InfoTip>
            <Checkbox
              label="A delivery cannot be confirmed until its water test is recorded"
              hint="Left off, the water test is still recorded but never stops a delivery."
              checked={required}
              disabled={saving}
              onChange={(event) => void changeRule(event.target.checked)}
            />
            {problem ? <Notice tone="critical">{problem}</Notice> : null}
          </details>
        </Card>
      ) : null}
      <Modal
        open={recording}
        onClose={() => setRecording(false)}
        title="Record delivery"
        presentation="page"
        backLabel="Deliveries"
        size="lg"
      >
        <RecordDelivery
          framed={false}
          tenantId={context.tenantId}
          stationId={context.stationId}
          tanks={initialData.tanks}
          onCancel={() => setRecording(false)}
        />
      </Modal>
    </div>
  );
}
