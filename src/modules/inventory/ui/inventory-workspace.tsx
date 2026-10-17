'use client';

import { useRef, useState, type FormEvent, type ReactNode } from 'react';

import { Button, Card, ErrorState, Field, SuccessState } from '@/design-system/primitives';

export type InventoryContext = Readonly<{
  tenantId: string;
  stationId: string;
  stationName: string;
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

type DeliveryReceiptSummary = Readonly<{
  receiptKind: 'FULL' | 'PARTIAL' | 'EXCESS';
  noteQuantityLitres: string;
  actualQuantityLitres: string;
  shortageExcessLitres: string;
  allocatedQuantityLitres: string;
}>;

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
        <ActionDisclosure title="Record tank calibration chart">
          <CalibrationChartForm context={context} tankId={tankId} onRefresh={onRefresh} />
        </ActionDisclosure>
        <ActionDisclosure title="Post stock adjustment">
          <AdjustmentForm context={context} tankId={tankId} onRefresh={onRefresh} />
        </ActionDisclosure>
        <ActionDisclosure title="Record opening inventory">
          <OpeningInventoryForm context={context} tankId={tankId} onRefresh={onRefresh} />
        </ActionDisclosure>
        <ActionDisclosure title="Record delivery receipt">
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
  const [physicalLitres, setPhysicalLitres] = useState('');
  const [rawMeasurement, setRawMeasurement] = useState('');
  const [measurementUnit, setMeasurementUnit] = useState('');
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
          ...(physicalLitres.trim() ? { physicalLitres: physicalLitres.trim() } : {}),
          ...(rawMeasurement.trim() ? { rawMeasurement: rawMeasurement.trim() } : {}),
          ...(measurementUnit.trim() ? { measurementUnit: measurementUnit.trim() } : {}),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        },
        key.current,
      );
      key.current = null;
      setSuccess('The physical dip was recorded without changing book stock.');
      setPhysicalLitres('');
      setRawMeasurement('');
      setMeasurementUnit('');
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
        A dip is a physical observation. It never silently adjusts book inventory. Enter direct
        litres, or use a raw measurement after an approved calibration chart has been recorded.
      </p>
      <Field id="dip-litres" label="Physical litres" optional>
        <input
          id="dip-litres"
          value={physicalLitres}
          onChange={(event) => setPhysicalLitres(event.target.value)}
          inputMode="decimal"
          placeholder="0.000"
        />
      </Field>
      <Field id="dip-raw-measurement" label="Raw chart measurement" optional>
        <input
          id="dip-raw-measurement"
          value={rawMeasurement}
          onChange={(event) => setRawMeasurement(event.target.value)}
          inputMode="decimal"
          placeholder="Only when using calibration"
        />
      </Field>
      <Field id="dip-measurement-unit" label="Measurement unit" optional>
        <input
          id="dip-measurement-unit"
          value={measurementUnit}
          onChange={(event) => setMeasurementUnit(event.target.value)}
          placeholder="e.g. mm"
        />
      </Field>
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

