'use client';

import Decimal from 'decimal.js';
import Link from 'next/link';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Notice } from '@/design-system/feedback';
import { Checkbox, Select } from '@/design-system/forms';
import { formatLitres } from '@/design-system/formatters';
import { useToast } from '@/design-system/feedback-provider';
import { Modal } from '@/design-system/modal';
import { Button, StatusBadge } from '@/design-system/primitives';
import { StepUpDialog } from '../../setup/ui/step-up-dialog';
import { RecordDelivery, type DeliveryEdit } from './record-delivery';
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
type WaterDraft = { result: string; reading: string; notes: string };
type DriverDraft = { name: string; confirmed: boolean; notes: string };

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

/** The compartments without their React keys, for comparing what is typed with what is saved. */
const compartmentContent = (drafts: readonly CompartmentDraft[]) =>
  JSON.stringify(
    drafts.map((item) => ({
      noteLitres: item.noteLitres.trim(),
      receivedLitres: item.receivedLitres.trim(),
      seals: item.seals,
    })),
  );

const waterFrom = (data: DeliveryDetail): WaterDraft => ({
  result: data.waterTest?.result ?? '',
  reading: data.waterTest?.waterReadingMm ?? '',
  notes: data.waterTest?.notes ?? '',
});

const driverFrom = (data: DeliveryDetail): DriverDraft => ({
  name: data.driverConfirmation?.driverName ?? data.delivery.driver ?? '',
  confirmed: data.driverConfirmation?.confirmed ?? false,
  notes: data.driverConfirmation?.notes ?? '',
});

/** Litres without trailing zeros, the way a person types them: "5000.000" becomes "5000". */
function plainLitres(value: string): string {
  const text = new Decimal(value).toDecimalPlaces(3).toFixed();
  return text.includes('.') ? text.replace(/\.?0+$/, '') : text;
}

/** What the Edit form starts with: exactly what is saved on this delivery now. */
function editStart(data: DeliveryDetail): DeliveryEdit['start'] {
  const { delivery } = data;
  return {
    supplierId: delivery.supplierId ?? '',
    tankId: delivery.tankId ?? '',
    deliveryNote: delivery.deliveryNoteNumber,
    deliveredAt: delivery.deliveredAt,
    noteLitres: plainLitres(delivery.noteLitres),
    receivedLitres: plainLitres(delivery.receivedLitres),
    transporter: delivery.transporter ?? '',
    driver: data.driverConfirmation?.driverName ?? delivery.driver ?? '',
    truck: delivery.truckRegistration ?? '',
    compartments: data.compartments.map((row) => ({
      number: row.compartmentNumber,
      noteLitres: plainLitres(row.noteLitres),
      receivedLitres: plainLitres(row.receivedLitres),
      seals: row.seals.map((seal) => seal.sealNumber).join(', '),
    })),
    water: data.waterTest?.result ?? '',
    waterMm: data.waterTest?.waterReadingMm ?? '',
    driverConfirmed: data.driverConfirmation?.confirmed ?? false,
    noPo: delivery.noPoReason ?? '',
    noPoNote: delivery.noPoNote ?? '',
  };
}

const NO_PO_REASONS: Record<string, string> = {
  EMERGENCY_PURCHASE: 'Emergency purchase',
  CASH_PURCHASE: 'Bought for cash',
  SUPPLIER_DIRECT: 'The supplier delivered without an order',
  PO_NOT_RAISED: 'The order was not raised in time',
  OTHER: 'Another reason',
};

const WATER_RESULTS = [
  { value: 'PASS', label: 'Passed, no water found' },
  { value: 'FAIL', label: 'Failed, water found' },
] as const;

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

/** A failed command carries the server's error code, so a fresh identity check can be asked for. */
class CommandError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

async function send(
  commandType: string,
  body: Record<string, unknown>,
  options: { url?: string; key?: string } = {},
): Promise<void> {
  const response = await fetch(options.url ?? '/api/deliveries/commands', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': options.key ?? crypto.randomUUID(),
    },
    body: JSON.stringify({ commandType, ...body }),
  });
  const result = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
  if (!response.ok) {
    throw new CommandError(
      result.message || 'That could not be saved. Check what you typed and try again.',
      result.error,
    );
  }
}

