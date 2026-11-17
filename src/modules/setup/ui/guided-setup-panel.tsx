'use client';

import { useReverification } from '@clerk/nextjs';
import Link from 'next/link';
import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';

import { Icon } from '@/design-system/icons';
import { BottomNotchCard } from '@/design-system/bottom-notch-card';
import { Modal } from '@/design-system/modal';
import {
  BLEND_PERCENTS,
  PRODUCT_KINDS,
  PRODUCT_KIND_LABELS,
  suggestedFuelName,
  type ProductKind,
} from '@/platform/domain/product-order';
import { Radio, Select } from '@/design-system/forms';
import { formatMoney } from '@/design-system/formatters';
import {
  AccessDeniedState,
  Button,
  ErrorState,
  Field,
  LoadingState,
  StatusBadge,
} from '@/design-system/primitives';

import type {
  ConfigurationSetupOverview,
  SetupNozzle,
  SetupOverview,
  SetupProduct,
  SetupPump,
  SetupShiftTemplate,
  SetupTank,
} from '../contracts';
import { describeMeterWorkingSince } from '../meter-working-since';
import {
  buildFuelCards,
  buildGuidedSteps,
  describeDuration,
  describePriceState,
  friendlyPriceError,
  friendlySetupError,
  endTimeFrom,
  hoursToMinutes,
  minutesBetween,
  parsePositiveDecimal,
  planPriceAdvance,
  progress,
  describeFuelKind,
  suggestCode,
  validateFuelChoice,
  validateFuelKind,
  defaultUnitForKind,
  unitLabel,
  type FuelUnitChoice,
  type GuidedStepId,
} from '../guided-setup';
import { EditAccessModal } from '@/modules/settings/ui/staff-panel';
import type { StaffOverview } from '@/modules/staff/contracts';
import { planNozzleRenumbering } from '../nozzle-renumber';
import styles from './setup.module.css';
import { StepUpDialog } from './step-up-dialog';
import { useSetupOverview } from './use-setup-overview';

type Ready = Extract<SetupOverview, { status: 'ready' }>;
type Outcome = { kind: 'success' | 'error'; message: string };
type Gate = (save: () => Promise<void>) => void;

const STEP_UP_REUSE_MS = 5 * 60_000;

type ConfigState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'unavailable' }
  | { kind: 'ready'; data: ConfigurationSetupOverview };

/** Reads one station's configuration. `refresh` re-reads without replacing the screen. */
function useStationConfig(tenantId: string, stationId: string) {
  const [state, setState] = useState<ConfigState>({ kind: 'loading' });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch(
          `/api/setup/overview?tenantId=${encodeURIComponent(tenantId)}&stationId=${encodeURIComponent(stationId)}`,
          { credentials: 'same-origin', cache: 'no-store', signal: controller.signal },
        );
        if (response.status === 403) {
          setState({ kind: 'unavailable' });
          return;
        }
        if (!response.ok) {
          setState({ kind: 'error' });
          return;
        }
        const body = (await response.json()) as { data?: ConfigurationSetupOverview | null };
        setState(body.data ? { kind: 'ready', data: body.data } : { kind: 'error' });
      } catch {
        if (!controller.signal.aborted) setState({ kind: 'error' });
      }
    })();
    return () => controller.abort();
  }, [tenantId, stationId, nonce]);

  const refresh = useCallback(() => setNonce((value) => value + 1), []);
  const reload = useCallback(() => {
    setState({ kind: 'loading' });
    setNonce((value) => value + 1);
  }, []);
  return { state, refresh, reload };
}

/**
 * Posts one setup command. The idempotency key is stable per logical payload, so a retry after a
 * network failure cannot create a duplicate; it is released only after the command succeeds.
 */
function useSaver(url: string, onSaved: () => void, onDenied: () => void) {
  const keys = useRef(new Map<string, string>());
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>();

  async function save(body: Record<string, unknown>, success: string): Promise<boolean> {
    const logical = JSON.stringify(body);
    const key = keys.current.get(logical) ?? `guided-setup-${crypto.randomUUID()}`;
    keys.current.set(logical, key);
    setBusy(true);
    setOutcome(undefined);
    try {
      const response = await fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'idempotency-key': key },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const failure = (await response.json().catch(() => null)) as { message?: string } | null;
        if (response.status === 403) onDenied();
        setOutcome({
          kind: 'error',
          message: friendlySetupError(response.status, failure?.message),
        });
        return false;
      }
      keys.current.delete(logical);
      setOutcome({ kind: 'success', message: success });
      onSaved();
      return true;
    } catch {
      setOutcome({
        kind: 'error',
        message: 'That could not be saved. Check your connection and try again.',
      });
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { save, busy, outcome };
}

function Message({ outcome }: { outcome?: Outcome }) {
  if (!outcome) return null;
  return (
    <p
      className={outcome.kind === 'error' ? styles.messageError : styles.message}
      role={outcome.kind === 'error' ? 'alert' : 'status'}
    >
      {outcome.message}
    </p>
  );
}

type FormContext = {
  tenantId: string;
  stationId: string;
  data: ConfigurationSetupOverview;
  refresh: () => void;
  gate: Gate;
  onDenied: () => void;
  /** Present only for people who may manage staff: lets the supervisor card add, move or remove people. */
  staff?: StaffOverview;
  onOpenStaff?: () => void;
};

type Errors = Record<string, string | undefined>;
const hasErrors = (errors: Errors) => Object.values(errors).some(Boolean);
const text = (data: FormData, name: string) => String(data.get(name) ?? '').trim();

function activeProducts(data: ConfigurationSetupOverview) {
  return (data.products ?? []).filter((p) => p.status === 'ACTIVE');
}
/** The word for a quantity of one fuel: "litres", "kilograms", or both when the fuel is not chosen yet. */
function quantityWord(data: ConfigurationSetupOverview, productId?: string): string {
  const unit = data.products?.find((p) => p.id === productId)?.unit;
  return unit === 'KILOGRAMS' ? 'kilograms' : unit === 'LITRES' ? 'litres' : 'litres or kilograms';
}

/** The matching word for a price: "litre", "kilogram", or both when the fuel is not chosen yet. */
function priceWord(data: ConfigurationSetupOverview, productId?: string): string {
  const unit = data.products?.find((p) => p.id === productId)?.unit;
  return unit === 'KILOGRAMS' ? 'kilogram' : unit === 'LITRES' ? 'litre' : 'litre or kilogram';
}

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function productOptions(data: ConfigurationSetupOverview) {
  return activeProducts(data).map((p) => ({ value: p.id, label: p.name }));
}

/** A list of small cards, one per item: the whole card opens the item's edit form, and a three-dots
 *  menu offers Change and any extra actions. Used wherever a step holds several things. */
