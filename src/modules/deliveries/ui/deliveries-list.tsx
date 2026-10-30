'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Notice } from '@/design-system/feedback';
import { useToast } from '@/design-system/feedback-provider';
import { Checkbox } from '@/design-system/forms';
import { formatBusinessDate, formatLitres } from '@/design-system/formatters';
import { Modal } from '@/design-system/modal';
import { Button, Card, StatusBadge } from '@/design-system/primitives';
import { ShowMore, useShowMore } from '@/design-system/show-more';
import { TableScrollRegion } from '@/design-system/table';
import type { DeliveryList } from '../queries';
import { RecordDelivery } from './record-delivery';

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
  const [shown, setShown] = useShowMore();
  const missing = (delivery: (typeof deliveries)[number]) =>
    [
      delivery.compartmentCount === 0 ? 'truck compartments' : null,
      delivery.hasWaterTest ? null : 'water test',
      delivery.driverConfirmed ? null : 'driver confirmation',
    ].filter(Boolean) as string[];
  return (
    <div className="pg">
      <Card className="pg-card deliveries-card">
        <div className="deliveries-head">
          <div>
            <h2>
              Deliveries
              {deliveries.length > 0 ? (
                <span className="deliveries-count"> {deliveries.length}</span>
              ) : null}
            </h2>
            {deliveries.length > 0 ? (
              <p className="table-secondary">Open a delivery to see its full details.</p>
            ) : null}
          </div>
          <Button type="button" onClick={() => setRecording(true)}>
            Record delivery
          </Button>
        </div>
        {deliveries.length === 0 ? (
          <p className="deliveries-empty table-secondary">
            No deliveries yet. Record one when a fuel truck arrives.
          </p>
        ) : (
          <>
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
                  {deliveries.slice(0, shown).map((delivery) => {
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
                        <td data-label="On the note">{formatLitres(delivery.noteLitres)}</td>
                        <td data-label="Received">
                          {formatLitres(delivery.receivedLitres)}
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
            <ShowMore shown={shown} total={deliveries.length} onChange={setShown} />
          </>
        )}
      </Card>
      {initialData.canSetWaterTestRule ? (
        <Card className="pg-card">
          <details className="deliveries-rules">
            <summary>Delivery rules</summary>
            <p className="table-secondary">
              Only an owner can change this. It applies to every station in the organisation.
            </p>
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
        presentation="side"
        size="lg"
      >
        <RecordDelivery
          framed={false}
          tenantId={context.tenantId}
          stationId={context.stationId}
          tanks={initialData.tanks}
        />
      </Modal>
    </div>
  );
}