/** One labelled line of the document: the label on the left, the value or its field on the right. */
function Line({
  label,
  hint,
  htmlFor,
  wide = false,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  /** Spans the whole row instead of one column. */
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={wide ? 'dd-line dd-line-wide' : 'dd-line'}>
      <dt>{htmlFor ? <label htmlFor={htmlFor}>{label}</label> : label}</dt>
      <dd>
        {children}
        {hint ? <span className="dd-hint">{hint}</span> : null}
      </dd>
    </div>
  );
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
  const cancelled = delivery.status === 'CANCELLED';
  /** Compartments and the water test lock once the delivery is confirmed or cancelled. */
  const canEdit = delivery.status === 'DRAFT';
  /** The driver's confirmation stays open until the delivery is cancelled. */
  const canEditDriver = !cancelled;
  /** The page reads like a document; the fields only open once the person presses Edit. */
  const [editing, setEditing] = useState(false);
  const editable = editing && canEdit;
  const driverEditable = editing && canEditDriver;
  const [compartments, setCompartments] = useState(() => toDrafts(initialData));
  const [water, setWater] = useState(() => waterFrom(initialData));
  const [driver, setDriver] = useState(() => driverFrom(initialData));
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const [formOpen, setFormOpen] = useState(false);
  /** A delivery going into several tanks cannot be edited as one form. */
  const canEditForm = data.canConfirm && data.delivery.tankId !== null;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  /** One key per confirm attempt, so a retry after the identity check is not a second confirm. */
  const confirmKey = useRef(crypto.randomUUID());
  const [message, setMessage] = useState<{ tone: 'positive' | 'critical'; text: string } | null>(
    null,
  );
  const ids = { tenantId: context.tenantId, stationId: context.stationId, deliveryId: delivery.id };

  const saved = useMemo(
    () => ({
      compartments: compartmentContent(toDrafts(data)),
      water: JSON.stringify(waterFrom(data)),
      driver: JSON.stringify(driverFrom(data)),
    }),
    [data],
  );
  const compartmentsChanged = editable && compartmentContent(compartments) !== saved.compartments;
  const waterChanged = editable && JSON.stringify(water) !== saved.water;
  const driverChanged = driverEditable && JSON.stringify(driver) !== saved.driver;
  const hasChanges = compartmentsChanged || waterChanged || driverChanged;

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
    setWater(waterFrom(body.data));
    setDriver(driverFrom(body.data));
  }

  const totalNote = sum(compartments.map((item) => item.noteLitres));
  const totalReceived = sum(compartments.map((item) => item.receivedLitres));
  const noteMatches = totalNote !== null && new Decimal(totalNote).eq(delivery.noteLitres);
  const receivedMatches =
    totalReceived !== null && new Decimal(totalReceived).eq(delivery.receivedLitres);

  /** Checks everything that changed before sending, so nothing is half saved over a typing slip. */
  function problem(): string | null {
    if (compartmentsChanged && (!noteMatches || !receivedMatches)) {
      return `The compartments must add up to ${formatLitres(delivery.noteLitres)} on the note and ${formatLitres(delivery.receivedLitres)} received. Check the litres in every compartment.`;
    }
    if (waterChanged && water.result !== 'PASS' && water.result !== 'FAIL') {
      return 'Choose the water test result before saving.';
    }
    if (driverChanged && driver.name.trim() === '') {
      return "Type the driver's name before saving.";
    }
    return null;
  }

  /** Confirming puts the fuel on the tank's books, so it asks first and may need an identity check. */
  async function confirmDelivery() {
    setConfirming(true);
    setMessage(null);
    try {
      await send(
        'ConfirmDelivery',
        { ...ids },
        { url: '/api/inventory/commands', key: confirmKey.current },
      );
      confirmKey.current = crypto.randomUUID();
      setConfirmOpen(false);
      await reload();
      const done = `Delivery ${delivery.deliveryNoteNumber} is confirmed. ${formatLitres(delivery.receivedLitres)} of ${delivery.productName} is now on the tank's books.`;
      toast.success(done);
      setMessage({ tone: 'positive', text: done });
      // The banner sits above the sheet, so bring it into view if the person had scrolled down.
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      setConfirmOpen(false);
      if (error instanceof CommandError && error.code === 'STEP_UP_REQUIRED') {
        setStepUpOpen(true);
      } else {
        setMessage({
          tone: 'critical',
          text: error instanceof Error ? error.message : 'The delivery could not be confirmed.',
        });
      }
    } finally {
      setConfirming(false);
    }
  }

  async function saveChanges() {
    const found = problem();
    if (found) {
      setMessage({ tone: 'critical', text: found });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      if (compartmentsChanged) {
        await send('RecordDeliveryCompartments', {
          ...ids,
          compartments: compartments.map((item, index) => ({
            compartmentNumber: index + 1,
            productId: delivery.productId,
            noteLitres: item.noteLitres.trim(),
            receivedLitres: item.receivedLitres.trim(),
            seals: item.seals,
          })),
        });
      }
      if (waterChanged) {
        await send('RecordDeliveryWaterTest', {
          ...ids,
          result: water.result,
          waterReadingMm: water.reading.trim() === '' ? null : water.reading.trim(),
          notes: water.notes.trim() === '' ? null : water.notes.trim(),
        });
      }
      if (driverChanged) {
        await send('RecordDeliveryDriverConfirmation', {
          ...ids,
          driverName: driver.name,
          confirmed: driver.confirmed,
          notes: driver.notes.trim() === '' ? null : driver.notes.trim(),
        });
      }
      await reload();
      toast.success('Your changes were saved.');
      setMessage({ tone: 'positive', text: 'Your changes were saved.' });
      setEditing(false);
    } catch (error) {
      setMessage({
        tone: 'critical',
        text: error instanceof Error ? error.message : 'That could not be saved.',
      });
    } finally {
      setBusy(false);
    }
  }

  function discardChanges() {
    setCompartments(toDrafts(data));
    setWater(waterFrom(data));
    setDriver(driverFrom(data));
    setMessage(null);
    setEditing(false);
  }

  const updateCompartment = (index: number, change: Partial<CompartmentDraft>) =>
    setCompartments((current) =>
      current.map((item, position) => (position === index ? { ...item, ...change } : item)),
    );
  const updateSeal = (index: number, sealIndex: number, change: Partial<SealDraft>) =>
    updateCompartment(index, {
      seals: (compartments[index]?.seals ?? []).map((existing, position) =>
        position === sealIndex ? { ...existing, ...change } : existing,
      ),
    });

  const receiptBadge =
    delivery.receipt === 'PARTIAL' ? (
      <StatusBadge tone="warning">Partial delivery</StatusBadge>
    ) : delivery.receipt === 'EXCESS' ? (
      <StatusBadge tone="warning">More than the note</StatusBadge>
    ) : (
      <StatusBadge tone="positive">Matches the note</StatusBadge>
    );
  const statusBadge = (
    <StatusBadge tone={delivery.status === 'CONFIRMED' ? 'positive' : 'pending'}>
      {delivery.status === 'CONFIRMED'
        ? 'Confirmed'
        : cancelled
          ? 'Cancelled'
          : 'Not confirmed yet'}
    </StatusBadge>
  );
  const difference = varianceText(delivery.noteLitres, delivery.receivedLitres);
  const stateLine = editing
    ? 'You are editing this delivery. Save your changes when you are done, or cancel to leave it as it was.'
    : canEdit
      ? 'This delivery is not confirmed yet. Press Edit to fill in or change the details.'
      : cancelled
        ? 'This delivery was cancelled. It can only be read.'
        : 'This delivery is confirmed and locked. It can only be read, but the driver confirmation can still be updated.';
  const compartmentsBadge =
    totalNote === null || totalReceived === null ? (
      <StatusBadge tone="pending">Not filled in</StatusBadge>
    ) : noteMatches && receivedMatches ? (
      <StatusBadge tone="positive">Adds up</StatusBadge>
    ) : (
      <StatusBadge tone="warning">Does not add up</StatusBadge>
    );
  const waterBadge = data.waterTest ? (
    data.waterTest.result === 'PASS' ? (
      <StatusBadge tone="positive">Passed</StatusBadge>
    ) : (
      <StatusBadge tone="warning">Failed</StatusBadge>
    )
  ) : data.waterTestRequired ? (
    <StatusBadge tone="warning">Needed before confirming</StatusBadge>
  ) : (
    <StatusBadge tone="pending">Not recorded</StatusBadge>
  );
  const driverBadge = data.driverConfirmation?.confirmed ? (
    <StatusBadge tone="positive">Confirmed</StatusBadge>
  ) : (
    <StatusBadge tone="pending">Not confirmed</StatusBadge>
  );
  const compartmentsAddUp = data.compartments.length > 0;
  const purchasingHref = listHref.replace('/inventory/deliveries', '/purchasing');
  const purchaseOrderMissing =
    delivery.purchaseOrderNumber === null && delivery.noPoReason === null;
  /** What the server would refuse over, said up front so the button is never a dead end. */
  const blockers: { title: string; text: string; href?: string }[] = [];
  if (delivery.supplierName === null) {
    blockers.push({
      title: 'No supplier is recorded',
      text: 'Every delivery must say who delivered the fuel before it can be confirmed.',
    });
  }
  if (purchaseOrderMissing) {
    blockers.push({
      title: 'This delivery has no purchase order',
      text: 'Link it to a purchase order, or record why there is none, before confirming it.',
      href: purchasingHref,
    });
  }
  if (data.waterTestRequired && data.waterTest === null) {
    blockers.push({
      title: 'A water test is needed first',
      text: 'Your owner needs a water test on record before a delivery can be confirmed. Close this, press Edit and record it.',
    });
  }
  const purchaseOrderLine = delivery.purchaseOrderNumber ? (
    `Order ${delivery.purchaseOrderNumber}`
  ) : delivery.noPoReason ? (
    `None. ${NO_PO_REASONS[delivery.noPoReason] ?? 'Recorded without an order'}`
  ) : canEdit ? (
    <>
      <span className="dd-diff" data-tone="bad">
        Not linked, and no reason recorded.
      </span>{' '}
      <Link href={purchasingHref}>Open Purchasing to link one</Link>
    </>
  ) : (
    <span className="dd-empty">None</span>
  );
  const notRecorded = <span className="dd-empty">Not recorded</span>;
  const waterLabel = WATER_RESULTS.find((item) => item.value === water.result)?.label;

  return (
    <div className="pg dd-page">
      <div className="dd-toolbar">
        <Link className="back-link" href={listHref}>
          ← All deliveries
        </Link>
        <div className="dd-toolbar-actions">
          <Button variant="secondary" size="sm" onClick={() => window.print()}>
            Print
          </Button>
          {canEdit && canEditForm ? (
            <Button variant="secondary" size="sm" onClick={() => setFormOpen(true)}>
              Edit
            </Button>
          ) : null}
          {!canEdit && !editing && canEditDriver ? (
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              Update driver confirmation
            </Button>
          ) : null}
          {!editing && canEdit && data.canConfirm ? (
            <Button size="sm" onClick={() => setConfirmOpen(true)}>
              Confirm delivery
            </Button>
          ) : null}
        </div>
      </div>

      <p className="dd-state" data-editable={editable ? 'true' : undefined}>
        {stateLine}
      </p>

      {message ? (
        <Notice tone={message.tone === 'positive' ? 'positive' : 'critical'}>{message.text}</Notice>
      ) : null}

      <article className="dd-sheet" aria-label={`Delivery ${delivery.deliveryNoteNumber}`}>
        <header className="dd-sheet-head">
          <div>
            <p className="dd-kicker">Fuel delivery record</p>
            <h2>Delivery {delivery.deliveryNoteNumber}</h2>
            <p className="dd-station">{context.stationName}</p>
          </div>
          <div className="pg-badges">
            {receiptBadge}
            {statusBadge}
          </div>
        </header>

        <section className="dd-section" aria-labelledby="dd-s1">
          <div className="dd-section-head">
            <h3 id="dd-s1">1. The delivery</h3>
          </div>
          <dl className="dd-lines dd-lines-3">
            <Line label="Fuel">{delivery.productName}</Line>
            <Line label="Supplier">{delivery.supplierName ?? notRecorded}</Line>
            <Line label="Delivered">
              {stationDateTime(delivery.deliveredAt, data.stationTimezone)}
            </Line>
            <Line label="Transporter">{delivery.transporter ?? notRecorded}</Line>
            <Line label="Truck">{delivery.truckRegistration ?? notRecorded}</Line>
            <Line label="Driver">{delivery.driver ?? notRecorded}</Line>
            <Line label="On the delivery note">{formatLitres(delivery.noteLitres)}</Line>
            <Line label="Received" hint={difference.tone === 'bad' ? difference.label : undefined}>
              {formatLitres(delivery.receivedLitres)}
            </Line>
            <Line label="Business day">
              {new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(
                new Date(`${delivery.businessDate}T00:00:00Z`),
              )}
            </Line>
            <Line label="Purchase order" wide>
              {purchaseOrderLine}
            </Line>
          </dl>
        </section>

        <section className="dd-section" aria-labelledby="dd-s2">
          <div className="dd-section-head">
            <h3 id="dd-s2">2. Truck compartments</h3>
            {compartmentsBadge}
          </div>
          <p className="dd-intro">
            One line per truck compartment. Together they must match the litres on the note and the
            litres received.
          </p>
          <table className="dd-table">
            <thead>
              <tr>
                <th scope="col">Compartment</th>
                <th scope="col">On the note</th>
                <th scope="col">Received</th>
                <th scope="col">Difference</th>
                <th scope="col">Seals</th>
              </tr>
            </thead>
            <tbody>
              {compartments.map((compartment, index) => {
                const variance = varianceText(compartment.noteLitres, compartment.receivedLitres);
                const hasValues =
                  compartment.noteLitres !== '' || compartment.receivedLitres !== '';
                return (
                  <tr key={compartment.key}>
                    <th scope="row" data-label="Compartment">
                      {index + 1}
                      {editable && compartments.length > 1 ? (
                        <button
                          type="button"
                          className="dd-link"
                          onClick={() =>
                            setCompartments((current) =>
                              current.filter((_, position) => position !== index),
                            )
                          }
                        >
                          Remove
                        </button>
                      ) : null}
                    </th>
                    <td data-label="On the note">
                      {editable ? (
                        <span className="dd-input">
                          <input
                            aria-label={`Compartment ${index + 1}, litres on the note`}
                            inputMode="decimal"
                            value={compartment.noteLitres}
                            onChange={(event) =>
                              updateCompartment(index, { noteLitres: event.target.value })
                            }
                          />
                          <span>L</span>
                        </span>
                      ) : hasValues ? (
                        formatLitres(compartment.noteLitres)
                      ) : (
                        notRecorded
                      )}
                    </td>
                    <td data-label="Received">
                      {editable ? (
                        <span className="dd-input">
                          <input
                            aria-label={`Compartment ${index + 1}, litres received`}
                            inputMode="decimal"
                            value={compartment.receivedLitres}
                            onChange={(event) =>
                              updateCompartment(index, { receivedLitres: event.target.value })
                            }
                          />
                          <span>L</span>
                        </span>
                      ) : hasValues ? (
                        formatLitres(compartment.receivedLitres)
                      ) : (
                        notRecorded
                      )}
                    </td>
                    <td data-label="Difference">
                      {variance.label ? (
                        <span className="dd-diff" data-tone={variance.tone}>
                          {variance.label}
                        </span>
                      ) : (
                        <span className="dd-empty">—</span>
                      )}
                    </td>
                    <td data-label="Seals">
                      <ul className="dd-seals">
                        {compartment.seals.map((seal, sealIndex) => (
                          <li key={sealIndex}>
                            {editable ? (
                              <>
                                <input
                                  aria-label={`Compartment ${index + 1}, seal ${sealIndex + 1} number`}
                                  type="text"
                                  maxLength={80}
                                  placeholder="Seal number"
                                  value={seal.sealNumber}
                                  onChange={(event) =>
                                    updateSeal(index, sealIndex, { sealNumber: event.target.value })
                                  }
                                />
                                <Checkbox
                                  label="Unbroken"
                                  checked={seal.intact}
                                  onChange={(event) =>
                                    updateSeal(index, sealIndex, { intact: event.target.checked })
                                  }
                                />
                                <button
                                  type="button"
                                  className="dd-link"
                                  onClick={() =>
                                    updateCompartment(index, {
                                      seals: compartment.seals.filter(
                                        (_, position) => position !== sealIndex,
                                      ),
                                    })
                                  }
                                >
                                  Remove
                                </button>
                              </>
                            ) : (
                              <>
                                {seal.sealNumber}{' '}
                                <span className="dd-diff" data-tone={seal.intact ? 'ok' : 'bad'}>
                                  {seal.intact ? 'unbroken' : 'broken'}
                                </span>
                              </>
                            )}
                          </li>
                        ))}
                        {compartment.seals.length === 0 && !editable ? (
                          <li className="dd-empty">No seals</li>
                        ) : null}
                      </ul>
                      {editable ? (
                        <button
                          type="button"
                          className="dd-link"
                          onClick={() =>
                            updateCompartment(index, {
                              seals: [...compartment.seals, { sealNumber: '', intact: true }],
                            })
                          }
                        >
                          + Add a seal
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Together</th>
                <td data-label="On the note">
                  {totalNote === null ? '—' : formatLitres(totalNote)}
                </td>
                <td data-label="Received">
                  {totalReceived === null ? '—' : formatLitres(totalReceived)}
                </td>
                <td colSpan={2} data-label="Check">
                  {totalNote === null || totalReceived === null ? (
                    <span className="dd-empty">
                      {editable
                        ? 'Fill in every compartment to see the total.'
                        : 'No compartments recorded yet.'}
                    </span>
                  ) : noteMatches && receivedMatches ? (
                    <span className="dd-diff" data-tone="ok">
                      Adds up to the delivery
                    </span>
                  ) : (
                    <span className="dd-diff" data-tone="bad" role="status">
                      {[
                        noteMatches
                          ? null
                          : `The note total should be ${formatLitres(delivery.noteLitres)}`,
                        receivedMatches
                          ? null
                          : `The received total should be ${formatLitres(delivery.receivedLitres)}`,
                      ]
                        .filter(Boolean)
                        .join('. ')}
                      .
                    </span>
                  )}
                </td>
              </tr>
            </tfoot>
          </table>
          {editable ? (
            <button
              type="button"
              className="dd-link dd-add"
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
              + Add a compartment
            </button>
          ) : null}
        </section>

        <div className="dd-pair">
          <section className="dd-section" aria-labelledby="dd-s3">
            <div className="dd-section-head">
              <h3 id="dd-s3">3. Water test</h3>
              {waterBadge}
            </div>
            <p className="dd-intro">
              {data.waterTestRequired
                ? 'Your owner needs a water test recorded before this delivery can be confirmed.'
                : 'Record the water test when it is done. It does not stop the delivery from being confirmed.'}
            </p>
            {data.waterTest?.result === 'FAIL' ? (
              <Notice tone="warning" title="The water test failed">
                Tell the manager before the fuel goes into a tank.
              </Notice>
            ) : null}
            <dl className="dd-lines">
              <Line label="Result" htmlFor="water-result">
                {editable ? (
                  <Select
                    id="water-result"
                    placeholder="Choose the result"
                    value={water.result}
                    options={WATER_RESULTS}
                    onChange={(event) => setWater({ ...water, result: event.target.value })}
                  />
                ) : (
                  (waterLabel ?? <span className="dd-empty">Not tested</span>)
                )}
              </Line>
              <Line
                label="Water found"
                htmlFor="water-reading"
                hint={
                  editable
                    ? 'The reading on the water-finding paste or stick, if you have one.'
                    : undefined
                }
              >
                {editable ? (
                  <span className="dd-input">
                    <input
                      id="water-reading"
                      inputMode="decimal"
                      value={water.reading}
                      onChange={(event) => setWater({ ...water, reading: event.target.value })}
                    />
                    <span>mm</span>
                  </span>
                ) : water.reading !== '' ? (
                  `${water.reading} mm`
                ) : (
                  notRecorded
                )}
              </Line>
              <Line label="Notes" htmlFor="water-notes">
                {editable ? (
                  <textarea
                    id="water-notes"
                    maxLength={500}
                    rows={2}
                    value={water.notes}
                    onChange={(event) => setWater({ ...water, notes: event.target.value })}
                  />
                ) : (
                  water.notes || <span className="dd-empty">None</span>
                )}
              </Line>
              {data.waterTest ? (
                <Line label="Tested">
                  {stationDateTime(data.waterTest.testedAt, data.stationTimezone)}
                </Line>
              ) : null}
            </dl>
          </section>

          <section className="dd-section" aria-labelledby="dd-s4">
            <div className="dd-section-head">
              <h3 id="dd-s4">4. Driver confirmation</h3>
              {driverBadge}
            </div>
            <p className="dd-intro">
              This is the driver saying the details are right. It is kept apart from your own
              confirmation of the delivery. No signature is needed.
            </p>
            <dl className="dd-lines">
              <Line label="Driver's name" htmlFor="driver-name">
                {driverEditable ? (
                  <input
                    id="driver-name"
                    type="text"
                    maxLength={120}
                    value={driver.name}
                    onChange={(event) => setDriver({ ...driver, name: event.target.value })}
                  />
                ) : (
                  driver.name || notRecorded
                )}
              </Line>
              <Line label="Details confirmed">
                {driverEditable ? (
                  <Checkbox
                    label="The driver confirms these details are correct"
                    checked={driver.confirmed}
                    onChange={(event) => setDriver({ ...driver, confirmed: event.target.checked })}
                  />
                ) : driver.confirmed ? (
                  'Yes, the driver confirmed the details'
                ) : (
                  'Not confirmed by the driver'
                )}
                {data.driverConfirmation?.confirmed && data.driverConfirmation.confirmedAt ? (
                  <span className="dd-hint">
                    Confirmed{' '}
                    {stationDateTime(data.driverConfirmation.confirmedAt, data.stationTimezone)}
                  </span>
                ) : null}
              </Line>
              <Line label="Notes" htmlFor="driver-notes">
                {driverEditable ? (
                  <textarea
                    id="driver-notes"
                    maxLength={500}
                    rows={2}
                    value={driver.notes}
                    onChange={(event) => setDriver({ ...driver, notes: event.target.value })}
                  />
                ) : (
                  driver.notes || <span className="dd-empty">None</span>
                )}
              </Line>
            </dl>
          </section>
        </div>
      </article>

      {editing ? (
        <div className="dd-savebar" role="region" aria-label="Editing this delivery">
          <p>{hasChanges ? 'You have changes that are not saved yet.' : 'Nothing changed yet.'}</p>
          <div className="dd-savebar-actions">
            <Button variant="quiet" disabled={busy} onClick={discardChanges}>
              Cancel
            </Button>
            <Button loading={busy} disabled={!hasChanges} onClick={() => void saveChanges()}>
              Save changes
            </Button>
          </div>
        </div>
      ) : null}

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title="Edit delivery"
        presentation="side"
        size="lg"
      >
        {canEditForm && delivery.tankId ? (
          <RecordDelivery
            framed={false}
            tenantId={context.tenantId}
            stationId={context.stationId}
            tanks={data.tanks}
            edit={{
              deliveryId: delivery.id,
              productId: delivery.productId,
              start: editStart(data),
              onSaved: () => {
                setFormOpen(false);
                void reload().then(() => {
                  toast.success('Your changes were saved.');
                  setMessage({ tone: 'positive', text: 'Your changes were saved.' });
                });
              },
            }}
          />
        ) : null}
      </Modal>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Confirm this delivery?"
        description={`This puts ${formatLitres(delivery.receivedLitres)} of ${delivery.productName} on the tank's books and records you as the person who checked the delivery. The compartments and water test can no longer be changed afterwards.`}
        size="sm"
        footer={
          <>
            <Button variant="quiet" disabled={confirming} onClick={() => setConfirmOpen(false)}>
              Not yet
            </Button>
            <Button
              loading={confirming}
              disabled={blockers.length > 0}
              onClick={() => void confirmDelivery()}
            >
              Confirm delivery
            </Button>
          </>
        }
      >
        {blockers.map((blocker) => (
          <Notice key={blocker.title} tone="warning" title={blocker.title}>
            {blocker.text}
            {blocker.href ? (
              <>
                {' '}
                <Link href={blocker.href}>Open Purchasing</Link>
              </>
            ) : null}
          </Notice>
        ))}
        {blockers.length === 0 && !compartmentsAddUp ? (
          <Notice tone="warning" title="The compartments are not filled in">
            You can still confirm, but the litres per truck compartment are not on the record.
          </Notice>
        ) : null}
      </Modal>

      <StepUpDialog
        open={stepUpOpen}
        tenantId={context.tenantId}
        description="Confirming this delivery needs a fresh identity check. Nothing is confirmed until you do."
        confirmLabel="Confirm and continue"
        onCancel={() => setStepUpOpen(false)}
        onVerified={() => {
          setStepUpOpen(false);
          void confirmDelivery();
        }}
      />
    </div>
  );
}
