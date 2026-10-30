'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, ErrorState, Field, SuccessState } from '@/design-system/primitives';
import { DocumentAttachments } from '../../documents/ui/document-attachments';
import { StepUpDialog } from '../../setup/ui/step-up-dialog';
import type { DeliveryTank } from '../queries';
import {
  clearDraft,
  draftStorageKey,
  loadDraft,
  saveDraft,
} from '../../../platform/drafts/local-draft';
import { compartmentSumProblem, shortageOrExcess, type CompartmentRow } from '../record-delivery';

export const NO_PO_REASONS = [
  { value: '', label: 'I will link a purchase order later' },
  { value: 'EMERGENCY_PURCHASE', label: 'No purchase order: emergency purchase' },
  { value: 'CASH_PURCHASE', label: 'No purchase order: bought for cash' },
  { value: 'SUPPLIER_DIRECT', label: 'No purchase order: supplier delivered without an order' },
  { value: 'PO_NOT_RAISED', label: 'No purchase order: the order was not raised in time' },
  { value: 'OTHER', label: 'No purchase order: another reason' },
] as const;

type Failure = { message: string; code?: string; status?: number; step?: 'confirm' };
/** What is typed so far, kept on this device so a dropped connection does not lose it. */
type DeliveryDraft = {
  supplierId: string;
  tankId: string;
  deliveryNote: string;
  noteLitres: string;
  receivedLitres: string;
  transporter: string;
  driver: string;
  truck: string;
  dipBefore: string;
  dipAfter: string;
  compartments: CompartmentRow[];
  water: '' | 'PASS' | 'FAIL';
  waterMm: string;
  noPo: string;
  noPoNote: string;
};
/** Everything the form starts with when it edits a delivery that is already recorded. */
export type DeliveryEdit = Readonly<{
  deliveryId: string;
  /** The fuel cannot change, so only tanks of this product are offered. */
  productId: string;
  start: Readonly<{
    supplierId: string;
    tankId: string;
    deliveryNote: string;
    /** When it arrived, as an ISO time. */
    deliveredAt: string;
    noteLitres: string;
    receivedLitres: string;
    transporter: string;
    driver: string;
    truck: string;
    compartments: readonly CompartmentRow[];
    water: '' | 'PASS' | 'FAIL';
    waterMm: string;
    driverConfirmed: boolean;
    noPo: string;
    noPoNote: string;
  }>;
  /** Called once every changed step has been saved. */
  onSaved: () => void;
}>;

/** An ISO time as the `datetime-local` field wants it, in the browser's own clock like a new one. */
function toLocalInput(iso: string): string {
  const at = new Date(iso);
  const offset = at.getTimezoneOffset() * 60_000;
  return new Date(at.getTime() - offset).toISOString().slice(0, 16);
}

type Progress = {
  deliveryId?: string;
  updated?: boolean;
  compartments?: boolean;
  waterTest?: boolean;
  driver?: boolean;
};

const emptyCompartment = (n: number): CompartmentRow => ({
  number: n,
  noteLitres: '',
  receivedLitres: '',
  seals: '',
});

function localNow(): string {
  const now = new Date();
  now.setSeconds(0, 0);
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 16);
}

/** The form's card and title, left off when a dialog already provides them. */
function Frame({ framed, children }: { framed: boolean; children: ReactNode }) {
  if (!framed) return <div className="form-panel-bare">{children}</div>;
  return (
    <Card className="form-panel">
      <h2>Record delivery</h2>
      {children}
    </Card>
  );
}

