'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';

import {
  Button,
  Card,
  ContextRequiredState,
  ErrorState,
  Field,
  SuccessState,
} from '@/design-system/primitives';
import { DocumentAttachments } from '../../documents/ui/document-attachments';
import { parseCalibrationText } from '../calibration';

export type InventoryContext = Readonly<{
  tenantId: string;
  legalEntityId: string;
  stationId: string;
  organisationName: string;
  legalEntityName: string;
  stationName: string;
  stationTimezone: string;
}>;

export type MissingCostSource = Readonly<{
  sourceType: string;
  sourceId: string;
  movementType: string;
  quantityLitres: string;
  effectiveAt: string | null;
  businessDate: string;
}>;

type CommandFailure = Readonly<{ code: string; message: string }>;

type InventoryOperationalActionsProps = Readonly<{
  context: InventoryContext;
  tankId: string;
  productId: string;
  sourceMovementRequiringCost?: MissingCostSource | null;
  canRecordReceiptCost: boolean;
  onRefresh: () => void;
}>;

function isoFromLocal(value: string): string {
  return new Date(value).toISOString();
}

function displayFailure(failure: CommandFailure): CommandFailure {
  if (failure.code === 'FORBIDDEN') {
    return {
      code: failure.code,
      message: 'Your permission or station scope does not allow this Inventory action.',
    };
  }
  if (failure.code === 'CONFLICT' || failure.code === 'IDEMPOTENCY_CONFLICT') {
    return {
      code: failure.code,
      message: failure.message || 'The record changed elsewhere. Refresh before retrying.',
    };
  }
  return failure;
}

async function postInventoryCommand(
  context: InventoryContext,
  command: Record<string, unknown>,
  idempotencyKey: string,
): Promise<unknown> {
  const response = await fetch('/api/inventory/commands', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({
      ...command,
      tenantId: context.tenantId,
      stationId: context.stationId,
    }),
  });
  const body = (await response.json().catch(() => null)) as {
    error?: string;
    message?: string;
  } | null;
  if (!response.ok) {
    throw displayFailure({
      code: body?.error ?? 'INTERNAL_ERROR',
      message: body?.message ?? 'The Inventory command could not be completed.',
    });
  }
  return body;
}

function CommandFeedback({
  error,
  success,
}: Readonly<{ error: CommandFailure | null; success: string | null }>) {
  return (
    <>
      {error ? <ErrorState title="Action could not be completed" message={error.message} /> : null}
      {success ? <SuccessState title="Inventory updated" message={success} /> : null}
    </>
  );
}

function ActionDisclosure({ title, children }: Readonly<{ title: string; children: ReactNode }>) {
  return (
    <details className="panel inventory-action-disclosure">
      <summary>{title}</summary>
      <div className="inventory-action-content">{children}</div>
    </details>
  );
}

export function InventoryOperationalActions({
  context,
  tankId,
  productId,
  sourceMovementRequiringCost,
  canRecordReceiptCost,
  onRefresh,
}: InventoryOperationalActionsProps) {
  return (
    <section aria-labelledby="inventory-actions-heading">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Authorised station actions</span>
          <h2 id="inventory-actions-heading">Record an Inventory observation or movement</h2>
          <p>
            These actions are sent to the named server command and remain scoped to{' '}
            {context.stationName}. Server validation remains authoritative.
          </p>
        </div>
      </div>
      <div className="inventory-action-grid">
        <ActionDisclosure title="Record tank dip">
          <TankDipForm context={context} tankId={tankId} onRefresh={onRefresh} />
        </ActionDisclosure>
        <ActionDisclosure title="Tank chart (dipstick to litres)">
          <TankCalibrationForm context={context} tankId={tankId} onRefresh={onRefresh} />
        </ActionDisclosure>
        <ActionDisclosure title="Post stock adjustment">
          <AdjustmentForm context={context} tankId={tankId} onRefresh={onRefresh} />
        </ActionDisclosure>
        <ActionDisclosure title="Record opening stock">
          <OpeningInventoryForm context={context} tankId={tankId} onRefresh={onRefresh} />
        </ActionDisclosure>
        <ActionDisclosure title="Record delivery receipt">
          <p className="muted-small">
            After the delivery is recorded, add its truck compartments, seals, water test and driver
            confirmation on the{' '}
            <Link
              href={`/inventory/deliveries?${new URLSearchParams({
                tenantId: context.tenantId,
                legalEntityId: context.legalEntityId,
                stationId: context.stationId,
              }).toString()}`}
            >
              delivery details pages
            </Link>
            .
          </p>
          <DeliveryForm
            context={context}
            tankId={tankId}
            productId={productId}
            onRefresh={onRefresh}
          />
        </ActionDisclosure>
        {sourceMovementRequiringCost?.sourceType === 'FUEL_DELIVERY_ALLOCATION' ? (
          <ActionDisclosure title="Record receipt cost">
            <ReceiptCostForm
              context={context}
              source={sourceMovementRequiringCost}
              enabled={canRecordReceiptCost}
              onRefresh={onRefresh}
            />
          </ActionDisclosure>
        ) : null}
      </div>
    </section>
  );
}