function CalibrationChartForm({
  context,
  tankId,
  onRefresh,
}: Readonly<{ context: InventoryContext; tankId: string; onRefresh: () => void }>) {
  const key = useRef<string | null>(null);
  const [measurementUnit, setMeasurementUnit] = useState('');
  const [points, setPoints] = useState('0,0\n100,1000');
  const [error, setError] = useState<CommandFailure | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function parsePoints(): Array<{
    measurementValue: string;
    litres: string;
    measurementUnit: string;
  }> {
    return points
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line, index) => {
        const [measurementValue, litres] = line.split(',').map((item) => item?.trim() ?? '');
        if (!measurementValue || !litres) {
          throw new Error(`Calibration line ${index + 1} must be measurement,litres.`);
        }
        return { measurementValue, litres, measurementUnit: measurementUnit.trim() };
      });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    key.current ??= crypto.randomUUID();
    try {
      const parsedPoints = parsePoints();
      if (!measurementUnit.trim()) throw new Error('A measurement unit is required.');
      await postInventoryCommand(
        context,
        { commandType: 'RecordTankCalibrationChart', tankId, points: parsedPoints },
        key.current,
      );
      key.current = null;
      setSuccess('The calibration chart was recorded. Future raw dips can use its approved range.');
      onRefresh();
    } catch (caught) {
      setError({
        code: caught instanceof Error ? 'VALIDATION_FAILED' : 'INTERNAL_ERROR',
        message:
          caught instanceof Error ? caught.message : 'The calibration chart could not be recorded.',
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="dialog-form" onSubmit={submit}>
      <p className="muted-small">
        Enter one approved chart point per line as <code>measurement,litres</code>. Points must be
        monotonic and cover any raw measurement you later capture.
      </p>
      <Field id="calibration-unit" label="Measurement unit" required>
        <input
          id="calibration-unit"
          value={measurementUnit}
          onChange={(event) => setMeasurementUnit(event.target.value)}
          placeholder="e.g. mm"
          required
        />
      </Field>
      <Field id="calibration-points" label="Chart points" required hint="Example: 100,1000">
        <textarea
          id="calibration-points"
          value={points}
          onChange={(event) => setPoints(event.target.value)}
          rows={6}
          required
        />
      </Field>
      <CommandFeedback error={error} success={success} />
      <Button type="submit" loading={saving}>
        Record calibration chart
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
  const [quantityLitres, setQuantityLitres] = useState('');
  const [effectiveAt, setEffectiveAt] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [error, setError] = useState<CommandFailure | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState<'quantity' | 'cost' | null>(null);

  async function submitQuantity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving('quantity');
    setError(null);
    setSuccess(null);
    quantityKey.current ??= crypto.randomUUID();
    try {
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
      quantityKey.current = null;
      setSuccess('The opening quantity was posted. Add its authoritative cost below when known.');
      setQuantityLitres('');
      setEffectiveAt('');
      onRefresh();
    } catch (caught) {
      setError(caught as CommandFailure);
    } finally {
      setSaving(null);
    }
  }

  async function submitCost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving('cost');
    setError(null);
    setSuccess(null);
    costKey.current ??= crypto.randomUUID();
    try {
      await postInventoryCommand(
        context,
        { commandType: 'RecordOpeningInventoryCost', tankId, amount, currency: currency.trim() },
        costKey.current,
      );
      costKey.current = null;
      setSuccess('The opening inventory cost was recorded in the costing ledger.');
      setAmount('');
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
        Opening quantity and opening cost are separate authoritative commands. Do not enter an
        unknown cost as zero.
      </p>
      <form onSubmit={submitQuantity}>
        <Field id="opening-litres" label="Opening quantity litres" required>
          <input
            id="opening-litres"
            value={quantityLitres}
            onChange={(event) => setQuantityLitres(event.target.value)}
            inputMode="decimal"
            required
            placeholder="0.000"
          />
        </Field>
        <Field id="opening-effective-at" label="Effective at" required>
          <input
            id="opening-effective-at"
            type="datetime-local"
            value={effectiveAt}
            onChange={(event) => setEffectiveAt(event.target.value)}
            required
          />
        </Field>
        <Button type="submit" loading={saving === 'quantity'}>
          Post opening quantity
        </Button>
      </form>
      <form onSubmit={submitCost}>
        <Field id="opening-cost" label="Authoritative inventory value" required>
          <input
            id="opening-cost"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
            required
            placeholder="0.0000"
          />
        </Field>
        <Field id="opening-currency" label="Currency" required>
          <input
            id="opening-currency"
            value={currency}
            onChange={(event) => setCurrency(event.target.value.toUpperCase())}
            maxLength={3}
            required
          />
        </Field>
        <Button type="submit" loading={saving === 'cost'}>
          Record opening cost
        </Button>
      </form>
      <CommandFeedback error={error} success={success} />
    </div>
  );
}

function DeliveryForm({
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
  const [receiptSummary, setReceiptSummary] = useState<DeliveryReceiptSummary | null>(null);
  const [deliveryNoteNumber, setDeliveryNoteNumber] = useState('');
  const [deliveredAt, setDeliveredAt] = useState('');
  const [noteQuantityLitres, setNoteQuantityLitres] = useState('');
  const [actualQuantityLitres, setActualQuantityLitres] = useState('');
  const [allocationQuantityLitres, setAllocationQuantityLitres] = useState('');
  const [error, setError] = useState<CommandFailure | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState<'create' | 'confirm' | null>(null);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving('create');
    setError(null);
    setSuccess(null);
    createKey.current ??= crypto.randomUUID();
    try {
      const result = (await postInventoryCommand(
        context,
        {
          commandType: 'CreateDelivery',
          productId,
          deliveryNoteNumber: deliveryNoteNumber.trim(),
          deliveredAt: isoFromLocal(deliveredAt),
          noteQuantityLitres,
          actualQuantityLitres,
          allocations: [{ tankId, quantityLitres: allocationQuantityLitres }],
        },
        createKey.current,
      )) as ({ deliveryId?: string } & Partial<DeliveryReceiptSummary>) | null;
      createKey.current = null;
      if (!result?.deliveryId)
        throw { code: 'INTERNAL_ERROR', message: 'The delivery draft ID was not returned.' };
      if (
        !result.receiptKind ||
        !result.noteQuantityLitres ||
        !result.actualQuantityLitres ||
        !result.shortageExcessLitres ||
        !result.allocatedQuantityLitres
      ) {
        throw {
          code: 'INTERNAL_ERROR',
          message: 'The delivery receipt summary was not returned. Nothing was confirmed.',
        };
      }
      setDeliveryId(result.deliveryId);
      setReceiptSummary({
        receiptKind: result.receiptKind,
        noteQuantityLitres: result.noteQuantityLitres,
        actualQuantityLitres: result.actualQuantityLitres,
        shortageExcessLitres: result.shortageExcessLitres,
        allocatedQuantityLitres: result.allocatedQuantityLitres,
      });
      setSuccess(
        result.receiptKind === 'PARTIAL'
          ? 'Partial receipt draft created. Review the shortage before confirming it.'
          : 'Delivery draft created. Review the accepted allocation before confirming it.',
      );
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
      setSuccess(
        receiptSummary?.receiptKind === 'PARTIAL'
          ? 'Partial receipt confirmed and only the accepted litres were posted to inventory.'
          : 'Delivery confirmed and the accepted allocation was posted to inventory.',
      );
      setDeliveryId(null);
      setReceiptSummary(null);
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
        <Field id="delivery-note-number" label="Delivery note number" required>
          <input
            id="delivery-note-number"
            value={deliveryNoteNumber}
            onChange={(event) => setDeliveryNoteNumber(event.target.value)}
            required
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
        <Field
          id="delivery-actual-litres"
          label="Accepted/actual receipt litres"
          hint="Enter only the litres physically accepted. A value below the note quantity is a partial receipt."
          required
        >
          <input
            id="delivery-actual-litres"
            value={actualQuantityLitres}
            onChange={(event) => setActualQuantityLitres(event.target.value)}
            inputMode="decimal"
            required
          />
        </Field>
        <Field
          id="delivery-allocation-litres"
          label="Accepted allocation to this tank"
          hint="The allocation must equal accepted receipt litres before confirmation."
          required
        >
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
            Review the server-calculated receipt classification, shortage/excess and allocation
            before posting delivery stock. Draft reference <code>{deliveryId}</code>.
          </p>
          {receiptSummary ? (
            <dl className="summary-list">
              <div>
                <dt>Receipt</dt>
                <dd>{receiptSummary.receiptKind}</dd>
              </div>
              <div>
                <dt>Accepted</dt>
                <dd>{receiptSummary.actualQuantityLitres} L</dd>
              </div>
              <div>
                <dt>Note quantity</dt>
                <dd>{receiptSummary.noteQuantityLitres} L</dd>
              </div>
              <div>
                <dt>Shortage/excess</dt>
                <dd>{receiptSummary.shortageExcessLitres} L</dd>
              </div>
              <div>
                <dt>Allocated</dt>
                <dd>{receiptSummary.allocatedQuantityLitres} L</dd>
              </div>
            </dl>
          ) : null}
          <Button type="button" loading={saving === 'confirm'} onClick={() => void confirm()}>
            Confirm delivery
          </Button>
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
  const [amount, setAmount] = useState('');
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
      await postInventoryCommand(
        context,
        { commandType: 'RecordReceiptCost', allocationId: source.sourceId, amount, currency },
        key.current,
      );
      key.current = null;
      setSuccess('Receipt cost recorded. Refreshing the persisted WAC projection.');
      setAmount('');
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
      <Button type="submit" loading={saving} disabled={!enabled || !amount}>
        Record receipt cost
      </Button>
    </form>
  );
}

export function InventoryContextRequired() {
  return (
    <Card className="panel">
      <h1>Inventory needs a station context</h1>
      <p>
        Choose an authorised legal entity and station using the shared work-context selector before
        opening an operational Inventory workflow. All stations is not valid for Inventory commands.
      </p>
    </Card>
  );
}
