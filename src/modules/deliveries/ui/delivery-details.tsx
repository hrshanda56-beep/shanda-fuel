'use client';

import Decimal from 'decimal.js';
import Link from 'next/link';
import { useState } from 'react';
import { PageHeader } from '@/design-system/layout';
import { Notice } from '@/design-system/feedback';
import { Checkbox, Select } from '@/design-system/forms';
import { formatLitres } from '@/design-system/formatters';
import { Button, Card, Field, NumericInput, StatusBadge } from '@/design-system/primitives';
import type { DeliveryDetail } from '../queries';

export type DeliveryDetailsContext = Readonly<{
  tenantId: string;
  stationId: string;
  stationName: string;
}>;

type SealDraft = { sealNumber: string; intact: boolean };
type CompartmentDraft = {
  key: number;
  noteLitres: string;
  receivedLitres: string;
  seals: SealDraft[];
};

/** Date and time in the station's own timezone, never the viewer's. */
function stationDateTime(value: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone,
    }).format(new Date(value));
  } catch {
    return '—';
  }
}

const LITRES = /^\d+(?:\.\d{1,3})?$/;

function toDrafts(data: DeliveryDetail): CompartmentDraft[] {
  if (data.compartments.length === 0) {
    return [{ key: 1, noteLitres: '', receivedLitres: '', seals: [] }];
  }
  return data.compartments.map((compartment) => ({
    key: compartment.compartmentNumber,
    noteLitres: compartment.noteLitres,
    receivedLitres: compartment.receivedLitres,
    seals: compartment.seals.map((seal) => ({ ...seal })),
  }));
}

function sum(values: readonly string[]): string | null {
  let total = new Decimal(0);
  for (const value of values) {
    if (!LITRES.test(value.trim())) return null;
    total = total.plus(value.trim());
  }
  return total.toString();
}

function varianceText(note: string, received: string): { label: string; tone: 'ok' | 'bad' } {
  if (!LITRES.test(note) || !LITRES.test(received)) return { label: '', tone: 'ok' };
  const difference = new Decimal(received).minus(note);
  if (difference.isZero()) return { label: 'Matches the note', tone: 'ok' };
  const amount = formatLitres(difference.abs().toString());
  return difference.isNegative()
    ? { label: `Short by ${amount}`, tone: 'bad' }
    : { label: `Over by ${amount}`, tone: 'bad' };
}

async function send(commandType: string, body: Record<string, unknown>): Promise<void> {
  const response = await fetch('/api/deliveries/commands', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({ commandType, ...body }),
  });
  const result = (await response.json().catch(() => ({}))) as { message?: string };
  if (!response.ok) {
    throw new Error(
      result.message || 'That could not be saved. Check what you typed and try again.',
    );
  }
}