function TankDipForm({
  context,
  tankId,
  onRefresh,
}: Readonly<{ context: InventoryContext; tankId: string; onRefresh: () => void }>) {
  const key = useRef<string | null>(null);
  const [mode, setMode] = useState<'litres' | 'dipstick'>('litres');
  const [physicalLitres, setPhysicalLitres] = useState('');
  const [reading, setReading] = useState('');
  const [unit, setUnit] = useState('cm');
  const [measuredAt, setMeasuredAt] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<CommandFailure | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    key.current ??= crypto.randomUUID();
    try {
      await postInventoryCommand(
        context,
        {
          commandType: 'RecordTankDip',
          tankId,
          measuredAt: isoFromLocal(measuredAt),
          ...(mode === 'litres'
            ? { physicalLitres }
            : { rawMeasurement: reading.trim(), measurementUnit: unit.trim() }),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        },
        key.current,
      );
      key.current = null;
      setSuccess('The physical dip was recorded without changing book stock.');
      setPhysicalLitres('');
      setReading('');
      setMeasuredAt('');
      setNotes('');
      onRefresh();
    } catch (caught) {
      setError(caught as CommandFailure);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="dialog-form" onSubmit={submit}>
      <p className="muted-small">
        A dip is a physical observation. It never silently adjusts book inventory.
      </p>
      <div role="group" aria-label="How did you measure?" className="button-row">
        <Button
          type="button"
          variant={mode === 'litres' ? 'primary' : 'secondary'}
          aria-pressed={mode === 'litres'}
          onClick={() => setMode('litres')}
        >
          I know the litres
        </Button>
        <Button
          type="button"
          variant={mode === 'dipstick' ? 'primary' : 'secondary'}
          aria-pressed={mode === 'dipstick'}
          onClick={() => setMode('dipstick')}
        >
          I read a dipstick
        </Button>
      </div>
      {mode === 'litres' ? (
        <Field id="dip-litres" label="Physical litres" required>
          <input
            id="dip-litres"
            value={physicalLitres}
            onChange={(event) => setPhysicalLitres(event.target.value)}
            inputMode="decimal"
            required
            placeholder="0.000"
          />
        </Field>
      ) : (
        <>
          <Field
            id="dip-reading"
            label="Dipstick reading"
            hint="The tank’s chart turns this into litres. Add the chart first under “Tank chart”."
            required
          >
            <input
              id="dip-reading"
              value={reading}
              onChange={(event) => setReading(event.target.value)}
              inputMode="decimal"
              required
              placeholder="112.5"
            />
          </Field>
          <Field id="dip-unit" label="Measured in" required>
            <select
              id="dip-unit"
              value={unit}
              onChange={(event) => setUnit(event.target.value)}
              required
            >
              <option value="mm">mm</option>
              <option value="cm">cm</option>
              <option value="inches">inches</option>
            </select>
          </Field>
        </>
      )}
      <Field id="dip-measured-at" label="Measured at" required>
        <input
          id="dip-measured-at"
          type="datetime-local"
          value={measuredAt}
          onChange={(event) => setMeasuredAt(event.target.value)}
          required
        />
      </Field>
      <Field id="dip-notes" label="Notes">
        <textarea
          id="dip-notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={3}
        />
      </Field>
      <CommandFeedback error={error} success={success} />
      <Button type="submit" loading={saving}>
        Record dip
      </Button>
    </form>
  );
}

