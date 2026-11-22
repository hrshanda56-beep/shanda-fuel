'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
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
import { InfoTip } from '@/design-system/info-tip';
import { OTHER_VALUE, SelectWithOther } from '@/design-system/forms';
import {
  WizardActions,
  WizardNotice,
  WizardPair,
  WizardStep,
  WIZARD_REVIEW_HINT,
  WizardSummary,
  WizardSummaryRow,
  useWizard,
} from '@/design-system/wizard';
import {
  checkDips,
  checkNote,
  checkReceived,
  checkSupplier,
  checkTank,
  checkWater,
} from '../delivery-checks';
import { friendlyMessage } from '../../purchasing/ui/purchasing-client';
import {
  LINKED_CHOICE,
  buildPurchaseOrderStep,
  noPoReasonLabel,
  parsePurchaseOrderChoice,
  purchaseOrderChoiceProblem,
} from '../purchase-order-choice';
import {
  EMPTY_VARIANCE_REASON,
  VarianceReason,
  varianceFields,
  type VarianceReasonValue,
} from './variance-reason';
import { PurchaseOrderChoice } from './purchase-order-choice';

type Failure = { message: string; code?: string; status?: number; step?: 'confirm' };
/** What is typed so far, kept on this device so a dropped connection does not lose it. */
type DeliveryDraft = {
  supplierId: string;
  tankId: string;
  deliveryNote: string;
  noteLitres: string;
  receivedLitres: string;
  /** Who brought it: '' not said, 'SUPPLIER', a transporter's id, or OTHER_VALUE (typed below). */
  carrier?: string;
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
    /** Who brought it, as for a new delivery. */
    carrier: string;
    /** The typed name, when the carrier is not one of the suppliers. */
    transporter: string;
    driver: string;
    truck: string;
    compartments: readonly CompartmentRow[];
    water: '' | 'PASS' | 'FAIL';
    waterMm: string;
    driverConfirmed: boolean;
    /** The no-purchase-order reason already saved, or empty. */
    noPo: string;
    noPoNote: string;
    /** The number of the purchase order the delivery is already linked to, or empty. */
    linkedOrder: string;
    /** Why the litres received differ from the note, as already saved. */
    variance?: VarianceReasonValue;
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
  /** The purchase-order answer is saved: a reason was recorded or the order was linked. */
  purchaseOrder?: boolean;
};

/** The reason a choice stands for, or empty when it is an order or not answered. */
function reasonOf(choice: string): string {
  const parsed = parsePurchaseOrderChoice(choice);
  return parsed.kind === 'REASON' ? parsed.reason : '';
}

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

/** The truck compartments: what each held on the note and on arrival, and its seals. */
function CompartmentFields({
  rows,
  onChange,
}: {
  rows: CompartmentRow[];
  onChange: (update: (rows: CompartmentRow[]) => CompartmentRow[]) => void;
}) {
  const set = (index: number, patch: Partial<CompartmentRow>) =>
    onChange((current) => current.map((item, at) => (at === index ? { ...item, ...patch } : item)));
  return (
    <>
      {rows.map((row, index) => (
        <div key={row.number} className="rd-compartment">
          <strong>Compartment {row.number}</strong>
          <div className="rd-grid">
            <Field id={`rd-c${row.number}-note`} label="On the note" required>
              <input
                id={`rd-c${row.number}-note`}
                inputMode="decimal"
                value={row.noteLitres}
                onChange={(event) => set(index, { noteLitres: event.target.value })}
              />
            </Field>
            <Field id={`rd-c${row.number}-received`} label="Received" required>
              <input
                id={`rd-c${row.number}-received`}
                inputMode="decimal"
                value={row.receivedLitres}
                onChange={(event) => set(index, { receivedLitres: event.target.value })}
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
              onChange={(event) => set(index, { seals: event.target.value })}
            />
          </Field>
        </div>
      ))}
      <Button
        type="button"
        variant="secondary"
        onClick={() => onChange((current) => [...current, emptyCompartment(current.length + 1)])}
      >
        Add a compartment
      </Button>
    </>
  );
}