function CardList({
  items,
  label,
  renderEditor,
  extraOptions = [],
  onOption,
}: {
  items: ReadonlyArray<{ id: string; title: string; detail: string; badge: ReactNode }>;
  label: string;
  /** When given, each card can be changed: the form replaces the card until it is closed. */
  renderEditor?: (id: string, close: () => void) => ReactNode;
  extraOptions?: readonly { value: string; label: string }[];
  onOption?: (id: string, value: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  if (items.length === 0) return null;
  return (
    <ul className={styles.shiftList} aria-label={label}>
      {items.map((item) => {
        const body = (
          <>
            <span className={styles.shiftBadge} aria-hidden="true">
              {item.badge}
            </span>
            <span className={styles.stepText}>
              <span className={styles.rowTitle}>{item.title}</span>
              <span className={styles.rowDetail}>{item.detail}</span>
            </span>
          </>
        );
        return (
          <li key={item.id} data-editing={editingId === item.id ? true : undefined}>
            {renderEditor && editingId === item.id ? (
              renderEditor(item.id, () => setEditingId(null))
            ) : (
              <div className={styles.shiftCard}>
                {renderEditor ? (
                  <button
                    type="button"
                    className={`${styles.shiftText} ${styles.shiftOpen}`}
                    aria-label={`Change ${item.title}`}
                    onClick={() => setEditingId(item.id)}
                  >
                    {body}
                  </button>
                ) : (
                  <div className={styles.shiftText}>{body}</div>
                )}
                {renderEditor ? (
                  <FuelMenu
                    label={`More actions for ${item.title}`}
                    options={[{ value: 'change', label: 'Change' }, ...extraOptions]}
                    onChoose={(value) =>
                      value === 'change' ? setEditingId(item.id) : onOption?.(item.id, value)
                    }
                  />
                ) : null}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * One existing fuel. A fuel with no type yet is asked for it in plain words; one that has a type
 * shows it with a way to change it. Only the type changes, never the name.
 */
function FuelKindRow({
  ctx,
  product,
  save,
  busy,
}: {
  ctx: FormContext;
  product: SetupProduct;
  save: (body: Record<string, unknown>, success: string) => Promise<boolean>;
  busy: boolean;
}) {
  const current = describeFuelKind(product.kind, product.blendPercent);
  const [editing, setEditing] = useState(false);
  const [kind, setKind] = useState(product.kind ?? '');
  const [blendPercent, setBlendPercent] = useState(
    product.blendPercent ? String(product.blendPercent) : '',
  );
  const [errors, setErrors] = useState<Errors>({});

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const checked = validateFuelKind({ kind, blendPercent });
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    const { value } = checked;
    ctx.gate(async () => {
      const saved = await save(
        {
          commandType: 'SetProductKind',
          tenantId: ctx.tenantId,
          stationId: ctx.stationId,
          productId: product.id,
          kind: value.kind,
          blendPercent: value.blendPercent,
        },
        `${product.name} is now set as ${describeFuelKind(value.kind, value.blendPercent)}.`,
      );
      if (saved) setEditing(false);
    });
  }

  if (current && !editing) {
    return (
      <li>
        {product.name}: {current}{' '}
        {ctx.data.capabilities.products ? (
          <Button type="button" variant="quiet" onClick={() => setEditing(true)}>
            Change type
          </Button>
        ) : null}
      </li>
    );
  }
  if (!ctx.data.capabilities.products) return <li>{product.name}</li>;
  return (
    <li>
      <form
        className={styles.form}
        onSubmit={submit}
        noValidate
        aria-label={`Type of ${product.name}`}
      >
        <Field
          id={`kind-${product.id}`}
          label={current ? `Type of ${product.name}` : `What type of fuel is ${product.name}?`}
          error={errors.kind}
          required
        >
          <Select
            id={`kind-${product.id}`}
            name="kind"
            value={kind}
            placeholder="Choose the type of fuel"
            options={PRODUCT_KINDS.map((value) => ({ value, label: PRODUCT_KIND_LABELS[value] }))}
            onChange={(event) => {
              setKind(event.target.value);
              if (event.target.value !== 'BLEND') setBlendPercent('');
            }}
          />
        </Field>
        {kind === 'BLEND' ? (
          <Field
            id={`blend-${product.id}`}
            label="Blend percentage"
            error={errors.blendPercent}
            required
          >
            <Select
              id={`blend-${product.id}`}
              name="blendPercent"
              value={blendPercent}
              placeholder="Choose the blend"
              options={BLEND_PERCENTS.map((value) => ({
                value: String(value),
                label: `${value}%`,
              }))}
              onChange={(event) => setBlendPercent(event.target.value)}
            />
          </Field>
        ) : null}
        <div className={styles.formActions}>
          <Button type="submit" loading={busy}>
            Save
          </Button>
          {current ? (
            <Button type="button" variant="quiet" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          ) : null}
        </div>
      </form>
    </li>
  );
}

/** The type of one fuel, shown at the top of that fuel's card. */
function FuelKind({ ctx, productId }: { ctx: FormContext; productId: string }) {
  const { save, busy, outcome } = useSaver('/api/setup/commands', ctx.refresh, ctx.onDenied);
  const product = (ctx.data.products ?? []).find((p) => p.id === productId);
  if (!product) return null;
  return (
    <>
      <ul className={styles.itemList} aria-label="Type of fuel">
        <FuelKindRow ctx={ctx} product={product} save={save} busy={busy} />
      </ul>
      <Message outcome={outcome} />
    </>
  );
}

function FuelStep({
  ctx,
  open,
  onClose,
}: {
  ctx: FormContext;
  open: boolean;
  onClose: () => void;
}) {
  const { save, busy, outcome } = useSaver('/api/setup/commands', ctx.refresh, ctx.onDenied);
  const [errors, setErrors] = useState<Errors>({});
  // Held in state, not read from the form, so it is cleared even if the screen was redrawn while
  // the identity check was open.
  const [kind, setKind] = useState('');
  const [blendPercent, setBlendPercent] = useState('');
  const [fuelName, setFuelName] = useState('');
  // Once the person types their own name the suggestion stops overwriting it.
  const [nameEdited, setNameEdited] = useState(false);
  // How the fuel is measured: set from the type (gas in kilograms) and changeable by the person.
  const [fuelUnit, setFuelUnit] = useState<FuelUnitChoice>('LITRES');

  function suggest(nextKind: string, nextPercent: string) {
    if (nameEdited) return;
    if (!(PRODUCT_KINDS as readonly string[]).includes(nextKind)) return;
    setFuelName(suggestedFuelName(nextKind as ProductKind, Number(nextPercent) || null));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const checked = validateFuelChoice({ kind, blendPercent, name: fuelName });
    if (!checked.ok) {
      setErrors(checked.errors);
      return;
    }
    setErrors({});
    const { value } = checked;
    const code = suggestCode(
      value.name,
      (ctx.data.products ?? []).map((p) => p.code),
    );
    ctx.gate(async () => {
      const saved = await save(
        {
          commandType: 'CreateProduct',
          tenantId: ctx.tenantId,
          stationId: ctx.stationId,
          code,
          name: value.name,
          kind: value.kind,
          blendPercent: value.blendPercent,
          unit: fuelUnit,
        },
        `${value.name} was added.`,
      );
      if (saved) {
        setKind('');
        setBlendPercent('');
        setFuelName('');
        setNameEdited(false);
        setFuelUnit('LITRES');
        onClose();
      }
    });
  }

  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      title="Add a fuel type"
      size="sm"
      dismissible={!busy}
    >
      <form className={styles.form} onSubmit={submit} noValidate aria-label="Add a fuel type">
        <Field id="fuel-kind" label="Type of fuel" error={errors.kind} required>
          <Select
            id="fuel-kind"
            name="kind"
            value={kind}
            placeholder="Choose the type of fuel"
            options={PRODUCT_KINDS.map((value) => ({
              value,
              label: PRODUCT_KIND_LABELS[value],
            }))}
            onChange={(event) => {
              const next = event.target.value;
              setKind(next);
              setFuelUnit(defaultUnitForKind(next));
              if (next !== 'BLEND') setBlendPercent('');
              suggest(next, '');
            }}
          />
        </Field>
        {kind === 'BLEND' ? (
          <Field id="fuel-blend" label="Blend percentage" error={errors.blendPercent} required>
            <Select
              id="fuel-blend"
              name="blendPercent"
              value={blendPercent}
              placeholder="Choose the blend"
              options={BLEND_PERCENTS.map((value) => ({
                value: String(value),
                label: `${value}%`,
              }))}
              onChange={(event) => {
                setBlendPercent(event.target.value);
                suggest(kind, event.target.value);
              }}
            />
          </Field>
        ) : null}
        <Field
          id="fuel-name"
          label="Fuel name"
          hint={kind === 'OTHER' ? 'Type the name of this fuel.' : undefined}
          error={errors.name}
          required
        >
          <input
            id="fuel-name"
            name="name"
            value={fuelName}
            onChange={(event) => {
              setFuelName(event.target.value);
              setNameEdited(true);
            }}
            autoComplete="off"
            maxLength={120}
            placeholder="Diesel"
          />
        </Field>
        <Field id="fuel-unit" label="Measured in">
          <select
            id="fuel-unit"
            value={fuelUnit}
            onChange={(event) => setFuelUnit(event.target.value as FuelUnitChoice)}
          >
            {(['LITRES', 'KILOGRAMS'] as const).map((unit) => (
              <option key={unit} value={unit}>
                {unitLabel(unit)}
              </option>
            ))}
          </select>
        </Field>
        <div className={styles.formActions}>
          <Button variant="secondary" type="button" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            Add fuel type
          </Button>
          <Message outcome={outcome} />
        </div>
      </form>
    </Modal>
  );
}

function PriceStep({ ctx, productId: onlyProductId }: { ctx: FormContext; productId?: string }) {
  const { save, busy, outcome } = useSaver('/api/setup/commands', ctx.refresh, ctx.onDenied);
  const [errors, setErrors] = useState<Errors>({});
  const products = activeProducts(ctx.data);
  const nameOf = (id: string) => products.find((p) => p.id === id)?.name ?? 'Fuel';
  const prices = (ctx.data.prices ?? []).filter(
    (p) => p.state !== 'SUPERSEDED' && (!onlyProductId || p.productId === onlyProductId),
  );
  const idp = onlyProductId ? `${onlyProductId}-` : '';
  const advanceKeys = useRef(new Map<string, string>());
  const [advancing, setAdvancing] = useState<string | null>(null);
  const [advanceOutcome, setAdvanceOutcome] = useState<Outcome>();

  /** Runs each step the person may take, one after another, and stops at the first refusal. */
  function advance(price: (typeof prices)[number]) {
    const { commands } = planPriceAdvance(price.state, ctx.data.capabilities);
    if (commands.length === 0) return;
    ctx.gate(async () => {
      setAdvancing(price.id);
      setAdvanceOutcome(undefined);
      let version = price.version;
      let last: string | undefined;
      try {
        for (const commandType of commands) {
          const body = {
            commandType,
            tenantId: ctx.tenantId,
            stationId: ctx.stationId,
            priceId: price.id,
            expectedVersion: version,
          };
          const logical = JSON.stringify(body);
          const key = advanceKeys.current.get(logical) ?? `guided-setup-${crypto.randomUUID()}`;
          advanceKeys.current.set(logical, key);
          const response = await fetch('/api/forecourt/commands', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json', 'idempotency-key': key },
            body: JSON.stringify(body),
          });
          if (!response.ok) {
            const failure = (await response.json().catch(() => null)) as {
              message?: string;
            } | null;
            const approved = failure?.message ? /meter boundaries/i.test(failure.message) : false;
            setAdvanceOutcome({
              kind: approved ? 'success' : 'error',
              message: friendlyPriceError(response.status, failure?.message),
            });
            return;
          }
          advanceKeys.current.delete(logical);
          version += 1;
          last = commandType;
        }
        setAdvanceOutcome({
          kind: 'success',
          message:
            last === 'ActivatePriceChange'
              ? `The price for ${nameOf(price.productId)} is now in use.`
              : last === 'ApprovePriceChange'
                ? 'The price was approved.'
                : last === 'PreparePriceActivation'
                  ? 'The price is ready to start.'
                  : 'The price was sent for approval.',
        });
      } catch {
        setAdvanceOutcome({
          kind: 'error',
          message: 'That could not be saved. Check your connection and try again.',
        });
      } finally {
        setAdvancing(null);
        ctx.refresh();
      }
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const productId = onlyProductId ?? text(data, 'productId');
    const price = parsePositiveDecimal(text(data, 'price'), 6);
    const next = {
      product: productId ? undefined : 'Choose the fuel.',
      price: price
        ? undefined
        : `Enter the price per ${priceWord(ctx.data, productId)}, for example 1.65.`,
    };
    setErrors(next);
    if (hasErrors(next) || !price) return;
    ctx.gate(async () => {
      const saved = await save(
        {
          commandType: 'DraftPriceChange',
          tenantId: ctx.tenantId,
          stationId: ctx.stationId,
          productId,
          unitPrice: price,
          currency: 'USD',
          effectiveFrom: new Date().toISOString(),
        },
        `The price for ${nameOf(productId)} was saved. It starts being used once it is approved.`,
      );
      if (saved) form.reset();
    });
  }

  return (
    <>
      {onlyProductId
        ? prices.map((p) => {
            const { label } = planPriceAdvance(p.state, ctx.data.capabilities);
            return (
              <div key={p.id} className={styles.priceCard}>
                <div className={styles.priceText}>
                  <span className={styles.priceAmount}>
                    {formatMoney(p.unitPrice)}
                    <span className={styles.priceUnit}>
                      {' '}
                      per {priceWord(ctx.data, p.productId)}
                    </span>
                  </span>
                  <span className={styles.priceState} data-state={p.state}>
                    {describePriceState(p.state)}
                  </span>
                </div>
                {p.state === 'ACTIVE' && ctx.data.capabilities.priceRequest ? (
                  <Link href="/operations/daily/price-change">Change price</Link>
                ) : null}
                {label ? (
                  <Button
                    type="button"
                    size="sm"
                    loading={advancing === p.id}
                    disabled={advancing !== null}
                    onClick={() => advance(p)}
                  >
                    {label}
                  </Button>
                ) : null}
              </div>
            );
          })
        : null}
      {!onlyProductId && prices.length > 0 ? (
        <ul className={styles.itemList} aria-label="Prices">
          {prices.map((p) => {
            const { label } = planPriceAdvance(p.state, ctx.data.capabilities);
            return (
              <li key={p.id}>
                {`${onlyProductId ? '' : `${nameOf(p.productId)}: `}${formatMoney(p.unitPrice)} per ${priceWord(ctx.data, p.productId)} (${describePriceState(p.state)})`}
                {p.state === 'ACTIVE' && ctx.data.capabilities.priceRequest ? (
                  <>
                    {' '}
                    <Link href="/operations/daily/price-change">Change price</Link>
                  </>
                ) : null}
                {label ? (
                  <>
                    {' '}
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      loading={advancing === p.id}
                      disabled={advancing !== null}
                      onClick={() => advance(p)}
                    >
                      {label}
                    </Button>
                  </>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      <Message outcome={advanceOutcome} />
      {ctx.data.capabilities.priceRequest && !(onlyProductId && prices.length > 0) ? (
        <form className={styles.form} onSubmit={submit} noValidate aria-label="Set a selling price">
          {onlyProductId ? null : (
            <Field id="price-product" label="Fuel" error={errors.product} required>
              <Select
                id="price-product"
                name="productId"
                defaultValue=""
                placeholder="Choose the fuel"
                options={productOptions(ctx.data)}
              />
            </Field>
          )}
          <Field
            id={`${idp}price-amount`}
            label={`Price per ${priceWord(ctx.data, onlyProductId)} (USD)`}
            hint="A manager approves the price before it is used on sales."
            error={errors.price}
            required
          >
            <input id={`${idp}price-amount`} name="price" inputMode="decimal" autoComplete="off" />
          </Field>
          <div className={styles.formActions}>
            <Button type="submit" loading={busy}>
              Save price
            </Button>
            <Message outcome={outcome} />
          </div>
        </form>
      ) : null}
      {onlyProductId ? null : (
        <p className={styles.note}>
          To change the price of a fuel that is already selling, use{' '}
          <Link href="/operations/daily/price-change">Change a price</Link>.
        </p>
      )}
    </>
  );
}

type EditorProps<T> = { ctx: FormContext; close: () => void } & T;

/** Reads and checks the tank size and limit fields shared by the add and change forms. */
function readTankFields(data: FormData, word: string) {
  const capacity = parsePositiveDecimal(text(data, 'capacity'), 3);
  const reorderText = text(data, 'reorder');
  const reorder = reorderText ? parsePositiveDecimal(reorderText, 3) : null;
  const differenceText = text(data, 'difference');
  const difference = differenceText ? parsePositiveDecimal(differenceText, 3) : null;
  const redText = text(data, 'red');
  const red = redText ? parsePositiveDecimal(redText, 3) : null;
  const errors: Errors = {
    capacity: capacity ? undefined : `Enter how many ${word} the tank holds.`,
    reorder:
      reorderText && !reorder
        ? `Enter a number of ${word}, or leave this empty.`
        : reorder && capacity && Number(reorder) > Number(capacity)
          ? 'This cannot be more than the tank holds.'
          : undefined,
    difference:
      differenceText && !difference ? `Enter a number of ${word}, or leave this empty.` : undefined,
    red:
      redText && !red
        ? `Enter a number of ${word}, or leave this empty.`
        : red && !difference
          ? 'Set the yellow limit first.'
          : red && difference && Number(red) < Number(difference)
            ? 'The red limit cannot be lower than the yellow one.'
            : undefined,
  };
  return { capacity, reorder, difference, red, errors };
}

function TankEditor({ ctx, tank, close }: EditorProps<{ tank: SetupTank }>) {
  const { save, busy, outcome } = useSaver('/api/inventory/commands', ctx.refresh, ctx.onDenied);
  const [errors, setErrors] = useState<Errors>({});
  const word = quantityWord(ctx.data, tank.productId);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = text(data, 'name');
    const fields = readTankFields(data, word);
    const next = { ...fields.errors, name: name ? undefined : 'Give the tank a name.' };
    setErrors(next);
    if (hasErrors(next) || !fields.capacity) return;
    ctx.gate(async () => {
      const saved = await save(
        {
          commandType: 'UpdateTank',
          tenantId: ctx.tenantId,
          stationId: ctx.stationId,
          tankId: tank.id,
          code: name,
          capacityLitres: fields.capacity,
          reorderLevelLitres: fields.reorder,
          acceptableVarianceLitres: fields.difference,
          varianceRedLitres: fields.red,
        },
        `${name} was changed.`,
      );
      if (saved) close();
    });
  }

  return (
    <form
      className={`${styles.form} ${styles.centeredForm}`}
      onSubmit={submit}
      noValidate
      aria-label={`Change ${tank.code}`}
    >
      <p className={styles.note}>
        The fuel in a tank cannot be changed because past stock records use it. To store a different
        fuel, add a new tank.
      </p>
      <Field id={`tank-${tank.id}-name`} label="Tank name" error={errors.name} required>
        <input
          id={`tank-${tank.id}-name`}
          name="name"
          defaultValue={tank.code}
          autoComplete="off"
          maxLength={32}
        />
      </Field>
      <Field
        id={`tank-${tank.id}-capacity`}
        label={`${capitalise(word)} the tank holds`}
        error={errors.capacity}
        required
      >
        <input
          id={`tank-${tank.id}-capacity`}
          name="capacity"
          inputMode="decimal"
          autoComplete="off"
          defaultValue={tank.capacityLitres}
        />
      </Field>
      <Field
        id={`tank-${tank.id}-reorder`}
        label={`Order more fuel when it falls to (${word})`}
        error={errors.reorder}
        optional
      >
        <input
          id={`tank-${tank.id}-reorder`}
          name="reorder"
          inputMode="decimal"
          autoComplete="off"
          defaultValue={tank.reorderLevelLitres ?? ''}
        />
      </Field>
      <Field
        id={`tank-${tank.id}-difference`}
        label={`Yellow limit (${word})`}
        hint="A stock difference above this must be explained."
        error={errors.difference}
        optional
      >
        <input
          id={`tank-${tank.id}-difference`}
          name="difference"
          inputMode="decimal"
          autoComplete="off"
          defaultValue={tank.acceptableVarianceLitres ?? ''}
        />
      </Field>
      <Field
        id={`tank-${tank.id}-red`}
        label={`Red limit (${word})`}
        hint="A stock difference above this is urgent."
        error={errors.red}
        optional
      >
        <input
          id={`tank-${tank.id}-red`}
          name="red"
          inputMode="decimal"
          autoComplete="off"
          defaultValue={tank.varianceRedLitres ?? ''}
        />
      </Field>
      <div className={styles.formActions}>
        <Button type="submit" loading={busy}>
          Save changes
        </Button>
        <Button type="button" variant="secondary" onClick={close} disabled={busy}>
          Cancel
        </Button>
        <Message outcome={outcome} />
      </div>
    </form>
  );
}

function PumpEditor({
  ctx,
  pump,
  nozzles,
  productName,
  close,
}: EditorProps<{
  pump: SetupPump;
  nozzles: SetupNozzle[];
  productName: (productId: string) => string;
}>) {
  const { save, busy, outcome } = useSaver('/api/setup/commands', ctx.refresh, ctx.onDenied);
  const [errors, setErrors] = useState<Errors>({});

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const number = text(data, 'number');
    const name = text(data, 'name');
    const nozzleNumbers = nozzles.map((n) => ({ id: n.id, number: text(data, `nozzle-${n.id}`) }));
    const next: Errors = { number: number ? undefined : 'Enter the pump number.' };
    for (const n of nozzleNumbers)
      next[`nozzle-${n.id}`] = n.number ? undefined : 'Enter a number.';
    setErrors(next);
    if (hasErrors(next)) return;
    ctx.gate(async () => {
      const base = { tenantId: ctx.tenantId, stationId: ctx.stationId };
      // A pump or nozzle left as it was is not sent, so a rename of one never touches the other.
      if (number !== pump.number || name !== (pump.name ?? '')) {
        const saved = await save(
          { commandType: 'UpdatePump', ...base, pumpId: pump.id, number, name: name || null },
          `Pump ${number} was changed.`,
        );
        if (!saved) return;
      }
      // Ordered so a swap (1 and 2) or a rotation never has two nozzles on one number at once.
      for (const n of planNozzleRenumbering(nozzles, nozzleNumbers)) {
        const saved = await save(
          { commandType: 'UpdateNozzle', ...base, nozzleId: n.id, number: n.number },
          `Nozzle ${n.number} was changed.`,
        );
        if (!saved) return;
      }
      close();
    });
  }

  return (
    <form
      className={`${styles.form} ${styles.centeredForm}`}
      onSubmit={submit}
      noValidate
      aria-label={`Change pump ${pump.number}`}
    >
      <Field id={`pump-${pump.id}-number`} label="Pump number" error={errors.number} required>
        <input
          id={`pump-${pump.id}-number`}
          name="number"
          defaultValue={pump.number}
          autoComplete="off"
          maxLength={16}
        />
      </Field>
      <Field
        id={`pump-${pump.id}-name`}
        label="Pump name"
        hint="Optional, for example Island 1."
        optional
      >
        <input
          id={`pump-${pump.id}-name`}
          name="name"
          defaultValue={pump.name ?? ''}
          autoComplete="off"
          maxLength={80}
        />
      </Field>
      {nozzles.map((n) => (
        <Field
          key={n.id}
          id={`nozzle-${n.id}-number`}
          label={`Nozzle number (${productName(n.productId)})`}
          hint="The fuel and meter of a nozzle cannot be changed because sales use them."
          error={errors[`nozzle-${n.id}`]}
          required
        >
          <input
            id={`nozzle-${n.id}-number`}
            name={`nozzle-${n.id}`}
            defaultValue={n.number}
            autoComplete="off"
            maxLength={16}
          />
        </Field>
      ))}
      <div className={styles.formActions}>
        <Button type="submit" loading={busy}>
          Save changes
        </Button>
        <Button type="button" variant="secondary" onClick={close} disabled={busy}>
          Cancel
        </Button>
        <Message outcome={outcome} />
      </div>
    </form>
  );
}

function ShiftEditor({ ctx, shift, close }: EditorProps<{ shift: SetupShiftTemplate }>) {
  const { save, busy, outcome } = useSaver('/api/forecourt/commands', ctx.refresh, ctx.onDenied);
  const [errors, setErrors] = useState<Errors>({});

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = text(data, 'name');
    const start = text(data, 'start');
    const minutes = minutesBetween(start, text(data, 'end'));
    const next = {
      name: name ? undefined : 'Give the shift a name.',
      start: /^([01]\d|2[0-3]):[0-5]\d$/.test(start) ? undefined : 'Choose the start time.',
      end: minutes ? undefined : 'Choose an end time that is different from the start time.',
    };
    setErrors(next);
    if (hasErrors(next) || !minutes) return;
    ctx.gate(async () => {
      const saved = await save(
        {
          commandType: 'DefineShiftTemplate',
          tenantId: ctx.tenantId,
          stationId: ctx.stationId,
          shiftTemplateId: shift.id,
          expectedVersion: shift.version,
          code: shift.code,
          name,
          startTime: start,
          durationMinutes: minutes,
          active: true,
        },
        `${name} was changed.`,
      );
      if (saved) close();
    });
  }

  return (
    <form
      className={`${styles.form} ${styles.centeredForm}`}
      onSubmit={submit}
      noValidate
      aria-label={`Change ${shift.name}`}
    >
      <Field id={`shift-${shift.id}-name`} label="Shift name" error={errors.name} required>
        <input
          id={`shift-${shift.id}-name`}
          name="name"
          defaultValue={shift.name}
          autoComplete="off"
          maxLength={80}
        />
      </Field>
      <div className={styles.timeRow}>
        <Field id={`shift-${shift.id}-start`} label="Starts at" error={errors.start} required>
          <input
            id={`shift-${shift.id}-start`}
            name="start"
            type="time"
            defaultValue={shift.startTime?.slice(0, 5) ?? ''}
          />
        </Field>
        <Field id={`shift-${shift.id}-end`} label="Ends at" error={errors.end} required>
          <input
            id={`shift-${shift.id}-end`}
            name="end"
            type="time"
            defaultValue={endTimeFrom(shift.startTime ?? '', shift.durationMinutes)}
          />
        </Field>
      </div>
      <div className={styles.formActions}>
        <Button type="submit" loading={busy}>
          Save changes
        </Button>
        <Button type="button" variant="secondary" onClick={close} disabled={busy}>
          Cancel
        </Button>
        <Message outcome={outcome} />
      </div>
    </form>
  );
}

function TankStep({ ctx, productId: onlyProductId }: { ctx: FormContext; productId?: string }) {
  const { save, busy, outcome } = useSaver('/api/inventory/commands', ctx.refresh, ctx.onDenied);
  const [errors, setErrors] = useState<Errors>({});
  const products = activeProducts(ctx.data);
  const nameOf = (id: string) => products.find((p) => p.id === id)?.name ?? 'Fuel';
  const tanks = (ctx.data.tanks ?? []).filter(
    (t) => t.status === 'ACTIVE' && (!onlyProductId || t.productId === onlyProductId),
  );
  const idp = onlyProductId ? `${onlyProductId}-` : '';
  const [adding, setAdding] = useState(false);
  const [addProductId, setAddProductId] = useState('');
  const word = quantityWord(ctx.data, onlyProductId ?? (addProductId || undefined));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const name = text(data, 'name');
    const productId = onlyProductId ?? text(data, 'productId');
    const capacity = parsePositiveDecimal(text(data, 'capacity'), 3);
    const reorderText = text(data, 'reorder');
    const reorder = reorderText ? parsePositiveDecimal(reorderText, 3) : null;
    const differenceText = text(data, 'difference');
    const difference = differenceText ? parsePositiveDecimal(differenceText, 3) : null;
    const redText = text(data, 'red');
    const red = redText ? parsePositiveDecimal(redText, 3) : null;
    const next = {
      name: name ? undefined : 'Give the tank a name, for example Tank 1.',
      product: productId ? undefined : 'Choose the fuel in this tank.',
      capacity: capacity ? undefined : `Enter how many ${word} the tank holds.`,
      reorder:
        reorderText && !reorder ? `Enter a number of ${word}, or leave this empty.` : undefined,
      difference:
        differenceText && !difference
          ? `Enter a number of ${word}, or leave this empty.`
          : undefined,
      red:
        redText && !red
          ? `Enter a number of ${word}, or leave this empty.`
          : red && !difference
            ? 'Set the yellow limit first.'
            : red && difference && Number(red) < Number(difference)
              ? 'The red limit cannot be lower than the yellow one.'
              : undefined,
    };
    setErrors(next);
    if (hasErrors(next) || !capacity) return;
    ctx.gate(async () => {
      const saved = await save(
        {
          commandType: 'CreateTank',
          tenantId: ctx.tenantId,
          stationId: ctx.stationId,
          code: suggestCode(
            name,
            (ctx.data.tanks ?? []).map((t) => t.code),
          ),
          productId,
          capacityLitres: capacity,
          reorderLevelLitres: reorder,
          acceptableVarianceLitres: difference,
          varianceRedLitres: red,
        },
        `${name} was added.`,
      );
      if (saved) {
        form.reset();
        setAdding(false);
      }
    });
  }

  return (
    <>
      <div className={styles.headingRow}>
        <h4 className={styles.subTitle}>Tanks</h4>
        {ctx.data.capabilities.tanks ? (
          <Button
            variant="secondary"
            size="sm"
            aria-haspopup="dialog"
            aria-label="Add a tank"
            onClick={() => setAdding(true)}
          >
            Add
          </Button>
        ) : null}
      </div>
      {tanks.length === 0 ? <p className={styles.note}>No tanks added yet.</p> : null}
      <CardList
        label="Tanks added"
        items={tanks.map((t, position) => ({
          id: t.id,
          title: t.code,
          detail: `${onlyProductId ? '' : `${nameOf(t.productId)}, `}holds ${t.capacityLitres} ${quantityWord(ctx.data, t.productId)}`,
          badge: position + 1,
        }))}
        renderEditor={
          ctx.data.capabilities.tanks
            ? (id, close) => {
                const tank = tanks.find((t) => t.id === id);
                return tank ? <TankEditor ctx={ctx} tank={tank} close={close} /> : null;
              }
            : undefined
        }
      />
      {ctx.data.capabilities.tanks ? (
        <Modal
          open={adding}
          onClose={() => !busy && setAdding(false)}
          title="Add a tank"
          size="sm"
          dismissible={!busy}
        >
          <form className={styles.form} onSubmit={submit} noValidate aria-label="Add a tank">
            <Field id={`${idp}tank-name`} label="Tank name" error={errors.name} required>
              <input
                id={`${idp}tank-name`}
                name="name"
                autoComplete="off"
                maxLength={32}
                placeholder="Tank 1"
              />
            </Field>
            {onlyProductId ? null : (
              <Field id="tank-product" label="Fuel in this tank" error={errors.product} required>
                <Select
                  id="tank-product"
                  name="productId"
                  defaultValue=""
                  placeholder="Choose the fuel"
                  options={productOptions(ctx.data)}
                  onChange={(event) => setAddProductId(event.target.value)}
                />
              </Field>
            )}
            <Field
              id={`${idp}tank-capacity`}
              label={`${capitalise(word)} the tank holds`}
              error={errors.capacity}
              required
            >
              <input
                id={`${idp}tank-capacity`}
                name="capacity"
                inputMode="decimal"
                autoComplete="off"
              />
            </Field>
            <details
              className={styles.more}
              // Opened by a mistake in one of its fields, so the message is never hidden.
              open={Boolean(errors.difference || errors.red || errors.reorder) || undefined}
            >
              <summary>Stock warnings (optional)</summary>
              <Field
                id={`${idp}tank-difference`}
                label={`Yellow: explain above (${word})`}
                hint="How far the dip reading may be from the book stock before the difference must be explained."
                error={errors.difference}
                optional
              >
                <input
                  id={`${idp}tank-difference`}
                  name="difference"
                  inputMode="decimal"
                  autoComplete="off"
                />
              </Field>
              <Field
                id={`${idp}tank-red`}
                label={`Red: urgent above (${word})`}
                hint="A difference above this is urgent. Leave it empty to use twice the yellow limit."
                error={errors.red}
                optional
              >
                <input id={`${idp}tank-red`} name="red" inputMode="decimal" autoComplete="off" />
              </Field>
              <Field
                id={`${idp}tank-reorder`}
                label={`Warn me when stock falls to (${word})`}
                hint="Used for low-stock reminders."
                error={errors.reorder}
                optional
              >
                <input
                  id={`${idp}tank-reorder`}
                  name="reorder"
                  inputMode="decimal"
                  autoComplete="off"
                />
              </Field>
            </details>
            <div className={styles.formActions}>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setAdding(false)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button type="submit" loading={busy}>
                Add
              </Button>
              <Message outcome={outcome} />
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  );
}

function PumpStep({ ctx, productId: onlyProductId }: { ctx: FormContext; productId?: string }) {
  const pumpSaver = useSaver('/api/setup/commands', ctx.refresh, ctx.onDenied);
  const nozzleSaver = useSaver('/api/setup/commands', ctx.refresh, ctx.onDenied);
  const sinceSaver = useSaver('/api/setup/commands', ctx.refresh, ctx.onDenied);
  const [sinceErrors, setSinceErrors] = useState<Errors>({});
  const [pumpErrors, setPumpErrors] = useState<Errors>({});
  const [nozzleErrors, setNozzleErrors] = useState<Errors>({});
  const [addingPump, setAddingPump] = useState(false);
  const [addingNozzle, setAddingNozzle] = useState(false);
  const idp = onlyProductId ? `${onlyProductId}-` : '';
  // Pumps are physical: one pump can sell several fuels. Every pump stays available here so a
  // nozzle for this fuel can go on any of them, but only this fuel's nozzles are listed.
  const allPumps = (ctx.data.pumps ?? []).filter((p) => p.status === 'ACTIVE');
  const nozzles = (ctx.data.nozzles ?? []).filter(
    (n) => n.status === 'ACTIVE' && (!onlyProductId || n.productId === onlyProductId),
  );
  // Inside one fuel, list only the pumps that sell it, by number, so nothing about another fuel shows.
  const pumps = onlyProductId
    ? allPumps.filter((p) => nozzles.some((n) => n.pumpId === p.id))
    : allPumps;
  const products = activeProducts(ctx.data);
  const pumpLabel = (p: { number: string; name: string | null }) =>
    p.name && !onlyProductId ? `Pump ${p.number} (${p.name})` : `Pump ${p.number}`;

  function addPump(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const number = text(data, 'number');
    const name = text(data, 'name');
    const next = { number: number ? undefined : 'Enter the pump number, for example 1.' };
    setPumpErrors(next);
    if (hasErrors(next)) return;
    ctx.gate(async () => {
      const saved = await pumpSaver.save(
        {
          commandType: 'CreatePump',
          tenantId: ctx.tenantId,
          stationId: ctx.stationId,
          number,
          name: name || null,
        },
        `Pump ${number} was added. Now add its nozzle.`,
      );
      if (saved) {
        form.reset();
        setAddingPump(false);
      }
    });
  }

  function addNozzle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const pumpId = text(data, 'pumpId');
    const number = text(data, 'number');
    const productId = onlyProductId ?? text(data, 'productId');
    const meter = text(data, 'meter');
    const since = text(data, 'since');
    const next = {
      pump: pumpId ? undefined : 'Choose the pump.',
      number: number ? undefined : 'Enter the nozzle number, for example 1.',
      product: productId ? undefined : 'Choose the fuel this nozzle sells.',
      meter: meter ? undefined : 'Enter the serial number printed on the meter.',
    };
    setNozzleErrors(next);
    if (hasErrors(next)) return;
    ctx.gate(async () => {
      const saved = await nozzleSaver.save(
        {
          commandType: 'CreateNozzle',
          tenantId: ctx.tenantId,
          stationId: ctx.stationId,
          pumpId,
          number,
          productId,
          meterSerialNumber: meter,
          ...(since ? { meterWorkingSinceDate: since } : {}),
        },
        `Nozzle ${number} was added.`,
      );
      if (saved) {
        form.reset();
        setAddingNozzle(false);
      }
    });
  }

  function setMeterSince(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const nozzleId = text(data, 'nozzleId');
    const since = text(data, 'since');
    const next = {
      nozzle: nozzleId ? undefined : 'Choose the nozzle.',
      since: since ? undefined : 'Choose the day the meter was fitted.',
    };
    setSinceErrors(next);
    if (hasErrors(next)) return;
    ctx.gate(async () => {
      const saved = await sinceSaver.save(
        {
          commandType: 'SetMeterWorkingSince',
          tenantId: ctx.tenantId,
          stationId: ctx.stationId,
          nozzleId,
          meterWorkingSinceDate: since,
        },
        'The date was saved.',
      );
      if (saved) form.reset();
    });
  }

  const canEdit = ctx.data.capabilities.forecourt;
  const pumpOf = (id: string) => pumps.find((p) => p.id === id);
  const editableNozzles = nozzles.filter((n) => n.meterWorkingSinceEditable);
  return (
    <>
      <div className={styles.headingRow}>
        <h4 className={styles.subTitle}>Pumps and nozzles</h4>
        {canEdit ? (
          allPumps.length === 0 ? (
            <Button
              variant="secondary"
              size="sm"
              aria-haspopup="dialog"
              aria-label="Add a pump"
              onClick={() => setAddingPump(true)}
            >
              Add
            </Button>
          ) : (
            <FuelMenu
              label="Add a pump or a nozzle"
              triggerText="Add"
              options={[
                { value: 'nozzle', label: 'Add a nozzle' },
                { value: 'pump', label: 'Add a pump' },
              ]}
              onChoose={(value) => (value === 'pump' ? setAddingPump(true) : setAddingNozzle(true))}
            />
          )
        ) : null}
      </div>
      {pumps.length === 0 ? <p className={styles.note}>No pumps added yet.</p> : null}
      <CardList
        label={onlyProductId ? 'Pumps' : 'Pumps added'}
        items={pumps.map((p, position) => {
          const own = nozzles.filter((n) => n.pumpId === p.id);
          return {
            id: p.id,
            title: pumpLabel(p),
            badge: position + 1,
            detail:
              own.length === 0
                ? 'No nozzle yet'
                : own
                    .map((n) =>
                      onlyProductId
                        ? `nozzle ${n.number}, meter working since ${describeMeterWorkingSince(n.meterWorkingSince)}`
                        : `nozzle ${n.number} (${products.find((x) => x.id === n.productId)?.name ?? 'fuel'}, meter working since ${describeMeterWorkingSince(n.meterWorkingSince)})`,
                    )
                    .join(', '),
          };
        })}
        renderEditor={
          canEdit
            ? (id, close) => {
                const pump = pumps.find((p) => p.id === id);
                return pump ? (
                  <PumpEditor
                    ctx={ctx}
                    pump={pump}
                    nozzles={nozzles.filter((n) => n.pumpId === pump.id)}
                    productName={(productId) =>
                      products.find((x) => x.id === productId)?.name ?? 'fuel'
                    }
                    close={close}
                  />
                ) : null;
              }
            : undefined
        }
      />
      {canEdit ? (
        <>
          <Modal
            open={addingNozzle}
            onClose={() => !nozzleSaver.busy && setAddingNozzle(false)}
            title="Add a nozzle"
            size="sm"
            dismissible={!nozzleSaver.busy}
          >
            <form className={styles.form} onSubmit={addNozzle} noValidate aria-label="Add a nozzle">
              <Field id={`${idp}nozzle-pump`} label="Pump" error={nozzleErrors.pump} required>
                <Select
                  id={`${idp}nozzle-pump`}
                  name="pumpId"
                  defaultValue=""
                  placeholder="Choose the pump"
                  options={allPumps.map((p) => ({ value: p.id, label: pumpLabel(p) }))}
                />
              </Field>
              <Field
                id={`${idp}nozzle-number`}
                label="Nozzle number"
                error={nozzleErrors.number}
                required
              >
                <input id={`${idp}nozzle-number`} name="number" autoComplete="off" maxLength={16} />
              </Field>
              {onlyProductId ? null : (
                <Field id="nozzle-product" label="Fuel sold" error={nozzleErrors.product} required>
                  <Select
                    id="nozzle-product"
                    name="productId"
                    defaultValue=""
                    placeholder="Choose the fuel"
                    options={productOptions(ctx.data)}
                  />
                </Field>
              )}
              <Field
                id={`${idp}nozzle-meter`}
                label="Meter serial number"
                hint="Printed on the meter. Opening readings are taken at the first shift."
                error={nozzleErrors.meter}
                required
              >
                <input id={`${idp}nozzle-meter`} name="meter" autoComplete="off" maxLength={80} />
              </Field>
              <Field
                id="nozzle-since"
                label="Meter working since"
                hint="Optional. Leave empty if the meter was fitted today. If it was fitted earlier, for example before the current shift started, choose that day."
                optional
              >
                <input id="nozzle-since" name="since" type="date" />
              </Field>
              <div className={styles.formActions}>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setAddingNozzle(false)}
                  disabled={nozzleSaver.busy}
                >
                  Cancel
                </Button>
                <Button type="submit" loading={nozzleSaver.busy}>
                  Add
                </Button>
                <Message outcome={nozzleSaver.outcome} />
              </div>
            </form>
          </Modal>
          <Modal
            open={addingPump}
            onClose={() => !pumpSaver.busy && setAddingPump(false)}
            title="Add a pump"
            size="sm"
            dismissible={!pumpSaver.busy}
          >
            <form className={styles.form} onSubmit={addPump} noValidate aria-label="Add a pump">
              <Field
                id={`${idp}pump-number`}
                label="Pump number"
                error={pumpErrors.number}
                required
              >
                <input id={`${idp}pump-number`} name="number" autoComplete="off" maxLength={16} />
              </Field>
              <Field
                id={`${idp}pump-name`}
                label="Pump name"
                hint="Optional, for example Island 1."
                optional
              >
                <input id={`${idp}pump-name`} name="name" autoComplete="off" maxLength={80} />
              </Field>
              <div className={styles.formActions}>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setAddingPump(false)}
                  disabled={pumpSaver.busy}
                >
                  Cancel
                </Button>
                <Button type="submit" loading={pumpSaver.busy}>
                  Add
                </Button>
                <Message outcome={pumpSaver.outcome} />
              </div>
            </form>
          </Modal>
          {editableNozzles.length > 0 ? (
            <form
              className={styles.form}
              onSubmit={setMeterSince}
              noValidate
              aria-label="Meter working since"
            >
              <h4 className={styles.subTitle}>Correct when a meter started working</h4>
              <Field
                id={`${idp}since-nozzle`}
                label="Nozzle"
                hint="A shift cannot be closed for a nozzle whose meter started working after the shift opened. You can only move the date earlier, and only until readings are recorded."
                error={sinceErrors.nozzle}
                required
              >
                <Select
                  id={`${idp}since-nozzle`}
                  name="nozzleId"
                  defaultValue=""
                  placeholder="Choose the nozzle"
                  options={editableNozzles.map((n) => {
                    const pump = pumpOf(n.pumpId);
                    return {
                      value: n.id,
                      label: `${pump ? pumpLabel(pump) : 'Pump'}, nozzle ${n.number}`,
                    };
                  })}
                />
              </Field>
              <Field
                id={`${idp}since-date`}
                label="Meter working since"
                error={sinceErrors.since}
                required
              >
                <input id={`${idp}since-date`} name="since" type="date" />
              </Field>
              <div className={styles.formActions}>
                <Button type="submit" loading={sinceSaver.busy}>
                  Save date
                </Button>
                <Message outcome={sinceSaver.outcome} />
              </div>
            </form>
          ) : null}
        </>
      ) : null}
    </>
  );
}

function ShiftStep({
  ctx,
  open,
  onClose,
}: {
  ctx: FormContext;
  open: boolean;
  onClose: () => void;
}) {
  const { save, busy, outcome } = useSaver('/api/forecourt/commands', ctx.refresh, ctx.onDenied);
  const [errors, setErrors] = useState<Errors>({});
  const shifts = (ctx.data.shiftTemplates ?? []).filter((s) => s.active);
  const [removing, setRemoving] = useState<SetupShiftTemplate | null>(null);

  function remove() {
    const shift = removing;
    if (!shift) return;
    ctx.gate(async () => {
      const saved = await save(
        {
          commandType: 'DefineShiftTemplate',
          tenantId: ctx.tenantId,
          stationId: ctx.stationId,
          shiftTemplateId: shift.id,
          expectedVersion: shift.version,
          code: shift.code,
          name: shift.name,
          startTime: shift.startTime?.slice(0, 5),
          durationMinutes: shift.durationMinutes,
          active: false,
        },
        `${shift.name} was removed.`,
      );
      if (saved) setRemoving(null);
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const name = text(data, 'name');
    const start = text(data, 'start');
    const minutes = minutesBetween(start, text(data, 'end'));
    const next = {
      name: name ? undefined : 'Give the shift a name, for example Day shift.',
      start: /^([01]\d|2[0-3]):[0-5]\d$/.test(start) ? undefined : 'Choose the start time.',
      end: minutes ? undefined : 'Choose an end time that is different from the start time.',
    };
    setErrors(next);
    if (hasErrors(next) || !minutes) return;
    ctx.gate(async () => {
      const saved = await save(
        {
          commandType: 'DefineShiftTemplate',
          tenantId: ctx.tenantId,
          stationId: ctx.stationId,
          shiftTemplateId: crypto.randomUUID(),
          expectedVersion: 0,
          code: suggestCode(
            name,
            (ctx.data.shiftTemplates ?? []).map((s) => s.code),
          ),
          name,
          startTime: start,
          durationMinutes: minutes,
          active: true,
        },
        `${name} was added.`,
      );
      if (saved) {
        form.reset();
        onClose();
      }
    });
  }

  return (
    <>
      <CardList
        label="Shifts added"
        items={shifts.map((shift) => ({
          id: shift.id,
          title: shift.name,
          detail: `${shift.startTime ? `From ${shift.startTime.slice(0, 5)}, ` : ''}${describeDuration(shift.durationMinutes)}`,
          badge: <Icon name="clock" />,
        }))}
        renderEditor={
          ctx.data.capabilities.shiftTemplates
            ? (id, close) => {
                const shift = shifts.find((x) => x.id === id);
                return shift ? <ShiftEditor ctx={ctx} shift={shift} close={close} /> : null;
              }
            : undefined
        }
        extraOptions={[{ value: 'remove', label: 'Remove' }]}
        onOption={(id) => setRemoving(shifts.find((x) => x.id === id) ?? null)}
      />
      <Modal
        open={removing !== null}
        onClose={() => !busy && setRemoving(null)}
        title="Remove this shift?"
        size="sm"
        dismissible={!busy}
      >
        <p className={styles.note}>
          {removing?.name} will no longer be offered when planning shifts. Shifts already worked are
          not changed.
        </p>
        <div className={styles.formActions}>
          <Button variant="secondary" onClick={() => setRemoving(null)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" loading={busy} onClick={remove}>
            Remove
          </Button>
          <Message outcome={outcome} />
        </div>
      </Modal>
      {ctx.data.capabilities.shiftTemplates ? (
        <Modal
          open={open}
          onClose={() => !busy && onClose()}
          title="Add a shift"
          size="sm"
          dismissible={!busy}
        >
          <form className={styles.form} onSubmit={submit} noValidate aria-label="Add a shift">
            <Field id="shift-name" label="Shift name" error={errors.name} required>
              <input
                id="shift-name"
                name="name"
                autoComplete="off"
                maxLength={80}
                placeholder="Day shift"
              />
            </Field>
            <div className={styles.timeRow}>
              <Field id="shift-start" label="Starts at" error={errors.start} required>
                <input id="shift-start" name="start" type="time" />
              </Field>
              <Field id="shift-end" label="Ends at" error={errors.end} required>
                <input id="shift-end" name="end" type="time" />
              </Field>
            </div>
            <p className={styles.note}>
              An end time before the start time means the shift ends the next day.
            </p>
            <div className={styles.formActions}>
              <Button variant="secondary" type="button" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button type="submit" loading={busy}>
                Add
              </Button>
              <Message outcome={outcome} />
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  );
}

function SupervisorStep({ ctx, onBusy }: { ctx: FormContext; onBusy?: (busy: boolean) => void }) {
  const { save, busy, outcome } = useSaver('/api/setup/commands', ctx.refresh, ctx.onDenied);
  const supervisors = ctx.data.supervisors ?? [];
  useEffect(() => onBusy?.(busy), [busy, onBusy]);
  const [choice, setChoice] = useState(ctx.data.responsibleSupervisorMembershipId ?? '');
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [editing, setEditing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeError, setRemoveError] = useState<string>();
  const verify = useReverification(async () => {
    const response = await fetch('/api/auth/step-up', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenantId: ctx.tenantId, action: 'PRIVILEGED_OPERATION' }),
    });
    const body = (await response.json()) as { clerk_error?: unknown };
    if (!response.ok && !body.clerk_error) throw new Error('Security verification required');
    return body;
  });
  const staff = ctx.staff;
  const memberOf = (id: string) => staff?.activeStaff.find((m) => m.membershipId === id);

  // The person in charge cannot be moved or removed: sign-off and cash handover depend on them.
  function choose(id: string, name: string, action: string) {
    setNotice(undefined);
    if (id === ctx.data.responsibleSupervisorMembershipId) {
      setNotice(
        `${name} is in charge of this station. Choose someone else to be in charge and save, then try again.`,
      );
      return;
    }
    if (action === 'move') setEditing(id);
    else {
      setRemoveError(undefined);
      setRemoving({ id, name });
    }
  }

  const removal = (() => {
    const member = removing ? memberOf(removing.id) : undefined;
    const assignments = member?.assignments ?? [];
    const wholeCompany = assignments.some((a) => a.scopeType !== 'STATION');
    const stations = assignments.flatMap((a) => (a.stationId ? [a.stationId] : []));
    const remaining = stations.filter((id) => id !== ctx.stationId);
    return { member, assignments, wholeCompany, remaining };
  })();

  async function removeFromStation() {
    const { member, assignments, remaining } = removal;
    const first = assignments[0];
    if (!removing || !member || !first || !staff) return;
    setRemoveBusy(true);
    setRemoveError(undefined);
    try {
      await verify();
    } catch {
      setRemoveError('Security verification was not completed. Nothing was changed.');
      setRemoveBusy(false);
      return;
    }
    const legalEntityId =
      first.legalEntityId ??
      staff.scopeOptions.find((o) => o.stations.some((st) => st.id === ctx.stationId))?.id;
    try {
      const response = await fetch('/api/staff/commands', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tenantId: ctx.tenantId,
          commandType: 'UpdateStaffAssignment',
          membershipId: member.membershipId,
          assignedRole: first.role,
          scopeType: 'STATION',
          legalEntityId,
          stationIds: remaining,
        }),
      });
      if (response.ok) {
        window.location.reload();
        return;
      }
      const failure = (await response.json().catch(() => null)) as { message?: string } | null;
      setRemoveError(failure?.message ?? 'That could not be done. Nothing was changed.');
    } catch {
      setRemoveError('That could not be done. Check your connection. Nothing was changed.');
    } finally {
      setRemoveBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!choice) {
      setError('Choose who is in charge of this station.');
      return;
    }
    setError(undefined);
    const chosen = supervisors.find((s) => s.membershipId === choice);
    ctx.gate(async () => {
      await save(
        {
          commandType: 'SetResponsibleSupervisor',
          tenantId: ctx.tenantId,
          stationId: ctx.stationId,
          membershipId: choice,
        },
        `${chosen?.name ?? 'The supervisor'} is now in charge of this station.`,
      );
    });
  }

  if (!ctx.data.capabilities.forecourt) return null;
  return (
    <>
      <form
        id="supervisor-form"
        className={`${styles.form} ${styles.wideForm}`}
        onSubmit={submit}
        noValidate
        aria-label="Choose the supervisor in charge"
      >
        <fieldset className={styles.choices}>
          <legend className={styles.visuallyHidden}>Who is in charge of this station?</legend>
          {supervisors.map((s) => (
            <div key={s.membershipId} className={styles.supervisorRow}>
              <Radio
                name="supervisor"
                value={s.membershipId}
                checked={choice === s.membershipId}
                onChange={() => setChoice(s.membershipId)}
                label={s.name}
              />
              {ctx.staff ? (
                <FuelMenu
                  label={`More actions for ${s.name}`}
                  options={[
                    { value: 'move', label: 'Change access or move' },
                    { value: 'remove', label: 'Remove from this station' },
                  ]}
                  onChoose={(value) => choose(s.membershipId, s.name, value)}
                />
              ) : null}
            </div>
          ))}
          {notice ? (
            <p className={styles.messageError} role="alert">
              {notice}
            </p>
          ) : null}
          {error ? (
            <p className={styles.messageError} role="alert">
              {error}
            </p>
          ) : null}
        </fieldset>
        <Message outcome={outcome} />
      </form>
      {staff ? (
        <>
          <EditAccessModal
            key={editing ?? 'none'}
            member={editing ? memberOf(editing) : undefined}
            overview={staff}
            verify={verify}
            onClose={() => setEditing(null)}
            onSave={async (body) => {
              const response = await fetch('/api/staff/commands', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  tenantId: ctx.tenantId,
                  commandType: 'UpdateStaffAssignment',
                  ...body,
                }),
              });
              if (response.ok) window.location.reload();
              return response.ok;
            }}
          />
          <Modal
            open={removing !== null}
            onClose={() => !removeBusy && setRemoving(null)}
            title="Remove from this station?"
            size="sm"
            dismissible={!removeBusy}
          >
            {removal.wholeCompany ? (
              <p className={styles.note}>
                {removing?.name} works across the whole company, not only here. Use Change access to
                choose which stations they work in.
              </p>
            ) : removal.remaining.length === 0 ? (
              <p className={styles.note}>
                This is the only station {removing?.name} works in. To stop them working here
                altogether, deactivate them in Staff.
              </p>
            ) : (
              <p className={styles.note}>
                {removing?.name} will no longer work at this station. They keep working at their
                other stations, and records they made here stay as they are.
              </p>
            )}
            {removeError ? (
              <p className={styles.messageError} role="alert">
                {removeError}
              </p>
            ) : null}
            <div className={styles.formActions}>
              <Button variant="secondary" onClick={() => setRemoving(null)} disabled={removeBusy}>
                Cancel
              </Button>
              {removal.wholeCompany ? (
                <Button
                  onClick={() => {
                    const id = removing?.id ?? null;
                    setRemoving(null);
                    setEditing(id);
                  }}
                >
                  Change access
                </Button>
              ) : removal.remaining.length === 0 ? (
                ctx.onOpenStaff ? (
                  <Button onClick={ctx.onOpenStaff}>Go to Staff</Button>
                ) : null
              ) : (
                <Button variant="danger" loading={removeBusy} onClick={removeFromStation}>
                  Remove
                </Button>
              )}
            </div>
          </Modal>
        </>
      ) : null}
    </>
  );
}

const TONE = { done: 'positive', todo: 'warning', blocked: 'neutral' } as const;
const LABEL = { done: 'Done', todo: 'To do', blocked: 'Not yet' } as const;

/** One station's setup steps, from fuel types to the person in charge. */
export function StationSetupGuide({
  tenantId,
  stationId,
  stationName,
  staff,
  onOpenStaff,
}: {
  tenantId: string;
  stationId: string;
  stationName: string;
  staff?: StaffOverview;
  /** Lets the "no supervisor yet" step take the person straight to the Staff section. */
  onOpenStaff?: () => void;
}) {
  const { state, refresh, reload } = useStationConfig(tenantId, stationId);
  if (state.kind === 'loading') return <LoadingState label="Loading station setup" />;
  if (state.kind === 'unavailable') {
    return <AccessDeniedState message="You do not have access to set up this station." />;
  }
  if (state.kind === 'error') {
    return (
      <ErrorState
        title="Setup could not be loaded"
        message="This station's setup could not be read just now. Nothing has been changed."
        action={<Button onClick={reload}>Try again</Button>}
      />
    );
  }
  return (
    <GuideSteps
      tenantId={tenantId}
      stationId={stationId}
      stationName={stationName}
      data={state.data}
      refresh={refresh}
      staff={staff}
      onOpenStaff={onOpenStaff}
    />
  );
}

function TrashIcon() {
  return (
    <svg
      width="18"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 7h14M9.5 7V5.2c0-.7.5-1.2 1.2-1.2h2.6c.7 0 1.2.5 1.2 1.2V7M6.8 7l.7 11.6c.1 1 .9 1.8 1.9 1.8h5.2c1 0 1.8-.8 1.9-1.8L17.2 7M10 11v5.5M14 11v5.5" />
    </svg>
  );
}

/** The three-dots button of a fuel card and the short list of actions it opens. */
function FuelMenu({
  label,
  options,
  onChoose,
  triggerText,
}: {
  label: string;
  /** Shows a small "Add"-style button instead of the three dots. */
  triggerText?: string;
  options: readonly { value: string; label: string }[];
  onChoose: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  return (
    <div className={styles.menuRoot} ref={root}>
      {triggerText ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {triggerText}
        </Button>
      ) : (
        <button
          type="button"
          className={styles.iconButton}
          aria-label={label}
          title="More actions"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <Icon name="more" />
        </button>
      )}
      {open ? (
        <ul className={styles.menuList} role="menu">
          {options.map((option) => (
            <li key={option.value} role="none">
              <button
                type="button"
                role="menuitem"
                className={styles.menuItem}
                onClick={() => {
                  setOpen(false);
                  onChoose(option.value);
                }}
              >
                {option.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** One fuel, set up a part at a time: price, then tanks, then pumps and nozzles. Any part can be
 *  reopened later from the row of steps, so nothing is locked once passed. */
function FuelSteps({
  ctx,
  productId,
  header,
  overlay,
  bodyId,
}: {
  ctx: FormContext;
  productId: string;
  header: ReactNode;
  overlay: ReactNode;
  bodyId: string;
}) {
  const { data } = ctx;
  const parts = [
    {
      id: 'price',
      title: 'Price',
      done: (data.prices ?? []).some((p) => p.productId === productId && p.state === 'ACTIVE'),
    },
    {
      id: 'tanks',
      title: 'Tanks',
      done: (data.tanks ?? []).some(
        (t) => t.productId === productId && t.status === 'ACTIVE' && t.acceptableVarianceLitres,
      ),
    },
    {
      id: 'pumps',
      title: 'Pumps and nozzles',
      done: (data.nozzles ?? []).some((n) => n.productId === productId && n.status === 'ACTIVE'),
    },
  ];
  const [index, setIndex] = useState(() => {
    const first = parts.findIndex((part) => !part.done);
    return first === -1 ? 0 : first;
  });
  const part = parts[index]!;
  const last = index === parts.length - 1;
  const footer = (
    <>
      {index > 0 ? (
        <Button variant="secondary" onClick={() => setIndex(index - 1)}>
          Back
        </Button>
      ) : null}
      {last ? null : <Button onClick={() => setIndex(index + 1)}>Next</Button>}
    </>
  );
  return (
    <BottomNotchCard
      actions={index === 0 && last ? undefined : footer}
      actionCount={index > 0 && !last ? 2 : 1}
      overlay={overlay}
      surfaceClassName={styles.fuelSurface}
    >
      {header}
      <div id={bodyId} className={styles.stepBody}>
        <ol className={styles.partList} aria-label="Parts of this fuel">
          {parts.map((item, position) => (
            <li key={item.id}>
              <button
                type="button"
                className={styles.partTab}
                data-current={position === index || undefined}
                data-done={item.done || undefined}
                aria-current={position === index ? 'step' : undefined}
                onClick={() => setIndex(position)}
              >
                <span className={styles.partNumber}>
                  {item.done ? <Icon name="check-circle" /> : position + 1}
                </span>
                {item.title}
              </button>
            </li>
          ))}
        </ol>
        <FuelKind ctx={ctx} productId={productId} />
        {part.id === 'price' ? <PriceStep ctx={ctx} productId={productId} /> : null}
        {part.id === 'tanks' ? <TankStep ctx={ctx} productId={productId} /> : null}
        {part.id === 'pumps' ? <PumpStep ctx={ctx} productId={productId} /> : null}
      </div>
    </BottomNotchCard>
  );
}

function GuideSteps({
  tenantId,
  stationId,
  stationName,
  data,
  refresh,
  staff,
  onOpenStaff,
}: {
  tenantId: string;
  stationId: string;
  stationName: string;
  data: ConfigurationSetupOverview;
  refresh: () => void;
  staff?: StaffOverview;
  onOpenStaff?: () => void;
}) {
  const steps = buildGuidedSteps(data);
  const fuelCards = buildFuelCards(data);
  const stepById = (id: GuidedStepId) => steps.find((s) => s.id === id)!;

  // The screen is a list of sections: fuel types, then one card per fuel (its price, tanks, pumps
  // and nozzles together), then the parts that belong to the whole station.
  type Section = {
    key: string;
    title: string;
    detail: string;
    status: 'done' | 'todo' | 'blocked';
    badge?: string;
    purpose: string;
    noAccess?: boolean;
    blocked?: boolean;
  };
  const sections: Section[] = [];
  const fuelStep = stepById('fuel');
  sections.push({
    key: 'fuel',
    title: fuelStep.title,
    detail: fuelStep.summary,
    status: fuelStep.status,
    purpose: `${fuelStep.purpose} Add each fuel here, then set up its price, tanks, pumps and nozzles in its own card below.`,
    noAccess: !fuelStep.canEdit && fuelStep.status !== 'done',
  });
  for (const card of fuelCards) {
    sections.push({
      key: `fuel:${card.productId}`,
      title: card.name,
      detail: card.summary,
      status: card.status,
      badge: card.status === 'done' ? 'Ready' : 'To do',
      purpose: `Everything for ${card.name}: what you charge, the tanks that hold it, and the pumps and nozzles that sell it.`,
    });
  }
  for (const id of ['shifts', 'supervisor'] as const) {
    const step = stepById(id);
    sections.push({
      key: id,
      title: step.title,
      detail: step.status === 'blocked' ? (step.blockedReason ?? step.summary) : step.summary,
      status: step.status,
      purpose: step.purpose,
      noAccess: !step.canEdit && step.status !== 'done',
      blocked: step.status === 'blocked',
    });
  }

  // The section opened on first load stays open after saving, so its confirmation is not lost;
  // the person moves on with the "Next" button.
  const [open, setOpen] = useState<string | null>(() => {
    const first = sections.find((section) => section.key !== 'fuel' && section.status === 'todo');
    return first ? first.key : null;
  });
  const [addingFuel, setAddingFuel] = useState(false);
  const [addingShift, setAddingShift] = useState(false);
  const [supervisorBusy, setSupervisorBusy] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);
  const [renameText, setRenameText] = useState('');
  const [renameError, setRenameError] = useState<string>();
  const [changingUnit, setChangingUnit] = useState<{
    id: string;
    name: string;
    unit: FuelUnitChoice;
  } | null>(null);
  const [pending, setPending] = useState<(() => Promise<void>) | null>(null);
  const confirmedUntil = useRef(0);
  const fuelActions = useSaver('/api/setup/commands', refresh, () => {
    confirmedUntil.current = 0;
  });
  const { done, total } = progress(steps);
  const gate: Gate = (save) => {
    // Runs only from event handlers, never during render.
    // eslint-disable-next-line react-hooks/purity
    if (Date.now() < confirmedUntil.current) void save();
    else setPending(() => save);
  };
  const ctx: FormContext = {
    tenantId,
    stationId,
    data,
    refresh,
    gate,
    onDenied: () => {
      confirmedUntil.current = 0;
    },
    staff,
    onOpenStaff,
  };

  const hiddenFuels = (data.products ?? []).filter((p) => p.status !== 'ACTIVE');

  function runFuelCommand(body: Record<string, unknown>, success: string, after?: () => void) {
    ctx.gate(async () => {
      const saved = await fuelActions.save({ ...body, tenantId, stationId }, success);
      if (saved) after?.();
    });
  }

  function submitRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!renaming) return;
    const name = renameText.trim();
    if (!name) {
      setRenameError('Enter the name of the fuel, for example Diesel.');
      return;
    }
    setRenameError(undefined);
    runFuelCommand(
      { commandType: 'RenameProduct', productId: renaming.id, name },
      `Now called ${name}.`,
      () => setRenaming(null),
    );
  }

  function submitUnit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!changingUnit) return;
    runFuelCommand(
      { commandType: 'SetProductUnit', productId: changingUnit.id, unit: changingUnit.unit },
      `${changingUnit.name} is now measured in ${changingUnit.unit === 'KILOGRAMS' ? 'kilograms' : 'litres'}.`,
      () => setChangingUnit(null),
    );
  }

  function chooseFuelAction(productId: string, name: string, action: string) {
    if (action === 'open') setOpen(open === `fuel:${productId}` ? null : `fuel:${productId}`);
    else if (action === 'rename') {
      setRenameText(name);
      setRenameError(undefined);
      setRenaming({ id: productId, name });
    } else if (action === 'unit') {
      const product = (data.products ?? []).find((p) => p.id === productId);
      setChangingUnit({ id: productId, name, unit: product?.unit ?? 'LITRES' });
    } else if (action === 'hide') {
      runFuelCommand(
        { commandType: 'SetProductStatus', productId, status: 'INACTIVE' },
        `${name} is hidden.`,
      );
    }
  }

  function renderBody(key: string): ReactNode {
    if (key === 'shifts') {
      return <ShiftStep ctx={ctx} open={addingShift} onClose={() => setAddingShift(false)} />;
    }
    if (key === 'supervisor') return <SupervisorStep ctx={ctx} onBusy={setSupervisorBusy} />;
    return null;
  }

  function renderSection(section: Section, number: number) {
    const expanded = open === section.key;
    const bodyId = `step-body-${section.key.replace(':', '-')}`;
    const next = sections[sections.indexOf(section) + 1];
    const goesToStaff = section.key === 'supervisor' && section.blocked && !!onOpenStaff;
    const isFuel = section.key.startsWith('fuel:');
    const header = (
      <button
        type="button"
        className={styles.stepHeader}
        data-status={section.status}
        aria-expanded={expanded}
        aria-controls={bodyId}
        disabled={section.blocked && !goesToStaff}
        onClick={() => (goesToStaff ? onOpenStaff?.() : setOpen(expanded ? null : section.key))}
      >
        <span
          className={styles.stepNumber}
          role="img"
          aria-label={section.status === 'done' ? 'Done' : 'In progress'}
        >
          {section.status === 'done' ? <Icon name="check-circle" /> : number}
        </span>
        <span className={styles.stepText}>
          <span className={styles.rowTitle}>{section.title}</span>
          {expanded && section.key === 'supervisor' ? null : (
            <span className={styles.rowDetail} title={isFuel ? section.detail : undefined}>
              {section.detail}
            </span>
          )}
        </span>
        {goesToStaff ? (
          <span className={styles.stepBadge}>
            <StatusBadge tone={TONE[section.status]}>Go to Staff</StatusBadge>
          </span>
        ) : section.blocked ? null : (
          <span className={styles.chevron} aria-hidden="true">
            <Icon name="chevron-down" />
          </span>
        )}
      </button>
    );
    const cardActions =
      isFuel && fuelStep.canEdit ? (
        <div className={styles.cardActions}>
          {section.status !== 'done' ? (
            <button
              type="button"
              className={`${styles.iconButton} ${styles.iconButtonDanger}`}
              aria-label={`Delete ${section.title}`}
              title="Delete"
              onClick={() => setDeleting({ id: section.key.slice(5), name: section.title })}
            >
              <TrashIcon />
            </button>
          ) : null}
          <FuelMenu
            label={`More actions for ${section.title}`}
            options={[
              { value: 'open', label: expanded ? 'Close details' : 'Open details' },
              { value: 'rename', label: 'Rename fuel' },
              { value: 'unit', label: 'Change unit' },
              { value: 'hide', label: 'Hide fuel' },
            ]}
            onChoose={(action) => chooseFuelAction(section.key.slice(5), section.title, action)}
          />
        </div>
      ) : null;
    const supervisorActions =
      section.key === 'supervisor' && expanded && staff && onOpenStaff ? (
        <div className={styles.cardActions}>
          <Button
            variant="secondary"
            size="sm"
            aria-label="Add a supervisor in Staff"
            onClick={onOpenStaff}
          >
            Add
          </Button>
        </div>
      ) : null;
    const shiftActions =
      section.key === 'shifts' && expanded && ctx.data.capabilities.shiftTemplates ? (
        <div className={styles.cardActions}>
          <Button
            variant="secondary"
            size="sm"
            aria-haspopup="dialog"
            aria-label="Add a shift"
            onClick={() => setAddingShift(true)}
          >
            Add
          </Button>
        </div>
      ) : null;
    const extraActions = shiftActions ?? supervisorActions;
    if (isFuel && expanded && fuelStep.canEdit && !section.noAccess) {
      return (
        <li key={section.key} className={styles.step} data-has-actions data-expanded>
          <FuelSteps
            ctx={ctx}
            productId={section.key.slice('fuel:'.length)}
            header={header}
            overlay={cardActions}
            bodyId={bodyId}
          />
        </li>
      );
    }
    const body = expanded ? (
      <div id={bodyId} className={styles.stepBody}>
        {section.key.startsWith('fuel:') ||
        section.key === 'shifts' ||
        section.key === 'supervisor' ? null : (
          <p className={styles.note}>{section.purpose}</p>
        )}
        {section.noAccess ? (
          <p className={styles.note}>
            You can see this step but you do not have permission to change it.
          </p>
        ) : (
          renderBody(section.key)
        )}
      </div>
    ) : null;
    // When there is a next step, the card gives up its corner to a "Next" button, like the fuel cards.
    const saveSupervisor =
      section.key === 'supervisor' &&
      ctx.data.capabilities.forecourt &&
      !section.noAccess &&
      (ctx.data.supervisors ?? []).length > 0;
    const nextShown = section.status === 'done' && next && next.status !== 'blocked';
    if (expanded && (nextShown || saveSupervisor)) {
      return (
        <li
          key={section.key}
          className={styles.step}
          data-expanded
          data-has-actions={extraActions ? true : undefined}
        >
          <BottomNotchCard
            actions={
              nextShown && next ? (
                <Button aria-label={`Next: ${next.title}`} onClick={() => setOpen(next.key)}>
                  Next
                </Button>
              ) : (
                <Button type="submit" form="supervisor-form" loading={supervisorBusy}>
                  Save
                </Button>
              )
            }
            actionCount={1}
            overlay={
              <>
                {cardActions}
                {extraActions}
              </>
            }
            surfaceClassName={styles.fuelSurface}
          >
            {header}
            {body}
          </BottomNotchCard>
        </li>
      );
    }
    return (
      <li
        key={section.key}
        className={styles.step}
        data-has-actions={isFuel || extraActions ? true : undefined}
        data-open={extraActions ? true : undefined}
      >
        {header}
        {cardActions}
        {extraActions}
        {body}
      </li>
    );
  }

  return (
    <div className={styles.stack}>
      <div className={styles.headingRow}>
        <h3 className={styles.subTitle}>Fuel types</h3>
        {fuelStep.canEdit ? (
          <Button
            variant="secondary"
            size="sm"
            aria-haspopup="dialog"
            aria-label="Add a fuel type"
            onClick={() => setAddingFuel(true)}
          >
            Add
          </Button>
        ) : null}
      </div>
      {fuelCards.length > 0 ? (
        <ol className={`${styles.stepList} ${styles.fuelGrid}`}>
          {sections
            .filter((section) => section.key.startsWith('fuel:'))
            .map((section, position) => renderSection(section, position + 1))}
        </ol>
      ) : (
        <p className={styles.note}>No fuel types yet. Add the first one to begin.</p>
      )}
      <Message outcome={fuelActions.outcome} />
      {hiddenFuels.length > 0 && fuelStep.canEdit ? (
        <ul className={styles.itemList} aria-label="Hidden fuel types">
          {hiddenFuels.map((p) => (
            <li key={p.id} className={styles.hiddenFuel}>
              <span>{p.name} is hidden.</span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  runFuelCommand(
                    { commandType: 'SetProductStatus', productId: p.id, status: 'ACTIVE' },
                    `${p.name} is back.`,
                  )
                }
              >
                Show again
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <FuelStep ctx={ctx} open={addingFuel} onClose={() => setAddingFuel(false)} />
      <Modal
        open={renaming !== null}
        onClose={() => !fuelActions.busy && setRenaming(null)}
        title="Rename fuel"
        size="sm"
        dismissible={!fuelActions.busy}
      >
        <form className={styles.form} onSubmit={submitRename} noValidate aria-label="Rename fuel">
          <Field id="rename-fuel" label="Fuel name" error={renameError} required>
            <input
              id="rename-fuel"
              value={renameText}
              onChange={(event) => setRenameText(event.target.value)}
              autoComplete="off"
              maxLength={120}
            />
          </Field>
          <p className={styles.note}>The new name shows at every station of the company.</p>
          <div className={styles.formActions}>
            <Button
              variant="secondary"
              type="button"
              onClick={() => setRenaming(null)}
              disabled={fuelActions.busy}
            >
              Cancel
            </Button>
            <Button type="submit" loading={fuelActions.busy}>
              Save name
            </Button>
          </div>
        </form>
      </Modal>
      <Modal
        open={changingUnit !== null}
        onClose={() => !fuelActions.busy && setChangingUnit(null)}
        title={`How is ${changingUnit?.name ?? 'this fuel'} measured?`}
        size="sm"
        dismissible={!fuelActions.busy}
      >
        <form className={styles.form} onSubmit={submitUnit} noValidate aria-label="Change unit">
          <Field id="change-unit" label="Measured in">
            <select
              id="change-unit"
              value={changingUnit?.unit ?? 'LITRES'}
              onChange={(event) =>
                setChangingUnit((current) =>
                  current ? { ...current, unit: event.target.value as FuelUnitChoice } : current,
                )
              }
            >
              {(['LITRES', 'KILOGRAMS'] as const).map((unit) => (
                <option key={unit} value={unit}>
                  {unitLabel(unit)}
                </option>
              ))}
            </select>
          </Field>
          <p className={styles.note}>
            This can only be changed before the fuel has deliveries or sales recorded.
          </p>
          <div className={styles.formActions}>
            <Button
              variant="secondary"
              type="button"
              onClick={() => setChangingUnit(null)}
              disabled={fuelActions.busy}
            >
              Cancel
            </Button>
            <Button type="submit" loading={fuelActions.busy}>
              Save unit
            </Button>
          </div>
        </form>
      </Modal>
      <Modal
        open={deleting !== null}
        onClose={() => !fuelActions.busy && setDeleting(null)}
        title={`Delete ${deleting?.name ?? 'fuel'}?`}
        role="alertdialog"
        size="sm"
        dismissible={!fuelActions.busy}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setDeleting(null)}
              disabled={fuelActions.busy}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={fuelActions.busy}
              onClick={() =>
                deleting &&
                runFuelCommand(
                  { commandType: 'DeleteProduct', productId: deleting.id },
                  `${deleting.name} was deleted.`,
                  () => setDeleting(null),
                )
              }
            >
              Delete
            </Button>
          </>
        }
      >
        <p className={styles.note}>
          This cannot be undone. A fuel that already has tanks, nozzles, prices or sales cannot be
          deleted. Hide it instead.
        </p>
        <Message outcome={fuelActions.outcome} />
      </Modal>
      <h3 className={`${styles.subTitle} ${styles.sectionBreak}`}>The whole station</h3>
      <ol className={`${styles.stepList} ${styles.wholeGrid}`}>
        {sections
          .filter((section) => !section.key.startsWith('fuel'))
          .map((section, position) => renderSection(section, position + 1))}
      </ol>
      {done === total ? (
        <div className={styles.formActions}>
          <p className={styles.note}>Setup is finished. Next, enter what the station has today.</p>
          <Link className="button button-primary" href="/go-live/opening-balances">
            Next: Add opening balances
          </Link>
        </div>
      ) : null}
      <StepUpDialog
        open={pending !== null}
        tenantId={tenantId}
        description="Saving this setup needs a fresh identity check. Nothing is saved until you confirm."
        onCancel={() => setPending(null)}
        onVerified={() => {
          confirmedUntil.current = Date.now() + STEP_UP_REUSE_MS;
          const save = pending;
          setPending(null);
          if (save) void save();
        }}
      />
    </div>
  );
}

function Guide({ overview }: { overview: Ready }) {
  // With several stations the person chooses; no station is picked for them, so nothing is set up
  // on the wrong one.
  const [stationId, setStationId] = useState(
    overview.stationOptions.length === 1 ? overview.stationOptions[0]!.id : '',
  );
  const station = overview.stationOptions.find((s) => s.id === stationId);
  if (overview.stationOptions.length === 0) {
    return (
      <AccessDeniedState message="No stations are available to you yet. Ask the owner to add one." />
    );
  }
  return (
    <div className={styles.stack}>
      <p className={styles.note}>
        Set up each fuel on its own, then the shifts and the supervisor. Anything you save stays
        saved, so you can stop and come back whenever you like.
      </p>
      {overview.stationOptions.length > 1 ? (
        <div className={styles.form}>
          <Field id="guide-station" label="Which station are you setting up?" required>
            <Select
              id="guide-station"
              value={stationId}
              onChange={(event) => setStationId(event.target.value)}
              placeholder="Choose a station"
              options={overview.stationOptions.map((s) => ({ value: s.id, label: s.name }))}
            />
          </Field>
        </div>
      ) : null}
      {station ? (
        <StationSetupGuide
          key={station.id}
          tenantId={overview.tenantId}
          stationId={station.id}
          stationName={station.name}
        />
      ) : null}
    </div>
  );
}

export function GuidedSetupPanel() {
  const { state, reload } = useSetupOverview();
  if (state.kind === 'loading') return <LoadingState label="Loading station setup" />;
  if (state.kind === 'unavailable') {
    return <AccessDeniedState message="You do not have access to station setup." />;
  }
  if (state.kind === 'error') {
    return (
      <ErrorState
        title="Setup could not be loaded"
        message="Station setup could not be read just now. Nothing has been changed."
        action={<Button onClick={reload}>Try again</Button>}
      />
    );
  }
  return <Guide overview={state.overview} />;
}