function TankCalibrationForm({
  context,
  tankId,
  onRefresh,
}: Readonly<{ context: InventoryContext; tankId: string; onRefresh: () => void }>) {
  const key = useRef<string | null>(null);
  const [unit, setUnit] = useState('cm');
  const [text, setText] = useState('');
  const [error, setError] = useState<CommandFailure | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    key.current ??= crypto.randomUUID();
    try {
      const points = parseCalibrationText(text);
      await postInventoryCommand(
        context,
        { commandType: 'SetTankCalibration', tankId, measurementUnit: unit.trim(), points },
        key.current,
      );
      key.current = null;
      setSuccess(`Chart saved with ${points.length} rows. New dips will use it.`);
      setText('');
      onRefresh();
    } catch (caught) {
      key.current = null;
      setError(
        caught instanceof Error && !('code' in caught)
          ? { code: 'VALIDATION_FAILED', message: caught.message }
          : (caught as CommandFailure),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="dialog-form" onSubmit={submit}>
      <p className="muted-small">
        The chart from the tank maker lists a dipstick reading and the litres it means. Saving a new
        chart replaces the old one for new dips; dips already recorded keep their litres.
      </p>
      <Field id="chart-unit" label="Readings are in" required>
        <select
          id="chart-unit"
          value={unit}
          onChange={(event) => setUnit(event.target.value)}
          required
        >
          <option value="mm">mm</option>
          <option value="cm">cm</option>
          <option value="inches">inches</option>
        </select>
      </Field>
      <Field
        id="chart-rows"
        label="Chart rows"
        hint="One row per line: the reading, then the litres. For example 112.5, 18400. You can paste rows from a spreadsheet."
        required
      >
        <textarea
          id="chart-rows"
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={8}
          required
          placeholder={'0, 0\n50, 9200\n100, 18400'}
        />
      </Field>
      <CommandFeedback error={error} success={success} />
      <Button type="submit" loading={saving}>
        Save chart
      </Button>
    </form>
  );
}

function AdjustmentForm({
  context,
  tankId,
  onRefresh,
}: Readonly<{ context: InventoryContext; tankId: string; onRefresh: () => void }>) {
  const key = useRef<string | null>(null);
  const [movementType, setMovementType] = useState<'POSITIVE_ADJUSTMENT' | 'NEGATIVE_ADJUSTMENT'>(
    'POSITIVE_ADJUSTMENT',
  );
  const [quantityLitres, setQuantityLitres] = useState('');
  const [effectiveAt, setEffectiveAt] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<CommandFailure | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    key.current ??= crypto.randomUUID();
    try {
      await postInventoryCommand(
        context,
        {
          commandType: 'PostInventoryAdjustment',
          tankId,
          quantityLitres,
          effectiveAt: isoFromLocal(effectiveAt),
          movementType,
          reason: reason.trim(),
        },
        key.current,
      );
      key.current = null;
      setSuccess('The signed stock adjustment was posted with its reason and audit trail.');
      setQuantityLitres('');
      setEffectiveAt('');
      setReason('');
      onRefresh();
    } catch (caught) {
      setError(caught as CommandFailure);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="dialog-form" onSubmit={submit}>
      <Field id="adjustment-direction" label="Direction" required>
        <select
          id="adjustment-direction"
          value={movementType}
          onChange={(event) =>
            setMovementType(event.target.value as 'POSITIVE_ADJUSTMENT' | 'NEGATIVE_ADJUSTMENT')
          }
        >
          <option value="POSITIVE_ADJUSTMENT">Increase book stock</option>
          <option value="NEGATIVE_ADJUSTMENT">Decrease book stock</option>
        </select>
      </Field>
      <Field id="adjustment-litres" label="Quantity litres" required>
        <input
          id="adjustment-litres"
          value={quantityLitres}
          onChange={(event) => setQuantityLitres(event.target.value)}
          inputMode="decimal"
          required
          placeholder="0.000"
        />
      </Field>
      <Field id="adjustment-effective-at" label="Effective at" required>
        <input
          id="adjustment-effective-at"
          type="datetime-local"
          value={effectiveAt}
          onChange={(event) => setEffectiveAt(event.target.value)}
          required
        />
      </Field>
      <Field id="adjustment-reason" label="Reason" required>
        <textarea
          id="adjustment-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={3}
          required
        />
      </Field>
      <CommandFeedback error={error} success={success} />
      <Button type="submit" loading={saving} disabled={!reason.trim()}>
        Post adjustment
      </Button>
    </form>
  );
}

function OpeningInventoryForm({
  context,
  tankId,
  onRefresh,
}: Readonly<{ context: InventoryContext; tankId: string; onRefresh: () => void }>) {
  const quantityKey = useRef<string | null>(null);
  const costKey = useRef<string | null>(null);
  const quantityDone = useRef(false);
  const [quantityLitres, setQuantityLitres] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [effectiveAt, setEffectiveAt] = useState('');
  const [error, setError] = useState<CommandFailure | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      if (!quantityDone.current) {
        quantityKey.current ??= crypto.randomUUID();
        await postInventoryCommand(
          context,
          {
            commandType: 'RecordOpeningBalance',
            tankId,
            quantityLitres,
            effectiveAt: isoFromLocal(effectiveAt),
          },
          quantityKey.current,
        );
        quantityDone.current = true;
      }
      costKey.current ??= crypto.randomUUID();
      await postInventoryCommand(
        context,
        {
          commandType: 'RecordOpeningInventoryCost',
          tankId,
          unitCost: unitCost.trim(),
          currency: 'USD',
        },
        costKey.current,
      );
      setSuccess(
        'The opening stock and its cost were recorded. Book stock, average cost and stock value now start from them.',
      );
      quantityKey.current = null;
      costKey.current = null;
      quantityDone.current = false;
      setQuantityLitres('');
      setUnitCost('');
      setEffectiveAt('');
      onRefresh();
    } catch (caught) {
      setError(caught as CommandFailure);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="dialog-form" onSubmit={submit}>
      <p className="muted-small">
        Enter what is in this tank when you go live, from the opening dip, and what each litre cost.
        Book stock, the average cost and the stock value all start from these two figures. Do not
        enter an unknown cost as zero.
      </p>
      <Field id="opening-litres" label="Opening dip (litres)" required>
        <input
          id="opening-litres"
          value={quantityLitres}
          onChange={(event) => setQuantityLitres(event.target.value)}
          inputMode="decimal"
          required
          placeholder="0.000"
        />
      </Field>
      <Field id="opening-unit-cost" label="Opening cost per litre (USD)" required>
        <input
          id="opening-unit-cost"
          value={unitCost}
          onChange={(event) => setUnitCost(event.target.value)}
          inputMode="decimal"
          required
          placeholder="1.760"
        />
      </Field>
      <Field id="opening-effective-at" label="As at" required>
        <input
          id="opening-effective-at"
          type="datetime-local"
          value={effectiveAt}
          onChange={(event) => setEffectiveAt(event.target.value)}
          required
        />
      </Field>
      <CommandFeedback error={error} success={success} />
      <Button type="submit" loading={saving}>
        Record opening stock
      </Button>
    </form>
  );
}

