'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Notice } from '@/design-system/feedback';
import { useToast } from '@/design-system/feedback-provider';
import { Checkbox } from '@/design-system/forms';
import { formatBusinessDate, formatLitres } from '@/design-system/formatters';
import { Button, Card, EmptyState, StatusBadge } from '@/design-system/primitives';
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
  return (
    <div className="pg">
      <p className="pg-intro">
        Open a delivery to record its truck compartments, seals, water test and what the driver
        confirmed.
      </p>
      {recording ? (
        <RecordDelivery
          tenantId={context.tenantId}
          stationId={context.stationId}
          tanks={initialData.tanks}
        />
      ) : (
        <div className="pg-actions">
          <Button type="button" onClick={() => setRecording(true)}>
            Record delivery
          </Button>
        </div>
      )}
      {deliveries.length === 0 ? (
        <EmptyState
          title="No deliveries yet"
          message="Deliveries you record for this station will show here."
        />
      ) : (
        <TableScrollRegion label="Fuel deliveries">
          <table className="data-table">
            <caption className="visually-hidden">Fuel deliveries</caption>
            <thead>
              <tr>
                <th scope="col">Delivery note</th>
                <th scope="col">Fuel</th>
                <th scope="col">On the note</th>
                <th scope="col">Received</th>
                <th scope="col">Details recorded</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.map((delivery) => (
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
                        {delivery.receipt === 'PARTIAL' ? 'Partial delivery' : 'More than the note'}
                      </span>
                    )}
                  </td>
                  <td data-label="Details recorded">
                    <span className="cluster">
                      <StatusBadge tone={delivery.compartmentCount > 0 ? 'positive' : 'neutral'}>
                        {delivery.compartmentCount > 0
                          ? `${delivery.compartmentCount} compartment${delivery.compartmentCount === 1 ? '' : 's'}`
                          : 'No compartments'}
                      </StatusBadge>
                      <StatusBadge tone={delivery.hasWaterTest ? 'positive' : 'neutral'}>
                        {delivery.hasWaterTest ? 'Water tested' : 'No water test'}
                      </StatusBadge>
                      <StatusBadge
                        tone={
                          delivery.driverConfirmed === null
                            ? 'neutral'
                            : delivery.driverConfirmed
                              ? 'positive'
                              : 'warning'
                        }
                      >
                        {delivery.driverConfirmed === null
                          ? 'Driver not recorded'
                          : delivery.driverConfirmed
                            ? 'Driver confirmed'
                            : 'Driver has not confirmed'}
                      </StatusBadge>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScrollRegion>
      )}
      <Card className="pg-card">
        <h2>Water test rule</h2>
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
      </Card>
    </div>
  );
}