/** An optional part of the form, folded away until it is needed. */
function Section({
  title,
  note,
  warning = false,
  forceOpen = false,
  children,
}: {
  title: string;
  /** A short summary of what is filled in, shown while the section is closed. */
  note?: string;
  warning?: boolean;
  /** Opens the section, e.g. when something in it needs attention. */
  forceOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const shown = open || forceOpen;
  return (
    <details
      className="rd-section"
      open={shown}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span className="rd-section-title">{title}</span>
        {note ? (
          <span className="rd-section-note" data-tone={warning ? 'warning' : undefined}>
            {note}
          </span>
        ) : null}
      </summary>
      <div className="rd-section-body">{children}</div>
    </details>
  );
}

/**
 * Record a fuel delivery in one form: who brought it, what the note says, what was actually
 * received, the tank dips either side, the truck compartments and seals, the water test and
 * the driver's confirmation. A purchase order is optional. The steps are saved in order and a
 * failed step can simply be retried: the ones that worked are not repeated.
 */
export function RecordDelivery({
  tenantId,
  stationId,
  tanks,
  framed = true,
  edit,
}: Readonly<{
  tenantId: string;
  stationId: string;
  tanks: readonly DeliveryTank[];
  /** False when the form sits inside a dialog that already supplies the title and card. */
  framed?: boolean;
  /** Set to change a delivery that is already recorded, instead of recording a new one. */
  edit?: DeliveryEdit;
}>) {
  const router = useRouter();
  const progress = useRef<Progress>({});
  const keys = useRef(new Map<string, string>());
  const start = edit?.start;
  const [suppliers, setSuppliers] = useState<{ id: string; label: string }[] | null>(null);
  const [supplierId, setSupplierId] = useState(start?.supplierId ?? '');
  const [tankId, setTankId] = useState(start?.tankId ?? tanks[0]?.id ?? '');
  const [deliveryNote, setDeliveryNote] = useState(start?.deliveryNote ?? '');
  const [deliveredAt, setDeliveredAt] = useState(() =>
    start ? toLocalInput(start.deliveredAt) : localNow(),
  );
  const [noteLitres, setNoteLitres] = useState(start?.noteLitres ?? '');
  const [receivedLitres, setReceivedLitres] = useState(start?.receivedLitres ?? '');
  const [transporter, setTransporter] = useState(start?.transporter ?? '');
  const [driver, setDriver] = useState(start?.driver ?? '');
  const [truck, setTruck] = useState(start?.truck ?? '');
  const [dipBefore, setDipBefore] = useState('');
  const [dipAfter, setDipAfter] = useState('');
  const [compartments, setCompartments] = useState<CompartmentRow[]>(() =>
    start ? start.compartments.map((row) => ({ ...row })) : [],
  );
  const [water, setWater] = useState<'' | 'PASS' | 'FAIL'>(start?.water ?? '');
  const [waterMm, setWaterMm] = useState(start?.waterMm ?? '');
  const [driverConfirmed, setDriverConfirmed] = useState(start?.driverConfirmed ?? false);
  const [noPo, setNoPo] = useState<string>(start?.noPo ?? '');
  const [noPoNote, setNoPoNote] = useState(start?.noPoNote ?? '');
  const [busy, setBusy] = useState<'record' | 'confirm' | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [deliveryId, setDeliveryId] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [stepUpOpen, setStepUpOpen] = useState(false);

  const tank = tanks.find((item) => item.id === tankId);
  const difference = shortageOrExcess(noteLitres, receivedLitres);
  const sumProblem = useMemo(
    () => compartmentSumProblem(compartments, noteLitres, receivedLitres),
    [compartments, noteLitres, receivedLitres],
  );

  // The draft is offered back, never applied silently, and goes once the delivery is recorded.
  const draftKey = draftStorageKey(['delivery', tenantId, stationId]);
  const [restored, setRestored] = useState(false);
  const typed: DeliveryDraft = {
    supplierId,
    tankId,
    deliveryNote,
    noteLitres,
    receivedLitres,
    transporter,
    driver,
    truck,
    dipBefore,
    dipAfter,
    compartments,
    water,
    waterMm,
    noPo,
    noPoNote,
  };
  const typedJson = JSON.stringify(typed);
  const touched = useRef(false);
  const failureRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (failure) failureRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [failure]);
  useEffect(() => {
    if (edit) return;
    void Promise.resolve().then(() => {
      const kept = loadDraft<DeliveryDraft>(draftKey, 'new')?.data ?? null;
      if (kept) {
        applyDraft(kept);
        setRestored(true);
      }
    });
  }, [draftKey, edit]);
  useEffect(() => {
    // Editing starts from what is saved, so the typed-draft safety net is for new deliveries only.
    if (edit) return;
    if (deliveryId !== null) {
      clearDraft(draftKey);
      return;
    }
    if (!touched.current) return;
    const timer = window.setTimeout(() => saveDraft(draftKey, 'new', JSON.parse(typedJson)), 500);
    return () => window.clearTimeout(timer);
  }, [draftKey, typedJson, deliveryId, edit]);
  function applyDraft(draft: DeliveryDraft) {
    setSupplierId(draft.supplierId);
    setTankId(draft.tankId);
    setDeliveryNote(draft.deliveryNote);
    setNoteLitres(draft.noteLitres);
    setReceivedLitres(draft.receivedLitres);
    setTransporter(draft.transporter);
    setDriver(draft.driver);
    setTruck(draft.truck);
    setDipBefore(draft.dipBefore);
    setDipAfter(draft.dipAfter);
    setCompartments(draft.compartments);
    setWater(draft.water);
    setWaterMm(draft.waterMm);
    setNoPo(draft.noPo);
    setNoPoNote(draft.noPoNote);
    touched.current = true;
  }
  function startAgain() {
    clearDraft(draftKey);
    applyDraft({
      supplierId: '',
      tankId: tanks[0]?.id ?? '',
      deliveryNote: '',
      noteLitres: '',
      receivedLitres: '',
      transporter: '',
      driver: '',
      truck: '',
      dipBefore: '',
      dipAfter: '',
      compartments: [],
      water: '',
      waterMm: '',
      noPo: '',
      noPoNote: '',
    });
    touched.current = false;
    setRestored(false);
  }

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/inventory/suppliers?${new URLSearchParams({ tenantId, stationId })}`, {
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error('failed'))))
      .then((body: { data: { id: string; code: string; name: string }[] }) =>
        setSuppliers(body.data.map((row) => ({ id: row.id, label: `${row.name} (${row.code})` }))),
      )
      .catch(() => {
        if (!controller.signal.aborted) setSuppliers([]);
      });
    return () => controller.abort();
  }, [tenantId, stationId]);

  function keyFor(step: string) {
    const existing = keys.current.get(step);
    if (existing) return existing;
    const created = crypto.randomUUID();
    keys.current.set(step, created);
    return created;
  }

  async function post(url: string, step: string, command: Record<string, unknown>) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': keyFor(step) },
      body: JSON.stringify({ ...command, tenantId, stationId }),
    });
    const body = (await response.json().catch(() => null)) as {
      error?: string;
      message?: string;
      details?: Record<string, unknown>;
      [key: string]: unknown;
    } | null;
    if (!response.ok) {
      const error = new Error(
        body?.message ?? 'That step could not be saved. Try again.',
      ) as Error & {
        code?: string;
        status?: number;
        details?: Record<string, unknown>;
      };
      error.code = body?.error;
      error.status = response.status;
      error.details = body?.details;
      throw error;
    }
    return body ?? {};
  }

  /**
   * Saves only what changed, in order. A step that worked is not repeated if a later one fails and
   * the person tries again, and nothing is sent when nothing changed.
   */
  async function saveEdit(target: DeliveryEdit, state: Progress, at: Date) {
    const before = target.start;
    const headerChanged =
      supplierId !== before.supplierId ||
      tankId !== before.tankId ||
      deliveryNote.trim() !== before.deliveryNote ||
      at.toISOString() !== new Date(before.deliveredAt).toISOString() ||
      noteLitres.trim() !== before.noteLitres ||
      receivedLitres.trim() !== before.receivedLitres ||
      transporter.trim() !== before.transporter ||
      driver.trim() !== before.driver ||
      truck.trim() !== before.truck ||
      noPo !== before.noPo ||
      (noPo === 'OTHER' && noPoNote.trim() !== before.noPoNote);
    if (headerChanged && !state.updated) {
      await post('/api/inventory/commands', 'update', {
        commandType: 'UpdateDelivery',
        deliveryId: target.deliveryId,
        supplierId,
        tankId,
        deliveryNoteNumber: deliveryNote.trim(),
        deliveredAt: at.toISOString(),
        noteQuantityLitres: noteLitres.trim(),
        actualQuantityLitres: receivedLitres.trim(),
        transporter: transporter.trim() || null,
        driver: driver.trim() || null,
        truckRegistration: truck.trim() || null,
        noPoReason: noPo || null,
        noPoNote: noPo === 'OTHER' ? noPoNote.trim() : null,
      });
      state.updated = true;
    }
    const filled = compartments.filter((row) => row.noteLitres.trim() || row.receivedLitres.trim());
    const rowsOf = (rows: readonly CompartmentRow[]) =>
      JSON.stringify(
        rows
          .filter((row) => row.noteLitres.trim() || row.receivedLitres.trim())
          .map((row) => [row.noteLitres.trim(), row.receivedLitres.trim(), row.seals.trim()]),
      );
    if (filled.length > 0 && rowsOf(compartments) !== rowsOf(before.compartments)) {
      if (!state.compartments) {
        await post('/api/deliveries/commands', 'compartments', {
          commandType: 'RecordDeliveryCompartments',
          deliveryId: target.deliveryId,
          compartments: filled.map((row, index) => ({
            compartmentNumber: index + 1,
            productId: target.productId,
            noteLitres: row.noteLitres.trim(),
            receivedLitres: row.receivedLitres.trim(),
            seals: row.seals
              .split(/[,\n]/)
              .map((seal) => seal.trim())
              .filter(Boolean)
              .map((sealNumber) => ({ sealNumber, intact: true })),
          })),
        });
        state.compartments = true;
      }
    }
    if (
      water &&
      (water !== before.water || waterMm.trim() !== before.waterMm) &&
      !state.waterTest
    ) {
      await post('/api/deliveries/commands', 'water', {
        commandType: 'RecordDeliveryWaterTest',
        deliveryId: target.deliveryId,
        result: water,
        ...(waterMm.trim() ? { waterReadingMm: waterMm.trim() } : {}),
      });
      state.waterTest = true;
    }
    if (
      driver.trim() &&
      (driver.trim() !== before.driver || driverConfirmed !== before.driverConfirmed) &&
      !state.driver
    ) {
      await post('/api/deliveries/commands', 'driver', {
        commandType: 'RecordDeliveryDriverConfirmation',
        deliveryId: target.deliveryId,
        driverName: driver.trim(),
        confirmed: driverConfirmed,
      });
      state.driver = true;
    }
  }

  async function record(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setFailure(null);
    if (sumProblem) {
      setFailure({ message: sumProblem });
      return;
    }
    setBusy('record');
    const state = progress.current;
    const at = new Date(deliveredAt);
    const before = new Date(at.getTime() - 60_000);
    try {
      if (edit) {
        await saveEdit(edit, state, at);
        edit.onSaved();
        return;
      }
      if (!state.deliveryId) {
        const result = await post('/api/inventory/commands', 'create', {
          commandType: 'CreateDelivery',
          supplierId,
          productId: tank?.productId,
          deliveryNoteNumber: deliveryNote.trim(),
          deliveredAt: at.toISOString(),
          noteQuantityLitres: noteLitres.trim(),
          actualQuantityLitres: receivedLitres.trim(),
          allocations: [{ tankId, quantityLitres: receivedLitres.trim() }],
          ...(transporter.trim() ? { transporter: transporter.trim() } : {}),
          ...(driver.trim() ? { driver: driver.trim() } : {}),
          ...(truck.trim() ? { truckRegistration: truck.trim() } : {}),
          ...(dipBefore.trim()
            ? {
                preDeliveryDip: {
                  measuredAt: before.toISOString(),
                  physicalLitres: dipBefore.trim(),
                  notes: 'Dip before delivery',
                },
              }
            : {}),
          ...(dipAfter.trim()
            ? {
                postDeliveryDip: {
                  measuredAt: at.toISOString(),
                  physicalLitres: dipAfter.trim(),
                  notes: 'Dip after delivery',
                },
              }
            : {}),
          ...(noPo ? { noPoReason: noPo } : {}),
          ...(noPo === 'OTHER' && noPoNote.trim() ? { noPoNote: noPoNote.trim() } : {}),
        });
        state.deliveryId = String(result.deliveryId);
        setDeliveryId(state.deliveryId);
      }
      const id = state.deliveryId;
      const filled = compartments.filter(
        (row) => row.noteLitres.trim() || row.receivedLitres.trim(),
      );
      if (filled.length > 0 && !state.compartments) {
        await post('/api/deliveries/commands', 'compartments', {
          commandType: 'RecordDeliveryCompartments',
          deliveryId: id,
          compartments: filled.map((row) => ({
            compartmentNumber: row.number,
            productId: tank?.productId,
            noteLitres: row.noteLitres.trim(),
            receivedLitres: row.receivedLitres.trim(),
            seals: row.seals
              .split(/[,\n]/)
              .map((seal) => seal.trim())
              .filter(Boolean)
              .map((sealNumber) => ({ sealNumber, intact: true })),
          })),
        });
        state.compartments = true;
      }
      if (water && !state.waterTest) {
        await post('/api/deliveries/commands', 'water', {
          commandType: 'RecordDeliveryWaterTest',
          deliveryId: id,
          result: water,
          ...(waterMm.trim() ? { waterReadingMm: waterMm.trim() } : {}),
        });
        state.waterTest = true;
      }
      if (driver.trim() && !state.driver) {
        await post('/api/deliveries/commands', 'driver', {
          commandType: 'RecordDeliveryDriverConfirmation',
          deliveryId: id,
          driverName: driver.trim(),
          confirmed: driverConfirmed,
        });
        state.driver = true;
      }
      router.refresh();
    } catch (caught) {
      const error = caught as Failure;
      if (error.code === 'STEP_UP_REQUIRED') {
        setStepUpOpen(true);
        return;
      }
      setFailure({
        message:
          caught instanceof Error ? caught.message : 'The delivery could not be saved. Try again.',
      });
    } finally {
      setBusy(null);
    }
  }

  async function confirm() {
    if (!deliveryId) return;
    setBusy('confirm');
    setFailure(null);
    try {
      await post('/api/inventory/commands', 'confirm', {
        commandType: 'ConfirmDelivery',
        deliveryId,
      });
      setConfirmed(true);
      router.refresh();
    } catch (caught) {
      setFailure({
        message: caught instanceof Error ? caught.message : 'The delivery could not be confirmed.',
        step: 'confirm',
      });
    } finally {
      setBusy(null);
    }
  }

  if (tanks.length === 0) {
    return (
      <Frame framed={framed}>
        <p className="table-secondary">
          This station has no tanks yet. Add its tanks in Settings, under Station setup, then record
          the delivery here.
        </p>
      </Frame>
    );
  }

  const recorded = deliveryId !== null;
  return (
    <Frame framed={framed}>
      {recorded ? null : (
        <p className="table-secondary">
          {edit
            ? 'Change what needs changing, then save. Only what you changed is saved.'
            : 'The first two sections are all you need. Add the rest if you have it.'}
        </p>
      )}
      {restored && deliveryId === null ? (
        <div className="rd-restore" role="status">
          <p>Your earlier entries are back. They are not saved yet.</p>
          <div className="rd-restore-actions">
            <Button type="button" variant="secondary" onClick={startAgain}>
              Start again
            </Button>
          </div>
        </div>
      ) : null}
      <form
        className="dialog-form rd-form"
        hidden={recorded && (failure === null || failure.step === 'confirm')}
        onSubmit={record}
        onChange={() => {
          touched.current = true;
        }}
      >
        <fieldset disabled={recorded && busy === null && failure === null} className="rd-fieldset">
          <section className="rd-group" aria-labelledby="rd-h-delivery">
            <h3 id="rd-h-delivery">The delivery</h3>
            <div className="rd-grid">
              <Field id="rd-supplier" label="Supplier" required>
                <select
                  id="rd-supplier"
                  value={supplierId}
                  onChange={(event) => setSupplierId(event.target.value)}
                  required
                  disabled={suppliers === null}
                >
                  <option value="">
                    {suppliers === null ? 'Loading suppliers…' : 'Choose a supplier'}
                  </option>
                  {(suppliers ?? []).map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id="rd-tank" label="Fuel and tank" required>
                <select
                  id="rd-tank"
                  value={tankId}
                  onChange={(event) => setTankId(event.target.value)}
                  required
                >
                  {tanks.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.productName} · tank {item.code}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id="rd-note-number" label="Delivery note number" required>
                <input
                  id="rd-note-number"
                  value={deliveryNote}
                  onChange={(event) => setDeliveryNote(event.target.value)}
                  required
                />
              </Field>
              <Field id="rd-delivered-at" label="Delivered at" required>
                <input
                  id="rd-delivered-at"
                  type="datetime-local"
                  value={deliveredAt}
                  onChange={(event) => setDeliveredAt(event.target.value)}
                  required
                />
              </Field>
            </div>
          </section>

          <section className="rd-group" aria-labelledby="rd-h-litres">
            <h3 id="rd-h-litres">Litres</h3>
            <div className="rd-grid">
              <Field id="rd-note-litres" label="On the delivery note" required>
                <input
                  id="rd-note-litres"
                  inputMode="decimal"
                  value={noteLitres}
                  onChange={(event) => setNoteLitres(event.target.value)}
                  required
                />
              </Field>
              <Field id="rd-received-litres" label="Actually received" required>
                <input
                  id="rd-received-litres"
                  inputMode="decimal"
                  value={receivedLitres}
                  onChange={(event) => setReceivedLitres(event.target.value)}
                  required
                />
              </Field>
            </div>
            {difference ? (
              <p
                className="rd-difference"
                role="status"
                data-tone={
                  difference.kind === 'EXACT'
                    ? undefined
                    : difference.kind === 'SHORT'
                      ? 'critical'
                      : 'warning'
                }
              >
                {difference.text}
              </p>
            ) : null}
          </section>

          <div className="rd-more">
            <h3>More detail, if you have it</h3>
            <Section
              title="Truck and driver"
              note={[transporter.trim(), driver.trim(), truck.trim()].filter(Boolean).join(' · ')}
            >
              <div className="rd-grid">
                <Field id="rd-transporter" label="Transporter" optional>
                  <input
                    id="rd-transporter"
                    value={transporter}
                    onChange={(event) => setTransporter(event.target.value)}
                  />
                </Field>
                <Field id="rd-truck" label="Truck registration" optional>
                  <input
                    id="rd-truck"
                    value={truck}
                    onChange={(event) => setTruck(event.target.value)}
                  />
                </Field>
                <Field id="rd-driver" label="Driver" optional>
                  <input
                    id="rd-driver"
                    value={driver}
                    onChange={(event) => setDriver(event.target.value)}
                  />
                </Field>
              </div>
              {driver.trim() ? (
                <label className="choice-card">
                  <input
                    type="checkbox"
                    checked={driverConfirmed}
                    onChange={(event) => setDriverConfirmed(event.target.checked)}
                  />
                  <span>
                    <strong>{driver.trim()} confirms the figures above</strong>
                  </span>
                </label>
              ) : null}
            </Section>

            {edit ? null : (
              <Section
                title="Tank dips"
                note={[dipBefore.trim() ? 'Before' : '', dipAfter.trim() ? 'After' : '']
                  .filter(Boolean)
                  .join(' and ')}
              >
                <div className="rd-grid">
                  <Field id="rd-dip-before" label="Before the delivery (litres)" optional>
                    <input
                      id="rd-dip-before"
                      inputMode="decimal"
                      value={dipBefore}
                      onChange={(event) => setDipBefore(event.target.value)}
                    />
                  </Field>
                  <Field id="rd-dip-after" label="After the delivery (litres)" optional>
                    <input
                      id="rd-dip-after"
                      inputMode="decimal"
                      value={dipAfter}
                      onChange={(event) => setDipAfter(event.target.value)}
                    />
                  </Field>
                </div>
              </Section>
            )}

            <Section
              title="Truck compartments and seals"
              note={
                sumProblem
                  ? 'Check the litres'
                  : compartments.length > 0
                    ? `${compartments.length} added`
                    : ''
              }
              warning={Boolean(sumProblem)}
              forceOpen={Boolean(sumProblem)}
            >
              {compartments.map((row, index) => (
                <div key={row.number} className="rd-compartment">
                  <strong>Compartment {row.number}</strong>
                  <div className="rd-grid">
                    <Field id={`rd-c${row.number}-note`} label="On the note" required>
                      <input
                        id={`rd-c${row.number}-note`}
                        inputMode="decimal"
                        value={row.noteLitres}
                        onChange={(event) =>
                          setCompartments((rows) =>
                            rows.map((item, at) =>
                              at === index ? { ...item, noteLitres: event.target.value } : item,
                            ),
                          )
                        }
                      />
                    </Field>
                    <Field id={`rd-c${row.number}-received`} label="Received" required>
                      <input
                        id={`rd-c${row.number}-received`}
                        inputMode="decimal"
                        value={row.receivedLitres}
                        onChange={(event) =>
                          setCompartments((rows) =>
                            rows.map((item, at) =>
                              at === index ? { ...item, receivedLitres: event.target.value } : item,
                            ),
                          )
                        }
                      />
                    </Field>
                  </div>
                  <Field
                    id={`rd-c${row.number}-seals`}
                    label="Seal numbers"
                    hint="Separate several seals with commas."
                    optional
                  >
                    <input
                      id={`rd-c${row.number}-seals`}
                      value={row.seals}
                      onChange={(event) =>
                        setCompartments((rows) =>
                          rows.map((item, at) =>
                            at === index ? { ...item, seals: event.target.value } : item,
                          ),
                        )
                      }
                    />
                  </Field>
                </div>
              ))}
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  setCompartments((rows) => [...rows, emptyCompartment(rows.length + 1)])
                }
              >
                Add a compartment
              </Button>
              {sumProblem ? (
                <p role="status" data-tone="warning">
                  {sumProblem}
                </p>
              ) : null}
            </Section>

            <Section
              title="Water test"
              note={water === 'PASS' ? 'Passed' : water === 'FAIL' ? 'Failed' : ''}
              warning={water === 'FAIL'}
            >
              <div className="rd-grid">
                <Field id="rd-water" label="Result" optional>
                  <select
                    id="rd-water"
                    value={water}
                    onChange={(event) => setWater(event.target.value as '' | 'PASS' | 'FAIL')}
                  >
                    <option value="">Not done</option>
                    <option value="PASS">Passed</option>
                    <option value="FAIL">Failed</option>
                  </select>
                </Field>
                {water ? (
                  <Field id="rd-water-mm" label="Water found (mm)" optional>
                    <input
                      id="rd-water-mm"
                      inputMode="decimal"
                      value={waterMm}
                      onChange={(event) => setWaterMm(event.target.value)}
                    />
                  </Field>
                ) : null}
              </div>
            </Section>

            <Section
              title="Purchase order"
              note={noPo ? 'No order' : ''}
              forceOpen={noPo === 'OTHER'}
            >
              <Field id="rd-no-po" label="Is there an order for this delivery?" optional>
                <select
                  id="rd-no-po"
                  value={noPo}
                  onChange={(event) => setNoPo(event.target.value)}
                >
                  {NO_PO_REASONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
              {noPo === 'OTHER' ? (
                <Field id="rd-no-po-note" label="Why is there no purchase order?" required>
                  <input
                    id="rd-no-po-note"
                    value={noPoNote}
                    maxLength={300}
                    onChange={(event) => setNoPoNote(event.target.value)}
                    required
                  />
                </Field>
              ) : null}
            </Section>
          </div>
        </fieldset>
        {failure && failure.step !== 'confirm' ? (
          <div ref={failureRef}>
            <ErrorState title="Could not finish" message={failure.message} />
          </div>
        ) : null}
        {!recorded || (failure && failure.step !== 'confirm') ? (
          <div className="rd-actions">
            <Button type="submit" loading={busy === 'record'}>
              {recorded ? 'Try the remaining steps again' : edit ? 'Save changes' : 'Save delivery'}
            </Button>
          </div>
        ) : null}
      </form>

      <StepUpDialog
        open={stepUpOpen}
        tenantId={tenantId}
        description={`${edit ? 'Changing this delivery' : 'Recording this delivery'} needs a fresh identity check. Nothing is saved until you confirm.`}
        confirmLabel="Confirm and save"
        onCancel={() => setStepUpOpen(false)}
        onVerified={() => {
          setStepUpOpen(false);
          void record();
        }}
      />

      {recorded && !confirmed ? (
        <section className="rd-saved" aria-labelledby="rd-saved-title">
          <div className="rd-saved-head">
            <h3 id="rd-saved-title">Delivery saved. One step left</h3>
            <p className="rd-saved-summary">
              {deliveryNote.trim()} · {receivedLitres.trim()} L
              {tank ? ` of ${tank.productName} into tank ${tank.code}` : ''}
            </p>
            <p className="table-secondary">
              Add a photo of the delivery note if you have one, then confirm. Confirming puts the
              fuel on the tank&apos;s books and records you as the supervisor who checked it.
            </p>
          </div>
          <DocumentAttachments
            tenantId={tenantId}
            stationId={stationId}
            subjectType="FUEL_DELIVERY"
            subjectId={deliveryId}
            defaultKind="DELIVERY_NOTE"
            title="Delivery note and photos"
          />
          {failure?.step === 'confirm' ? (
            <div ref={failureRef}>
              <ErrorState title="Could not confirm" message={failure.message} />
            </div>
          ) : null}
          <div className="rd-actions">
            <Button type="button" loading={busy === 'confirm'} onClick={() => void confirm()}>
              Confirm delivery
            </Button>
          </div>
        </section>
      ) : null}
      {confirmed ? (
        <SuccessState
          title="Delivery confirmed"
          message="The fuel is on the books and the delivery is in the list."
        />
      ) : null}
    </Frame>
  );
}