export type DeliveryFormValues = Readonly<{
  supplierId: string;
  productId: string;
  deliveryNoteNumber: string;
  deliveredAt: string;
  noteQuantityLitres: string;
  actualQuantityLitres: string;
  allocationQuantityLitres: string;
  supplierReference?: string;
  transporter?: string;
  driver?: string;
  truckRegistration?: string;
  sealReference?: string;
  preDeliveryDipId?: string;
  postDeliveryDipId?: string;
  /** Why there is no purchase order; empty when the delivery will be linked to one. */
  noPoReason?: string;
  noPoNote?: string;
  tankId: string;
}>;

export const NO_PO_REASON_OPTIONS = [
  { value: 'EMERGENCY_PURCHASE', label: 'Emergency purchase' },
  { value: 'CASH_PURCHASE', label: 'Bought for cash' },
  { value: 'SUPPLIER_DIRECT', label: 'Supplier delivered without an order' },
  { value: 'PO_NOT_RAISED', label: 'The order was not raised in time' },
  { value: 'OTHER', label: 'Another reason' },
] as const;

/**
 * Build the existing CreateDelivery command without sending empty optional strings.
 * Dip references are existing tank-dip IDs; this helper deliberately does not create or
 * reinterpret dip evidence.
 */
export function buildDeliveryCommand(values: DeliveryFormValues): Record<string, unknown> {
  const command: Record<string, unknown> = {
    commandType: 'CreateDelivery',
    supplierId: values.supplierId,
    productId: values.productId,
    deliveryNoteNumber: values.deliveryNoteNumber.trim(),
    deliveredAt: values.deliveredAt,
    noteQuantityLitres: values.noteQuantityLitres,
    actualQuantityLitres: values.actualQuantityLitres,
    allocations: [{ tankId: values.tankId, quantityLitres: values.allocationQuantityLitres }],
  };
  const optional = {
    supplierReference: values.supplierReference,
    transporter: values.transporter,
    driver: values.driver,
    truckRegistration: values.truckRegistration,
    sealReference: values.sealReference,
    preDeliveryDipId: values.preDeliveryDipId,
    postDeliveryDipId: values.postDeliveryDipId,
    noPoReason: values.noPoReason,
    noPoNote: values.noPoReason ? values.noPoNote : undefined,
  } as const;
  for (const [key, value] of Object.entries(optional)) {
    if (value?.trim()) command[key] = value.trim();
  }
  return command;
}