export function DeliveryDetails({
  context,
  listHref,
  initialData,
}: {
  context: DeliveryDetailsContext;
  listHref: string;
  initialData: DeliveryDetail;
}) {
  const [data, setData] = useState(initialData);
  const delivery = data.delivery;
  const editable = delivery.status === 'DRAFT';
  const [compartments, setCompartments] = useState(() => toDrafts(initialData));
  const [water, setWater] = useState({
    result: initialData.waterTest?.result ?? '',
    reading: initialData.waterTest?.waterReadingMm ?? '',
    notes: initialData.waterTest?.notes ?? '',
  });
  const [driver, setDriver] = useState({
    name: initialData.driverConfirmation?.driverName ?? initialData.delivery.driver ?? '',
    confirmed: initialData.driverConfirmation?.confirmed ?? false,
    notes: initialData.driverConfirmation?.notes ?? '',
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'positive' | 'critical'; text: string } | null>(
    null,
  );
  const ids = { tenantId: context.tenantId, stationId: context.stationId, deliveryId: delivery.id };

  async function reload() {
    const params = new URLSearchParams({
      tenantId: context.tenantId,
      stationId: context.stationId,
      deliveryId: delivery.id,
    });
    const response = await fetch(`/api/deliveries/detail?${params}`, { cache: 'no-store' });
    if (!response.ok) return;
    const body = (await response.json()) as { data: DeliveryDetail };
    setData(body.data);
    setCompartments(toDrafts(body.data));
  }

  async function run(name: string, successText: string, work: () => Promise<void>) {
    setBusy(name);
    setMessage(null);
    try {
      await work();
      await reload();
      setMessage({ tone: 'positive', text: successText });
    } catch (error) {
      setMessage({
        tone: 'critical',
        text: error instanceof Error ? error.message : 'That could not be saved.',
      });
    } finally {
      setBusy(null);
    }
  }

  const totalNote = sum(compartments.map((item) => item.noteLitres));
  const totalReceived = sum(compartments.map((item) => item.receivedLitres));
  const noteMatches = totalNote !== null && new Decimal(totalNote).eq(delivery.noteLitres);
  const receivedMatches =
    totalReceived !== null && new Decimal(totalReceived).eq(delivery.receivedLitres);

  const updateCompartment = (index: number, change: Partial<CompartmentDraft>) =>
    setCompartments((current) =>
      current.map((item, position) => (position === index ? { ...item, ...change } : item)),
    );

  const receiptBadge =
    delivery.receipt === 'PARTIAL' ? (
      <StatusBadge tone="warning">Partial delivery</StatusBadge>
    ) : delivery.receipt === 'EXCESS' ? (
      <StatusBadge tone="warning">More than the note</StatusBadge>
    ) : (
      <StatusBadge tone="positive">Matches the note</StatusBadge>
    );

  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow={context.stationName}
        title="Delivery details"
        description={`Delivery note ${delivery.deliveryNoteNumber}. Record what was on each truck compartment, the water test and what the driver confirmed.`}
        actions={
          <Link className="back-link" href={listHref}>
            ← All deliveries
          </Link>
        }
      />

      {message ? (
        <Notice tone={message.tone === 'positive' ? 'positive' : 'critical'}>{message.text}</Notice>
      ) : null}

      <Card className="form-panel">
        <h2>This delivery</h2>
        <dl className="stack-sm">
          <div>
            <dt className="table-secondary">Fuel</dt>
            <dd>{delivery.productName}</dd>
          </div>
          <div>
            <dt className="table-secondary">Supplier</dt>
            <dd>{delivery.supplierName ?? 'No supplier recorded'}</dd>
          </div>
          <div>
            <dt className="table-secondary">Delivered</dt>
            <dd>{stationDateTime(delivery.deliveredAt, data.stationTimezone)}</dd>
          </div>
          <div>
            <dt className="table-secondary">Transporter, driver and truck</dt>
            <dd>
              {[delivery.transporter, delivery.driver, delivery.truckRegistration]
                .filter(Boolean)
                .join(' · ') || 'Not recorded'}
            </dd>
          </div>
          <div>
            <dt className="table-secondary">Litres on the delivery note</dt>
            <dd>{formatLitres(delivery.noteLitres)}</dd>
          </div>
          <div>
            <dt className="table-secondary">Litres received</dt>
            <dd>{formatLitres(delivery.receivedLitres)}</dd>
          </div>
          <div>
            <dd className="cluster">
              {receiptBadge}
              <StatusBadge tone={delivery.status === 'CONFIRMED' ? 'positive' : 'pending'}>
                {delivery.status === 'CONFIRMED'
                  ? 'Confirmed'
                  : delivery.status === 'CANCELLED'
                    ? 'Cancelled'
                    : 'Not confirmed yet'}
              </StatusBadge>
            </dd>
          </div>
        </dl>
      </Card>

      <Card className="form-panel">
        <h2>Truck compartments</h2>
        <p className="table-secondary">
          Add one block for each compartment on the truck. Together they must add up to the litres
          on the note and the litres received above.
          {editable ? '' : ' This delivery is closed, so the compartments can only be read.'}
        </p>
        {compartments.length === 0 ? null : (
          <div className="stack">
            {compartments.map((compartment, index) => {
              const variance = varianceText(compartment.noteLitres, compartment.receivedLitres);
              const idBase = `compartment-${index}`;
              return (
                <Card key={compartment.key} as="div" className="form-section">
                  <h3>Compartment {index + 1}</h3>
                  <div className="form-grid">
                    <NumericInput
                      id={`${idBase}-note`}
                      label="Litres on the note"
                      unit="L"
                      value={compartment.noteLitres}
                      disabled={!editable}
                      onChange={(event) =>
                        updateCompartment(index, { noteLitres: event.target.value })
                      }
                    />
                    <NumericInput
                      id={`${idBase}-received`}
                      label="Litres received"
                      unit="L"
                      value={compartment.receivedLitres}
                      disabled={!editable}
                      onChange={(event) =>
                        updateCompartment(index, { receivedLitres: event.target.value })
                      }
                    />
                  </div>
                  {variance.label ? (
                    <p>
                      <StatusBadge tone={variance.tone === 'ok' ? 'positive' : 'warning'}>
                        {variance.label}
                      </StatusBadge>
                    </p>
                  ) : null}
                  <div className="stack-sm">
                    <p className="table-secondary">
                      Seal numbers. Leave this empty if the compartment had no seal.
                    </p>
                    {compartment.seals.map((seal, sealIndex) => (
                      <div className="form-grid" key={sealIndex}>
                        <Field id={`${idBase}-seal-${sealIndex}`} label="Seal number">
                          <input
                            id={`${idBase}-seal-${sealIndex}`}
                            type="text"
                            maxLength={80}
                            value={seal.sealNumber}
                            disabled={!editable}
                            onChange={(event) =>
                              updateCompartment(index, {
                                seals: compartment.seals.map((existing, position) =>
                                  position === sealIndex
                                    ? { ...existing, sealNumber: event.target.value }
                                    : existing,
                                ),
                              })
                            }
                          />
                        </Field>
                        <Checkbox
                          label="The seal was unbroken"
                          checked={seal.intact}
                          disabled={!editable}
                          onChange={(event) =>
                            updateCompartment(index, {
                              seals: compartment.seals.map((existing, position) =>
                                position === sealIndex
                                  ? { ...existing, intact: event.target.checked }
                                  : existing,
                              ),
                            })
                          }
                        />
                        {editable ? (
                          <Button
                            variant="quiet"
                            onClick={() =>
                              updateCompartment(index, {
                                seals: compartment.seals.filter(
                                  (_, position) => position !== sealIndex,
                                ),
                              })
                            }
                          >
                            Remove this seal
                          </Button>
                        ) : null}
                      </div>
                    ))}
                    {editable ? (
                      <div className="cluster">
                        <Button
                          variant="secondary"
                          onClick={() =>
                            updateCompartment(index, {
                              seals: [...compartment.seals, { sealNumber: '', intact: true }],
                            })
                          }
                        >
                          Add a seal
                        </Button>
                        {compartments.length > 1 ? (
                          <Button
                            variant="quiet"
                            onClick={() =>
                              setCompartments((current) =>
                                current.filter((_, position) => position !== index),
                              )
                            }
                          >
                            Remove this compartment
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
        <p>
          Compartments add up to{' '}
          <strong>{totalNote === null ? '—' : formatLitres(totalNote)}</strong> on the note
          {totalNote !== null && !noteMatches
            ? ` (the note says ${formatLitres(delivery.noteLitres)})`
            : ''}{' '}
          and <strong>{totalReceived === null ? '—' : formatLitres(totalReceived)}</strong> received
          {totalReceived !== null && !receivedMatches
            ? ` (the delivery says ${formatLitres(delivery.receivedLitres)})`
            : ''}
          .
        </p>
        {editable ? (
          <div className="form-actions">
            <Button
              variant="secondary"
              onClick={() =>
                setCompartments((current) => [
                  ...current,
                  {
                    key: Math.max(0, ...current.map((item) => item.key)) + 1,
                    noteLitres: '',
                    receivedLitres: '',
                    seals: [],
                  },
                ])
              }
            >
              Add a compartment
            </Button>
            <Button
              loading={busy === 'compartments'}
              disabled={!noteMatches || !receivedMatches}
              onClick={() =>
                void run('compartments', 'The compartments were saved.', () =>
                  send('RecordDeliveryCompartments', {
                    ...ids,
                    compartments: compartments.map((item, index) => ({
                      compartmentNumber: index + 1,
                      productId: delivery.productId,
                      noteLitres: item.noteLitres.trim(),
                      receivedLitres: item.receivedLitres.trim(),
                      seals: item.seals,
                    })),
                  }),
                )
              }
            >
              Save compartments
            </Button>
          </div>
        ) : null}
      </Card>

      <Card className="form-panel">
        <h2>Water test</h2>
        <p className="table-secondary">
          {data.waterTestRequired
            ? 'Your owner needs a water test recorded before this delivery can be confirmed.'
            : 'Record the water test when it is done. It does not stop the delivery from being confirmed.'}
        </p>
        {data.waterTest?.result === 'FAIL' ? (
          <Notice tone="warning" title="The water test failed">
            Tell the manager before the fuel goes into a tank.
          </Notice>
        ) : null}
        <div className="form-stack">
          <Field id="water-result" label="Result">
            <Select
              id="water-result"
              placeholder="Choose the result"
              value={water.result}
              disabled={!editable}
              options={[
                { value: 'PASS', label: 'Passed, no water found' },
                { value: 'FAIL', label: 'Failed, water found' },
              ]}
              onChange={(event) => setWater({ ...water, result: event.target.value })}
            />
          </Field>
          <NumericInput
            id="water-reading"
            label="Water found"
            optional
            unit="mm"
            hint="The reading on the water-finding paste or stick, if you have one."
            value={water.reading}
            disabled={!editable}
            onChange={(event) => setWater({ ...water, reading: event.target.value })}
          />
          <Field id="water-notes" label="Notes" optional>
            <textarea
              id="water-notes"
              maxLength={500}
              rows={2}
              value={water.notes}
              disabled={!editable}
              onChange={(event) => setWater({ ...water, notes: event.target.value })}
            />
          </Field>
        </div>
        {data.waterTest ? (
          <p className="table-secondary">
            Tested {stationDateTime(data.waterTest.testedAt, data.stationTimezone)}.
          </p>
        ) : null}
        {editable ? (
          <div className="form-actions">
            <Button
              loading={busy === 'water'}
              disabled={water.result !== 'PASS' && water.result !== 'FAIL'}
              onClick={() =>
                void run('water', 'The water test was saved.', () =>
                  send('RecordDeliveryWaterTest', {
                    ...ids,
                    result: water.result,
                    waterReadingMm: water.reading.trim() === '' ? null : water.reading.trim(),
                    notes: water.notes.trim() === '' ? null : water.notes.trim(),
                  }),
                )
              }
            >
              Save water test
            </Button>
          </div>
        ) : null}
      </Card>

      <Card className="form-panel">
        <h2>Driver confirmation</h2>
        <p className="table-secondary">
          This is the driver saying the details are right. It is kept apart from your own
          confirmation of the delivery. No signature is needed.
        </p>
        <div className="form-stack">
          <Field id="driver-name" label="Driver's name" required>
            <input
              id="driver-name"
              type="text"
              maxLength={120}
              value={driver.name}
              disabled={delivery.status === 'CANCELLED'}
              onChange={(event) => setDriver({ ...driver, name: event.target.value })}
            />
          </Field>
          <Checkbox
            label="The driver confirms these details are correct"
            checked={driver.confirmed}
            disabled={delivery.status === 'CANCELLED'}
            onChange={(event) => setDriver({ ...driver, confirmed: event.target.checked })}
          />
          <Field id="driver-notes" label="Notes" optional>
            <textarea
              id="driver-notes"
              maxLength={500}
              rows={2}
              value={driver.notes}
              disabled={delivery.status === 'CANCELLED'}
              onChange={(event) => setDriver({ ...driver, notes: event.target.value })}
            />
          </Field>
        </div>
        {data.driverConfirmation?.confirmed && data.driverConfirmation.confirmedAt ? (
          <p className="table-secondary">
            Driver confirmed{' '}
            {stationDateTime(data.driverConfirmation.confirmedAt, data.stationTimezone)}.
          </p>
        ) : null}
        {delivery.status !== 'CANCELLED' ? (
          <div className="form-actions">
            <Button
              loading={busy === 'driver'}
              disabled={driver.name.trim() === ''}
              onClick={() =>
                void run('driver', 'The driver confirmation was saved.', () =>
                  send('RecordDeliveryDriverConfirmation', {
                    ...ids,
                    driverName: driver.name,
                    confirmed: driver.confirmed,
                    notes: driver.notes.trim() === '' ? null : driver.notes.trim(),
                  }),
                )
              }
            >
              Save driver confirmation
            </Button>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
