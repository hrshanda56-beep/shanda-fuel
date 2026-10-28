'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
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

type Failure = { message: string; code?: string; status?: number };
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
type Progress = {
  deliveryId?: string;
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
}: Readonly<{ tenantId: string; stationId: string; tanks: readonly DeliveryTank[] }>) {
  const router = useRouter();
  const progress = useRef<Progress>({});
  const keys = useRef(new Map<string, string>());
  const [suppliers, setSuppliers] = useState<{ id: string; label: string }[] | null>(null);
  const [supplierId, setSupplierId] = useState('');
  const [tankId, setTankId] = useState(tanks[0]?.id ?? '');
  const [deliveryNote, setDeliveryNote] = useState('');
  const [deliveredAt, setDeliveredAt] = useState(localNow);
  const [noteLitres, setNoteLitres] = useState('');
  const [receivedLitres, setReceivedLitres] = useState('');
  const [transporter, setTransporter] = useState('');
  const [driver, setDriver] = useState('');
  const [truck, setTruck] = useState('');
  const [dipBefore, setDipBefore] = useState('');
  const [dipAfter, setDipAfter] = useState('');
  const [compartments, setCompartments] = useState<CompartmentRow[]>([]);
  const [water, setWater] = useState<'' | 'PASS' | 'FAIL'>('');
  const [waterMm, setWaterMm] = useState('');
  const [driverConfirmed, setDriverConfirmed] = useState(false);
  const [noPo, setNoPo] = useState<string>('');
  const [noPoNote, setNoPoNote] = useState('');
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
  const [restorable, setRestorable] = useState<DeliveryDraft | null>(null);
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
  useEffect(() => {
    void Promise.resolve().then(() =>
      setRestorable(loadDraft<DeliveryDraft>(draftKey, 'new')?.data ?? null),
    );
  }, [draftKey]);
  useEffect(() => {
    if (deliveryId !== null) {
      clearDraft(draftKey);
      return;
    }
    if (!touched.current) return;
    const timer = window.setTimeout(() => saveDraft(draftKey, 'new', JSON.parse(typedJson)), 500);
    return () => window.clearTimeout(timer);
  }, [draftKey, typedJson, deliveryId]);
  function restoreDraft() {
    if (!restorable) return;
    setSupplierId(restorable.supplierId);
    setTankId(restorable.tankId);
    setDeliveryNote(restorable.deliveryNote);
    setNoteLitres(restorable.noteLitres);
    setReceivedLitres(restorable.receivedLitres);
    setTransporter(restorable.transporter);
    setDriver(restorable.driver);
    setTruck(restorable.truck);
    setDipBefore(restorable.dipBefore);
    setDipAfter(restorable.dipAfter);
    setCompartments(restorable.compartments);
    setWater(restorable.water);
    setWaterMm(restorable.waterMm);
    setNoPo(restorable.noPo);
    setNoPoNote(restorable.noPoNote);
    touched.current = true;
    setRestorable(null);
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
      const error = new Error(body?.message ?? 'That step could not be saved. Try again.') as Error & {
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
      });
    } finally {
      setBusy(null);
    }
  }

  if (tanks.length === 0) {
    return (
      <Card className="form-panel">
        <h2>Record delivery</h2>
        <p className="table-secondary">
          This station has no tanks yet. Add its tanks in Settings, under Station setup, then record
          the delivery here.
        </p>
      </Card>
    );
  }

  const recorded = deliveryId !== null;
  return (
    <Card className="form-panel">
      <h2>Record delivery</h2>
      <p className="table-secondary">
        Fill in what you have. A purchase order is optional: link one later, or say why there is
        none.
      </p>
      {restorable && deliveryId === null ? (
        <div className="table-secondary" role="status">
          <p>
            Your earlier entries for a delivery were kept on this phone. They are not saved yet.
          </p>
          <Button type="button" onClick={restoreDraft}>
            Restore them
          </Button>{' '}
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              clearDraft(draftKey);
              setRestorable(null);
            }}
          >
            Discard
          </Button>
        </div>
      ) : null}
      <form
        className="dialog-form"
        onSubmit={record}
        onChange={() => {
          touched.current = true;
        }}
      >
        <fieldset disabled={recorded && busy === null && failure === null} className="form-stack">
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
          <Field id="rd-transporter" label="Transporter" optional>
            <input
              id="rd-transporter"
              value={transporter}
              onChange={(event) => setTransporter(event.target.value)}
            />
          </Field>
          <Field id="rd-driver" label="Driver" optional>
            <input
              id="rd-driver"
              value={driver}
              onChange={(event) => setDriver(event.target.value)}
            />
          </Field>
          <Field id="rd-truck" label="Truck registration" optional>
            <input id="rd-truck" value={truck} onChange={(event) => setTruck(event.target.value)} />
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
          <Field id="rd-note-litres" label="Litres on the delivery note" required>
            <input
              id="rd-note-litres"
              inputMode="decimal"
              value={noteLitres}
              onChange={(event) => setNoteLitres(event.target.value)}
              required
            />
          </Field>
          <Field id="rd-received-litres" label="Litres actually received" required>
            <input
              id="rd-received-litres"
              inputMode="decimal"
              value={receivedLitres}
              onChange={(event) => setReceivedLitres(event.target.value)}
              required
            />
          </Field>
          {difference ? (
            <p role="status" data-tone={difference.kind === 'EXACT' ? undefined : 'warning'}>
              {difference.text}
            </p>
          ) : null}
          <Field id="rd-dip-before" label="Tank dip before the delivery (litres)" optional>
            <input
              id="rd-dip-before"
              inputMode="decimal"
              value={dipBefore}
              onChange={(event) => setDipBefore(event.target.value)}
            />
          </Field>
          <Field id="rd-dip-after" label="Tank dip after the delivery (litres)" optional>
            <input
              id="rd-dip-after"
              inputMode="decimal"
              value={dipAfter}
              onChange={(event) => setDipAfter(event.target.value)}
            />
          </Field>

          <h3>Truck compartments and seals</h3>
          {compartments.map((row, index) => (
            <div key={row.number} className="form-stack">
              <strong>Compartment {row.number}</strong>
              <Field id={`rd-c${row.number}-note`} label="Litres on the note" required>
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
              <Field id={`rd-c${row.number}-received`} label="Litres received" required>
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
            onClick={() => setCompartments((rows) => [...rows, emptyCompartment(rows.length + 1)])}
          >
            Add a compartment
          </Button>
          {sumProblem ? (
            <p role="status" data-tone="warning">
              {sumProblem}
            </p>
          ) : null}

          <Field id="rd-water" label="Water test" optional>
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

          <Field id="rd-no-po" label="Purchase order" optional>
            <select id="rd-no-po" value={noPo} onChange={(event) => setNoPo(event.target.value)}>
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
        </fieldset>
        {failure ? <ErrorState title="Could not finish" message={failure.message} /> : null}
        {!recorded || failure ? (
          <Button type="submit" loading={busy === 'record'}>
            {recorded ? 'Try the remaining steps again' : 'Save delivery'}
          </Button>
        ) : null}
      </form>

      <StepUpDialog
        open={stepUpOpen}
        tenantId={tenantId}
        description="Recording this delivery needs a fresh identity check. Nothing is saved until you confirm."
        confirmLabel="Confirm and save"
        onCancel={() => setStepUpOpen(false)}
        onVerified={() => {
          setStepUpOpen(false);
          void record();
        }}
      />

      {recorded && !confirmed ? (
        <div className="callout callout-warning">
          <strong>Saved as a draft</strong>
          <p>
            Add the delivery note and photos below, then confirm. Confirming posts the fuel to the
            tank; the person confirming is recorded as the supervisor who checked it.
          </p>
          <DocumentAttachments
            tenantId={tenantId}
            stationId={stationId}
            subjectType="FUEL_DELIVERY"
            subjectId={deliveryId}
            defaultKind="DELIVERY_NOTE"
            title="Delivery note and photos"
          />
          <Button type="button" loading={busy === 'confirm'} onClick={() => void confirm()}>
            Confirm delivery
          </Button>
        </div>
      ) : null}
      {confirmed ? (
        <SuccessState
          title="Delivery confirmed"
          message="The fuel is on the books and the delivery is in the list."
        />
      ) : null}
    </Card>
  );
}