export function DeliveryForm({
  context,
  tankId,
  productId,
  onRefresh,
}: Readonly<{
  context: InventoryContext;
  tankId: string;
  productId: string;
  onRefresh: () => void;
}>) {
  const createKey = useRef<string | null>(null);
  const confirmKey = useRef<string | null>(null);
  const [deliveryId, setDeliveryId] = useState<string | null>(null);
  const [suppliers, setSuppliers] = useState<{ id: string; label: string }[] | null>(null);
  const [supplierId, setSupplierId] = useState('');
  const [deliveryNoteNumber, setDeliveryNoteNumber] = useState('');
  const [supplierReference, setSupplierReference] = useState('');
  const [transporter, setTransporter] = useState('');
  const [driver, setDriver] = useState('');
  const [truckRegistration, setTruckRegistration] = useState('');
  const [sealReference, setSealReference] = useState('');
  const [preDeliveryDipId, setPreDeliveryDipId] = useState('');
  const [postDeliveryDipId, setPostDeliveryDipId] = useState('');
  const [noPoReason, setNoPoReason] = useState('');
  const [noPoNote, setNoPoNote] = useState('');
  const [deliveredAt, setDeliveredAt] = useState('');
  const [noteQuantityLitres, setNoteQuantityLitres] = useState('');
  const [actualQuantityLitres, setActualQuantityLitres] = useState('');
  const [allocationQuantityLitres, setAllocationQuantityLitres] = useState('');
  const [error, setError] = useState<CommandFailure | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState<'create' | 'confirm' | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      tenantId: context.tenantId,
      stationId: context.stationId,
    });
    fetch(`/api/inventory/suppliers?${params.toString()}`, {
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
  }, [context.tenantId, context.stationId]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving('create');
    setError(null);
    setSuccess(null);
    createKey.current ??= crypto.randomUUID();
    try {
      const result = (await postInventoryCommand(
        context,
        buildDeliveryCommand({
          supplierId,
          productId,
          tankId,
          deliveryNoteNumber,
          deliveredAt: isoFromLocal(deliveredAt),
          noteQuantityLitres,
          actualQuantityLitres,
          allocationQuantityLitres,
          supplierReference,
          transporter,
          driver,
          truckRegistration,
          sealReference,
          preDeliveryDipId,
          postDeliveryDipId,
          noPoReason,
          noPoNote,
        }),
        createKey.current,
      )) as { deliveryId?: string } | null;
      createKey.current = null;
      if (!result?.deliveryId) {
        throw { code: 'INTERNAL_ERROR', message: 'The delivery draft ID was not returned.' };
      }
      setDeliveryId(result.deliveryId);
      setSuccess('Delivery draft created. Review the accepted allocation before confirming it.');
      onRefresh();
    } catch (caught) {
      setError(caught as CommandFailure);
    } finally {
      setSaving(null);
    }
  }

  async function confirm() {
    if (!deliveryId) return;
    setSaving('confirm');
    setError(null);
    setSuccess(null);
    confirmKey.current ??= crypto.randomUUID();
    try {
      await postInventoryCommand(
        context,
        { commandType: 'ConfirmDelivery', deliveryId },
        confirmKey.current,
      );
      confirmKey.current = null;
      setSuccess('Delivery confirmed and the accepted allocation was posted to inventory.');
      setDeliveryId(null);
      onRefresh();
    } catch (caught) {
      setError(caught as CommandFailure);
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="dialog-form">
      <p className="muted-small">
        Accepted litres are allocated to the validated tank. Supplier note quantity remains a
        separate commercial comparison.
      </p>
      <form onSubmit={create}>
        <Field
          id="delivery-supplier"
          label="Supplier"
          hint={
            suppliers && suppliers.length === 0
              ? 'There are no suppliers to choose from yet. Add the supplier on the Suppliers page first, then come back.'
              : 'Every delivery must say who supplied it.'
          }
          required
        >
          <select
            id="delivery-supplier"
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
        <Field id="delivery-note-number" label="Delivery note number" required>
          <input
            id="delivery-note-number"
            value={deliveryNoteNumber}
            onChange={(event) => setDeliveryNoteNumber(event.target.value)}
            required
          />
        </Field>
        <Field
          id="delivery-supplier-reference"
          label="Supplier reference"
          hint="Optional supplier or purchase reference already recorded for this delivery."
          optional
        >
          <input
            id="delivery-supplier-reference"
            value={supplierReference}
            onChange={(event) => setSupplierReference(event.target.value)}
          />
        </Field>
        <Field
          id="delivery-no-po-reason"
          label="Purchase order"
          hint="Link this delivery to its purchase order on the Purchasing page, or say why there is none. One of the two is needed before the delivery can be confirmed."
        >
          <select
            id="delivery-no-po-reason"
            value={noPoReason}
            onChange={(event) => setNoPoReason(event.target.value)}
          >
            <option value="">I will link a purchase order</option>
            {NO_PO_REASON_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                No purchase order: {option.label}
              </option>
            ))}
          </select>
        </Field>
        {noPoReason === 'OTHER' ? (
          <Field id="delivery-no-po-note" label="Why is there no purchase order?" required>
            <input
              id="delivery-no-po-note"
              value={noPoNote}
              onChange={(event) => setNoPoNote(event.target.value)}
              maxLength={300}
              required
            />
          </Field>
        ) : null}
        <Field id="delivery-transporter" label="Transporter" optional>
          <input
            id="delivery-transporter"
            value={transporter}
            onChange={(event) => setTransporter(event.target.value)}
          />
        </Field>
        <Field id="delivery-driver" label="Driver" optional>
          <input
            id="delivery-driver"
            value={driver}
            onChange={(event) => setDriver(event.target.value)}
          />
        </Field>
        <Field id="delivery-truck-registration" label="Truck registration" optional>
          <input
            id="delivery-truck-registration"
            value={truckRegistration}
            onChange={(event) => setTruckRegistration(event.target.value)}
          />
        </Field>
        <Field id="delivery-seal-reference" label="Seal reference" optional>
          <input
            id="delivery-seal-reference"
            value={sealReference}
            onChange={(event) => setSealReference(event.target.value)}
          />
        </Field>
        <Field
          id="delivery-pre-dip-reference"
          label="Pre-delivery dip reference"
          hint="Optional existing tank-dip ID. This form does not create or alter the dip."
          optional
        >
          <input
            id="delivery-pre-dip-reference"
            value={preDeliveryDipId}
            onChange={(event) => setPreDeliveryDipId(event.target.value)}
            inputMode="text"
          />
        </Field>
        <Field
          id="delivery-post-dip-reference"
          label="Post-delivery dip reference"
          hint="Optional existing tank-dip ID. This form does not create or alter the dip."
          optional
        >
          <input
            id="delivery-post-dip-reference"
            value={postDeliveryDipId}
            onChange={(event) => setPostDeliveryDipId(event.target.value)}
            inputMode="text"
          />
        </Field>
        <Field id="delivery-delivered-at" label="Delivered at" required>
          <input
            id="delivery-delivered-at"
            type="datetime-local"
            value={deliveredAt}
            onChange={(event) => setDeliveredAt(event.target.value)}
            required
          />
        </Field>
        <Field id="delivery-note-litres" label="Note quantity litres" required>
          <input
            id="delivery-note-litres"
            value={noteQuantityLitres}
            onChange={(event) => setNoteQuantityLitres(event.target.value)}
            inputMode="decimal"
            required
          />
        </Field>
        <Field id="delivery-actual-litres" label="Actual received litres" required>
          <input
            id="delivery-actual-litres"
            value={actualQuantityLitres}
            onChange={(event) => setActualQuantityLitres(event.target.value)}
            inputMode="decimal"
            required
          />
        </Field>
        <Field id="delivery-allocation-litres" label="Accepted allocation to this tank" required>
          <input
            id="delivery-allocation-litres"
            value={allocationQuantityLitres}
            onChange={(event) => setAllocationQuantityLitres(event.target.value)}
            inputMode="decimal"
            required
          />
        </Field>
        <Button type="submit" loading={saving === 'create'}>
          Create delivery draft
        </Button>
      </form>
      {deliveryId ? (
        <div className="callout callout-warning">
          <strong>Draft awaiting confirmation</strong>
          <p>
            Review the server-calculated shortage/excess and allocation before posting delivery
            stock. Draft reference <code>{deliveryId}</code>.
          </p>
          <Button type="button" loading={saving === 'confirm'} onClick={() => void confirm()}>
            Confirm delivery
          </Button>
          <DocumentAttachments
            tenantId={context.tenantId}
            stationId={context.stationId}
            subjectType="FUEL_DELIVERY"
            subjectId={deliveryId}
            defaultKind="DELIVERY_NOTE"
            title="Delivery note and photos"
          />
        </div>
      ) : null}
      <CommandFeedback error={error} success={success} />
    </div>
  );
}