type GuideStep =
  | 'supplier'
  | 'tank'
  | 'note'
  | 'received'
  | 'po'
  | 'truck'
  | 'dips'
  | 'compartments'
  | 'water'
  | 'review';

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
 * the driver's confirmation. It also asks whether there is a purchase order, which must be
 * answered before the delivery can be confirmed. The steps are saved in order and a
 * failed step can simply be retried: the ones that worked are not repeated.
 */
/** Who carried the fuel last time for a supplier, kept on this device only. */
const lastCarrierKey = (supplierId: string) => `shanda:last-carrier:${supplierId}`;
function rememberedCarrier(supplierId: string): string {
  try {
    return window.localStorage.getItem(lastCarrierKey(supplierId)) ?? '';
  } catch {
    return '';
  }
}
function rememberCarrier(supplierId: string, carrier: string) {
  try {
    // A typed name is not remembered: it is a one-off, and the next delivery may differ.
    if (carrier && carrier !== OTHER_VALUE) {
      window.localStorage.setItem(lastCarrierKey(supplierId), carrier);
    } else window.localStorage.removeItem(lastCarrierKey(supplierId));
  } catch {
    // Remembering is a convenience; saving the delivery never depends on it.
  }
}

export function RecordDelivery({
  tenantId,
  stationId,
  tanks,
  framed = true,
  edit,
  onCancel,
}: Readonly<{
  tenantId: string;
  stationId: string;
  tanks: readonly DeliveryTank[];
  /** False when the form sits inside a dialog that already supplies the title and card. */
  framed?: boolean;
  /** Set to change a delivery that is already recorded, instead of recording a new one. */
  edit?: DeliveryEdit;
  /** Called when Back is pressed on the first question, so the dialog can close. */
  onCancel?: () => void;
}>) {
  const router = useRouter();
  const progress = useRef<Progress>({});
  const keys = useRef(new Map<string, string>());
  const start = edit?.start;
  const [suppliers, setSuppliers] = useState<
    | {
        id: string;
        label: string;
        name: string;
        providesFuel: boolean;
        providesTransport: boolean;
      }[]
    | null
  >(null);
  const [supplierId, setSupplierId] = useState(start?.supplierId ?? '');
  const [tankId, setTankId] = useState(start?.tankId ?? tanks[0]?.id ?? '');
  const [deliveryNote, setDeliveryNote] = useState(start?.deliveryNote ?? '');
  const [deliveredAt, setDeliveredAt] = useState(() =>
    start ? toLocalInput(start.deliveredAt) : localNow(),
  );
  const [noteLitres, setNoteLitres] = useState(start?.noteLitres ?? '');
  const [receivedLitres, setReceivedLitres] = useState(start?.receivedLitres ?? '');
  const [carrier, setCarrier] = useState(start?.carrier ?? '');
  // Set once the person chooses (or a draft is restored), so a remembered carrier never overrides them.
  const carrierPicked = useRef(Boolean(start?.carrier));
  const pickCarrier = (value: string) => {
    carrierPicked.current = true;
    setCarrier(value);
  };
  const [transporter, setTransporter] = useState(start?.transporter ?? '');
  const [driver, setDriver] = useState(start?.driver ?? '');
  const [truck, setTruck] = useState(start?.truck ?? '');
  const [variance, setVariance] = useState<VarianceReasonValue>(
    start?.variance ?? EMPTY_VARIANCE_REASON,
  );
  const [dipBefore, setDipBefore] = useState('');
  const [dipAfter, setDipAfter] = useState('');
  const [compartments, setCompartments] = useState<CompartmentRow[]>(() =>
    start ? start.compartments.map((row) => ({ ...row })) : [],
  );
  const [water, setWater] = useState<'' | 'PASS' | 'FAIL'>(start?.water ?? '');
  const [waterMm, setWaterMm] = useState(start?.waterMm ?? '');
  const [driverConfirmed, setDriverConfirmed] = useState(start?.driverConfirmed ?? false);
  /** What the purchase-order question holds: empty, a no-order reason, or an order to link. */
  const initialChoice = start?.noPo || (start?.linkedOrder ? LINKED_CHOICE : '');
  const [noPo, setNoPo] = useState<string>(initialChoice);
  const [noPoNote, setNoPoNote] = useState(start?.noPoNote ?? '');
  const [busy, setBusy] = useState<'record' | 'confirm' | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [deliveryId, setDeliveryId] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  /** True once the purchase-order answer is saved, so the one-step-left panel need not ask again. */
  const [poSaved, setPoSaved] = useState(false);
  const [poError, setPoError] = useState<string | null>(null);
  const [stepUpOpen, setStepUpOpen] = useState(false);

  const tank = tanks.find((item) => item.id === tankId);
  const onPoChange = useCallback((next: { value: string; note: string }) => {
    setNoPo(next.value);
    setNoPoNote(next.note);
    setPoError(null);
  }, []);
  const difference = shortageOrExcess(noteLitres, receivedLitres, tank?.unit);
  const unitWord = tank?.unit === 'KILOGRAMS' ? 'kilograms' : 'litres';
  const UnitWord = tank?.unit === 'KILOGRAMS' ? 'Kilograms' : 'Litres';
  const sumProblem = useMemo(
    () => compartmentSumProblem(compartments, noteLitres, receivedLitres, tank?.unit),
    [compartments, noteLitres, receivedLitres, tank?.unit],
  );

  // A new delivery is recorded one question at a time. Changing one that exists keeps the form.
  const guided = !edit;
  const guideSteps: readonly GuideStep[] = [
    'supplier',
    ...(tanks.length > 1 ? (['tank'] as const) : []),
    'note',
    'received',
    'po',
    'truck',
    'dips',
    'compartments',
    'water',
    'review',
  ];
  const wizard = useWizard<GuideStep>({
    start: 'supplier',
    sequence: guideSteps,
    onCancel: () => onCancel?.(),
  });

  // The draft is offered back, never applied silently, and goes once the delivery is recorded.
  const draftKey = draftStorageKey(['delivery', tenantId, stationId]);
  const [restored, setRestored] = useState(false);
  const typed: DeliveryDraft = {
    supplierId,
    tankId,
    deliveryNote,
    noteLitres,
    receivedLitres,
    carrier,
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
  // Companies that only carry fuel are not offered as "who supplied it"; a saved supplier stays visible.
  const fuelSuppliers = (suppliers ?? []).filter(
    (item) => item.providesFuel || item.id === supplierId,
  );
  const carrierSupplierId =
    carrier === 'SUPPLIER'
      ? supplierId || null
      : carrier && carrier !== OTHER_VALUE
        ? carrier
        : null;
  const carrierName =
    carrier === 'SUPPLIER'
      ? (suppliers?.find((item) => item.id === supplierId)?.name ?? '')
      : carrier === OTHER_VALUE
        ? transporter.trim()
        : (suppliers?.find((item) => item.id === carrier)?.name ?? '');
  /** What the server is told. A chosen company wins; otherwise the typed name is kept. */
  const carrierFields = {
    transporterSupplierId: carrierSupplierId,
    transporter: carrier === OTHER_VALUE ? transporter.trim() || null : null,
  };
  const carrierField = (id: string, label: string, optional = true) => (
    <Field
      id={id}
      label={label}
      hint="Transport is billed separately by whoever carries the fuel."
      optional={optional}
    >
      <SelectWithOther
        id={id}
        placeholder="Not said"
        options={[
          ...(supplierId
            ? [
                {
                  value: 'SUPPLIER',
                  label: `${suppliers?.find((item) => item.id === supplierId)?.name ?? 'The supplier'} (the supplier)`,
                },
              ]
            : []),
          ...(suppliers ?? [])
            .filter((item) => item.providesTransport && item.id !== supplierId)
            .map((item) => ({ value: item.id, label: item.name })),
        ]}
        choice={carrier}
        onChoice={pickCarrier}
        otherLabel="Someone else"
        detailLabel="Transporter's name"
        detail={transporter}
        onDetail={setTransporter}
        detailMaxLength={120}
      />
    </Field>
  );
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
    // A new delivery starts with whoever carried this supplier's fuel last time. It is only a
    // starting point: the person can change it, and a saved delivery is never altered by it.
    if (edit || carrierPicked.current || !supplierId || suppliers === null) return;
    const remembered = rememberedCarrier(supplierId);
    const usable =
      remembered === 'SUPPLIER' ||
      suppliers.some((item) => item.id === remembered && item.providesTransport);
    // Not picked by the person, so the carrier is only ever this suggestion; follow the supplier.
    setCarrier(usable ? remembered : '');
  }, [edit, supplierId, suppliers]);
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
    setCarrier(draft.carrier ?? (draft.transporter ? OTHER_VALUE : ''));
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
    carrierPicked.current = true;
  }
  function startAgain() {
    clearDraft(draftKey);
    applyDraft({
      supplierId: '',
      tankId: tanks[0]?.id ?? '',
      deliveryNote: '',
      noteLitres: '',
      receivedLitres: '',
      carrier: '',
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
    carrierPicked.current = false;
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
      .then(
        (body: {
          data: {
            id: string;
            code: string;
            name: string;
            providesFuel?: boolean;
            providesTransport?: boolean;
          }[];
        }) =>
          setSuppliers(
            body.data.map((row) => ({
              id: row.id,
              label: `${row.name} (${row.code})`,
              name: row.name,
              providesFuel: row.providesFuel ?? true,
              providesTransport: row.providesTransport ?? false,
            })),
          ),
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
      carrier !== before.carrier ||
      (carrier === OTHER_VALUE && transporter.trim() !== before.transporter) ||
      driver.trim() !== before.driver ||
      truck.trim() !== before.truck ||
      JSON.stringify(varianceFields(variance)) !==
        JSON.stringify(varianceFields(before.variance ?? EMPTY_VARIANCE_REASON)) ||
      reasonOf(noPo) !== before.noPo ||
      (reasonOf(noPo) === 'OTHER' && noPoNote.trim() !== before.noPoNote);
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
        ...carrierFields,
        driver: driver.trim() || null,
        truckRegistration: truck.trim() || null,
        noPoReason: reasonOf(noPo) || null,
        noPoNote: reasonOf(noPo) === 'OTHER' ? noPoNote.trim() : null,
        ...varianceFields(variance),
      });
      state.updated = true;
    }
    if (parsePurchaseOrderChoice(noPo).kind === 'LINK' && !state.purchaseOrder) {
      const step = buildPurchaseOrderStep(noPo, noPoNote, {
        tenantId,
        stationId,
        deliveryId: target.deliveryId,
      });
      if (step) {
        try {
          await post(step.url, `po:${noPo}`, step.body);
        } catch (caught) {
          throw new Error(
            friendlyMessage(
              caught instanceof Error ? caught.message : '',
              'The purchase order could not be linked. Try again, or choose another answer.',
            ),
          );
        }
      }
      state.purchaseOrder = true;
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
    // The answer is asked once. After the delivery exists, the one-step-left panel takes over.
    const choiceProblem = progress.current.deliveryId
      ? null
      : purchaseOrderChoiceProblem(noPo, noPoNote);
    if (choiceProblem) {
      setFailure({ message: choiceProblem });
      return;
    }
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
          ...(carrierFields.transporterSupplierId
            ? { transporterSupplierId: carrierFields.transporterSupplierId }
            : carrierFields.transporter
              ? { transporter: carrierFields.transporter }
              : {}),
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
          ...(reasonOf(noPo) ? { noPoReason: reasonOf(noPo) } : {}),
          ...(reasonOf(noPo) === 'OTHER' && noPoNote.trim() ? { noPoNote: noPoNote.trim() } : {}),
          ...varianceFields(variance),
        });
        state.deliveryId = String(result.deliveryId);
        setDeliveryId(state.deliveryId);
        rememberCarrier(supplierId, carrier);
        if (reasonOf(noPo)) {
          state.purchaseOrder = true;
          setPoSaved(true);
        } else {
          // Linking an order needs the saved delivery. If it cannot be linked (for example the
          // person may not link orders) the panel below asks again instead of leaving a dead end.
          const step = buildPurchaseOrderStep(noPo, noPoNote, {
            tenantId,
            stationId,
            deliveryId: state.deliveryId,
          });
          try {
            if (step) await post(step.url, `po:${noPo}`, step.body);
            state.purchaseOrder = true;
            setPoSaved(true);
          } catch (caught) {
            setPoError(
              `We could not link that order. ${friendlyMessage(caught instanceof Error ? caught.message : '', 'Try again, or choose another answer.')}`,
            );
            setNoPo('');
          }
        }
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
    setFailure(null);
    if (!poSaved) {
      const problem = purchaseOrderChoiceProblem(noPo, noPoNote);
      if (problem) {
        setFailure({ message: problem, step: 'confirm' });
        return;
      }
    }
    setBusy('confirm');
    try {
      if (!poSaved) {
        const step = buildPurchaseOrderStep(noPo, noPoNote, { tenantId, stationId, deliveryId });
        try {
          if (step) await post(step.url, `po:${noPo}:${noPoNote.trim()}`, step.body);
        } catch (caught) {
          throw new Error(
            friendlyMessage(
              caught instanceof Error ? caught.message : '',
              'The purchase order answer could not be saved. Try again.',
            ),
          );
        }
        setPoSaved(true);
        setPoError(null);
      }
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
  const { step, errors } = wizard;
  const after = guideSteps[guideSteps.indexOf(step) + 1] ?? 'review';
  const choiceProblem = purchaseOrderChoiceProblem(noPo, noPoNote);
  const filledCompartments = compartments.filter(
    (row) => row.noteLitres.trim() || row.receivedLitres.trim(),
  );

  function guideNext() {
    if (step === 'supplier') return wizard.advance(checkSupplier(supplierId), after, 'review');
    if (step === 'tank') return wizard.advance(checkTank(tankId), after, 'review');
    if (step === 'note') {
      return wizard.advance(checkNote(deliveryNote, deliveredAt, noteLitres), after, 'review');
    }
    if (step === 'received') return wizard.advance(checkReceived(receivedLitres), after, 'review');
    if (step === 'po') {
      return wizard.advance(
        choiceProblem ? { 'rd-po-choice': choiceProblem } : {},
        after,
        'review',
      );
    }
    if (step === 'dips') return wizard.advance(checkDips(dipBefore, dipAfter), after, 'review');
    if (step === 'compartments') {
      return wizard.advance(
        sumProblem ? { 'rd-add-compartment': sumProblem } : {},
        after,
        'review',
      );
    }
    if (step === 'water') return wizard.advance(checkWater(water, waterMm), after, 'review');
    if (step === 'truck') return wizard.advance({}, after, 'review');
    // The last screen saves. Anything still wrong is shown on the screen that holds it.
    if (choiceProblem) return wizard.change('po');
    if (sumProblem) return wizard.change('compartments');
    void record();
  }

  const unanswered = 'Not given';
  const orderAnswer = (() => {
    const choice = parsePurchaseOrderChoice(noPo);
    if (choice.kind === 'LINK') return 'Linked to an open order';
    if (choice.kind === 'REASON') {
      return choice.reason === 'OTHER' && noPoNote.trim()
        ? `No order: ${noPoNote.trim()}`
        : `No order: ${noPoReasonLabel(choice.reason)}`;
    }
    return 'Not answered yet';
  })();

  /** One question at a time. The form below is kept for changing a delivery that exists. */
  const guide = (
    <form
      className="form-stack"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        guideNext();
      }}
      onChange={() => {
        touched.current = true;
      }}
    >
      {step === 'supplier' ? (
        <WizardStep
          wizard={wizard}
          title="Who delivered the fuel?"
          hint="Choose the supplier named on the delivery note."
        >
          <Field id="rd-supplier" label="Supplier" error={errors['rd-supplier']} required>
            <select
              id="rd-supplier"
              value={supplierId}
              onChange={(event) => setSupplierId(event.target.value)}
              disabled={suppliers === null}
            >
              <option value="">
                {suppliers === null ? 'Loading suppliers…' : 'Choose a supplier'}
              </option>
              {fuelSuppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.label}
                </option>
              ))}
            </select>
          </Field>
          <WizardActions wizard={wizard} onContinue={guideNext} />
        </WizardStep>
      ) : null}
      {step === 'tank' ? (
        <WizardStep
          wizard={wizard}
          title="Which fuel, and which tank?"
          hint="Choose what was delivered and where it was poured."
        >
          <Field id="rd-tank" label="Fuel and tank" error={errors['rd-tank']} required>
            <select id="rd-tank" value={tankId} onChange={(event) => setTankId(event.target.value)}>
              {tanks.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.productName} · tank {item.code}
                </option>
              ))}
            </select>
          </Field>
          <WizardActions wizard={wizard} onContinue={guideNext} />
        </WizardStep>
      ) : null}
      {step === 'note' ? (
        <WizardStep
          wizard={wizard}
          title="What does the delivery note say?"
          hint="Copy these from the driver's paperwork."
        >
          <Field
            id="rd-note-number"
            label="Delivery note number"
            error={errors['rd-note-number']}
            required
          >
            <input
              id="rd-note-number"
              autoComplete="off"
              autoFocus
              value={deliveryNote}
              onChange={(event) => setDeliveryNote(event.target.value)}
            />
          </Field>
          <WizardPair>
            <Field
              id="rd-delivered-at"
              label="Delivered at"
              error={errors['rd-delivered-at']}
              required
            >
              <input
                id="rd-delivered-at"
                type="datetime-local"
                value={deliveredAt}
                onChange={(event) => setDeliveredAt(event.target.value)}
              />
            </Field>
            <Field
              id="rd-note-litres"
              label={`${UnitWord} on the note`}
              error={errors['rd-note-litres']}
              required
            >
              <input
                id="rd-note-litres"
                inputMode="decimal"
                autoComplete="off"
                value={noteLitres}
                onChange={(event) => setNoteLitres(event.target.value)}
              />
            </Field>
          </WizardPair>
          <WizardActions wizard={wizard} onContinue={guideNext} />
        </WizardStep>
      ) : null}
      {step === 'received' ? (
        <WizardStep
          wizard={wizard}
          title={`How many ${unitWord} did you actually receive?`}
          hint="Use the tank dip or the meter, not the note."
        >
          <Field
            id="rd-received-litres"
            label={`${UnitWord} actually received`}
            error={errors['rd-received-litres']}
            required
          >
            <input
              id="rd-received-litres"
              inputMode="decimal"
              autoComplete="off"
              autoFocus
              value={receivedLitres}
              onChange={(event) => setReceivedLitres(event.target.value)}
            />
          </Field>
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
          {difference && difference.kind !== 'EXACT' ? (
            <VarianceReason value={variance} onChange={setVariance} />
          ) : null}
          <WizardActions wizard={wizard} onContinue={guideNext} />
        </WizardStep>
      ) : null}
      {step === 'po' ? (
        <WizardStep
          wizard={wizard}
          title="Is there a purchase order for this delivery?"
          hint="Linking an order lets us check the price and quantity."
        >
          <PurchaseOrderChoice
            id="rd-po"
            tenantId={tenantId}
            stationId={stationId}
            supplierId={supplierId}
            productId={tank?.productId ?? ''}
            value={noPo}
            note={noPoNote}
            onChange={onPoChange}
            error={errors['rd-po-choice']}
          />
          <WizardActions wizard={wizard} onContinue={guideNext} />
        </WizardStep>
      ) : null}
      {step === 'truck' ? (
        <WizardStep
          wizard={wizard}
          title="Who brought it?"
          hint="You can leave this empty and carry on."
        >
          {carrierField('rd-transporter', 'Who is the transporter?')}
          <WizardPair>
            <Field id="rd-truck" label="Truck registration" optional>
              <input
                id="rd-truck"
                autoComplete="off"
                value={truck}
                onChange={(event) => setTruck(event.target.value)}
              />
            </Field>
            <Field id="rd-driver" label="Driver" optional>
              <input
                id="rd-driver"
                autoComplete="off"
                value={driver}
                onChange={(event) => setDriver(event.target.value)}
              />
            </Field>
          </WizardPair>
          {driver.trim() ? (
            <label className="choice-card">
              <input
                type="checkbox"
                checked={driverConfirmed}
                onChange={(event) => setDriverConfirmed(event.target.checked)}
              />
              <span>
                <strong>{driver.trim()} confirms the figures</strong>
              </span>
            </label>
          ) : null}
          <WizardActions wizard={wizard} onContinue={guideNext} />
        </WizardStep>
      ) : null}
      {step === 'dips' ? (
        <WizardStep
          wizard={wizard}
          title="What did the tank dip show?"
          hint="Before and after the delivery. You can leave this empty and carry on."
        >
          <WizardPair>
            <Field
              id="rd-dip-before"
              label={`Before (${unitWord})`}
              error={errors['rd-dip-before']}
              optional
            >
              <input
                id="rd-dip-before"
                inputMode="decimal"
                autoComplete="off"
                value={dipBefore}
                onChange={(event) => setDipBefore(event.target.value)}
              />
            </Field>
            <Field
              id="rd-dip-after"
              label={`After (${unitWord})`}
              error={errors['rd-dip-after']}
              optional
            >
              <input
                id="rd-dip-after"
                inputMode="decimal"
                autoComplete="off"
                value={dipAfter}
                onChange={(event) => setDipAfter(event.target.value)}
              />
            </Field>
          </WizardPair>
          <WizardActions wizard={wizard} onContinue={guideNext} />
        </WizardStep>
      ) : null}
      {step === 'compartments' ? (
        <WizardStep
          wizard={wizard}
          title="Did the truck have compartments?"
          hint="Add one for each, with its seal numbers. You can leave this empty and carry on."
        >
          <CompartmentFields rows={compartments} onChange={setCompartments} />
          {sumProblem ? (
            <p id="rd-add-compartment" role="status" data-tone="warning">
              {errors['rd-add-compartment'] ?? sumProblem}
            </p>
          ) : null}
          <WizardActions wizard={wizard} onContinue={guideNext} />
        </WizardStep>
      ) : null}
      {step === 'water' ? (
        <WizardStep
          wizard={wizard}
          title="Did you test for water?"
          hint="You can leave this empty and carry on."
        >
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
            <Field id="rd-water-mm" label="Water found (mm)" error={errors['rd-water-mm']} optional>
              <input
                id="rd-water-mm"
                inputMode="decimal"
                autoComplete="off"
                value={waterMm}
                onChange={(event) => setWaterMm(event.target.value)}
              />
            </Field>
          ) : null}
          <WizardActions wizard={wizard} onContinue={guideNext} />
        </WizardStep>
      ) : null}
      {step === 'review' ? (
        <WizardStep wizard={wizard} title="Check the delivery" hint={WIZARD_REVIEW_HINT}>
          <WizardSummary>
            <WizardSummaryRow label="Supplier" onChange={() => wizard.change('supplier')}>
              {suppliers?.find((item) => item.id === supplierId)?.label ?? unanswered}
            </WizardSummaryRow>
            <WizardSummaryRow
              label="Fuel and tank"
              onChange={tanks.length > 1 ? () => wizard.change('tank') : undefined}
            >
              {tank ? `${tank.productName} · tank ${tank.code}` : unanswered}
            </WizardSummaryRow>
            <WizardSummaryRow label="Delivery note" onChange={() => wizard.change('note')}>
              {deliveryNote.trim()} · {new Date(deliveredAt).toLocaleString()}
            </WizardSummaryRow>
            <WizardSummaryRow label={UnitWord} onChange={() => wizard.change('received')}>
              {noteLitres.trim()} on the note, {receivedLitres.trim()} received
              {difference && difference.kind !== 'EXACT' ? ` (${difference.text})` : ''}
            </WizardSummaryRow>
            <WizardSummaryRow label="Purchase order" onChange={() => wizard.change('po')}>
              {orderAnswer}
            </WizardSummaryRow>
            <WizardSummaryRow label="Truck and driver" onChange={() => wizard.change('truck')}>
              {[carrierName, truck.trim(), driver.trim()].filter(Boolean).join(' · ') || unanswered}
            </WizardSummaryRow>
            <WizardSummaryRow label="Tank dips" onChange={() => wizard.change('dips')}>
              {dipBefore.trim() || dipAfter.trim()
                ? `Before ${dipBefore.trim() || '–'}, after ${dipAfter.trim() || '–'}`
                : unanswered}
            </WizardSummaryRow>
            <WizardSummaryRow label="Compartments" onChange={() => wizard.change('compartments')}>
              {filledCompartments.length > 0 ? `${filledCompartments.length} added` : unanswered}
            </WizardSummaryRow>
            <WizardSummaryRow label="Water test" onChange={() => wizard.change('water')}>
              {water === 'PASS' ? 'Passed' : water === 'FAIL' ? 'Failed' : 'Not done'}
            </WizardSummaryRow>
          </WizardSummary>
          {failure && failure.step !== 'confirm' ? (
            <div ref={failureRef}>
              <ErrorState title="Could not finish" message={failure.message} />
            </div>
          ) : null}
          <InfoTip>
            Saving does not put the fuel on the books yet. After saving you can add a photo of the
            note and confirm.
          </InfoTip>
          <WizardActions
            wizard={wizard}
            onContinue={guideNext}
            continueLabel="Save delivery"
            busy={busy === 'record'}
          />
        </WizardStep>
      ) : null}
    </form>
  );

  return (
    <Frame framed={framed}>
      {recorded || guided ? null : (
        <InfoTip>Change what needs changing, then save. Only what you changed is saved.</InfoTip>
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
      {guided && !recorded ? guide : null}
      <form
        className="dialog-form rd-form"
        hidden={
          (guided && !recorded) || (recorded && (failure === null || failure.step === 'confirm'))
        }
        onSubmit={record}
        onChange={() => {
          touched.current = true;
        }}
      >
        {edit ? (
          <fieldset
            disabled={recorded && busy === null && failure === null}
            className="rd-fieldset"
          >
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
                    {fuelSuppliers.map((supplier) => (
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
              <div className="rd-po">
                <PurchaseOrderChoice
                  id="rd-po"
                  tenantId={tenantId}
                  stationId={stationId}
                  supplierId={supplierId}
                  productId={tank?.productId ?? ''}
                  value={noPo}
                  note={noPoNote}
                  onChange={onPoChange}
                  linkedOrderNumber={start?.linkedOrder || undefined}
                />
              </div>
            </section>

            <section className="rd-group" aria-labelledby="rd-h-litres">
              <h3 id="rd-h-litres">{UnitWord}</h3>
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
              {difference && difference.kind !== 'EXACT' ? (
                <VarianceReason value={variance} onChange={setVariance} />
              ) : null}
            </section>

            <div className="rd-more">
              <h3>More detail, if you have it</h3>
              <Section
                title="Truck and driver"
                note={[carrierName, driver.trim(), truck.trim()].filter(Boolean).join(' · ')}
              >
                <div className="rd-grid">
                  {carrierField('rd-transporter', 'Transporter')}
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
                    <Field id="rd-dip-before" label={`Before the delivery (${unitWord})`} optional>
                      <input
                        id="rd-dip-before"
                        inputMode="decimal"
                        value={dipBefore}
                        onChange={(event) => setDipBefore(event.target.value)}
                      />
                    </Field>
                    <Field id="rd-dip-after" label={`After the delivery (${unitWord})`} optional>
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
                    ? `Check the ${unitWord}`
                    : compartments.length > 0
                      ? `${compartments.length} added`
                      : ''
                }
                warning={Boolean(sumProblem)}
                forceOpen={Boolean(sumProblem)}
              >
                <CompartmentFields rows={compartments} onChange={setCompartments} />
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
            </div>
          </fieldset>
        ) : null}
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
            <InfoTip>
              Add a photo of the delivery note if you have one, then confirm. Confirming puts the
              fuel on the tank&apos;s books and records you as the supervisor who checked it.
            </InfoTip>
          </div>
          {poSaved ? null : (
            <div className="rd-po">
              <PurchaseOrderChoice
                id="rd-saved-po"
                tenantId={tenantId}
                stationId={stationId}
                supplierId={supplierId}
                productId={tank?.productId ?? ''}
                value={noPo}
                note={noPoNote}
                onChange={onPoChange}
                error={poError ?? undefined}
              />
            </div>
          )}
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