function ReceiptCostForm({
  context,
  source,
  enabled,
  onRefresh,
}: Readonly<{
  context: InventoryContext;
  source: MissingCostSource;
  enabled: boolean;
  onRefresh: () => void;
}>) {
  const key = useRef<string | null>(null);
  const [mode, setMode] = useState<'total' | 'buildup'>('total');
  const [amount, setAmount] = useState('');
  const [fuelCost, setFuelCost] = useState('');
  const [freight, setFreight] = useState('');
  const [otherLabel, setOtherLabel] = useState('');
  const [otherAmount, setOtherAmount] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [error, setError] = useState<CommandFailure | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    key.current ??= crypto.randomUUID();
    try {
      const body =
        mode === 'total'
          ? { amount }
          : {
              costBuildUp: {
                fuelCost: fuelCost.trim(),
                ...(freight.trim() ? { freight: freight.trim() } : {}),
                ...(otherLabel.trim() && otherAmount.trim()
                  ? { otherCosts: [{ label: otherLabel.trim(), amount: otherAmount.trim() }] }
                  : {}),
              },
            };
      await postInventoryCommand(
        context,
        { commandType: 'RecordReceiptCost', allocationId: source.sourceId, currency, ...body },
        key.current,
      );
      key.current = null;
      setSuccess('Receipt cost recorded. Refreshing the weighted-average cost.');
      setAmount('');
      setFuelCost('');
      setFreight('');
      setOtherLabel('');
      setOtherAmount('');
      onRefresh();
    } catch (caught) {
      setError(caught as CommandFailure);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="dialog-form" onSubmit={submit}>
      <p className="muted-small">
        Source allocation: <code>{source.sourceId}</code> · {source.quantityLitres} L. Missing cost
        must never be entered as zero.
      </p>
      {!enabled ? (
        <p className="context-required">
          Receipt-cost posting is unavailable for this permission scope.
        </p>
      ) : null}
      <div role="group" aria-label="How do you want to enter the cost?" className="button-row">
        <Button
          type="button"
          variant={mode === 'total' ? 'primary' : 'secondary'}
          aria-pressed={mode === 'total'}
          onClick={() => setMode('total')}
        >
          I know the total
        </Button>
        <Button
          type="button"
          variant={mode === 'buildup' ? 'primary' : 'secondary'}
          aria-pressed={mode === 'buildup'}
          onClick={() => setMode('buildup')}
        >
          Add up the costs
        </Button>
      </div>
      {mode === 'total' ? (
        <Field id="receipt-cost-amount" label="Authoritative receipt cost" required>
          <input
            id="receipt-cost-amount"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            required
            disabled={!enabled}
            placeholder="0.0000"
          />
        </Field>
      ) : (
        <>
          <p className="muted-small">
            Enter what the whole delivery cost. We divide the total by the litres that actually
            arrived, so a short delivery makes each litre cost more.
          </p>
          <Field id="receipt-fuel-cost" label="Cost of the fuel" required>
            <input
              id="receipt-fuel-cost"
              value={fuelCost}
              onChange={(event) => setFuelCost(event.target.value)}
              inputMode="decimal"
              required
              disabled={!enabled}
              placeholder="0.00"
            />
          </Field>
          <Field id="receipt-freight" label="Transport (freight)" optional>
            <input
              id="receipt-freight"
              value={freight}
              onChange={(event) => setFreight(event.target.value)}
              inputMode="decimal"
              disabled={!enabled}
              placeholder="0.00"
            />
          </Field>
          <Field id="receipt-other-label" label="Another cost, if any" optional>
            <input
              id="receipt-other-label"
              value={otherLabel}
              onChange={(event) => setOtherLabel(event.target.value)}
              maxLength={80}
              disabled={!enabled}
              placeholder="For example offloading"
            />
          </Field>
          <Field id="receipt-other-amount" label="Amount of that cost" optional>
            <input
              id="receipt-other-amount"
              value={otherAmount}
              onChange={(event) => setOtherAmount(event.target.value)}
              inputMode="decimal"
              disabled={!enabled}
              placeholder="0.00"
            />
          </Field>
        </>
      )}
      <Field id="receipt-cost-currency" label="Currency" required>
        <input
          id="receipt-cost-currency"
          value={currency}
          onChange={(event) => setCurrency(event.target.value.toUpperCase())}
          maxLength={3}
          required
          disabled={!enabled}
        />
      </Field>
      <CommandFeedback error={error} success={success} />
      <Button
        type="submit"
        loading={saving}
        disabled={!enabled || (mode === 'total' ? !amount : !fuelCost)}
      >
        Record receipt cost
      </Button>
    </form>
  );
}

export function InventoryContextRequired() {
  return (
    <Card className="panel">
      <ContextRequiredState
        headingLevel={2}
        title="Choose a station to view inventory"
        message="Use the station selector above to choose a station. Inventory is shown for one station at a time."
      />
    </Card>
  );
}
