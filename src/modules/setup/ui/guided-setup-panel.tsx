'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';

import { Icon } from '@/design-system/icons';
import { Radio, Select } from '@/design-system/forms';
import {
  AccessDeniedState,
  Button,
  ErrorState,
  Field,
  LoadingState,
  StatusBadge,
} from '@/design-system/primitives';

import type { ConfigurationSetupOverview, SetupOverview } from '../contracts';
import {
  buildGuidedSteps,
  describeDuration,
  describePriceState,
  displayPrice,
  firstOpenStep,
  friendlyPriceError,
  friendlySetupError,
  hoursToMinutes,
  parsePositiveDecimal,
  planPriceAdvance,
  progress,
  suggestCode,
  type GuidedStep,
  type GuidedStepId,
} from '../guided-setup';
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
};

type Errors = Record<string, string | undefined>;
const hasErrors = (errors: Errors) => Object.values(errors).some(Boolean);
const text = (data: FormData, name: string) => String(data.get(name) ?? '').trim();

function activeProducts(data: ConfigurationSetupOverview) {
  return (data.products ?? []).filter((p) => p.status === 'ACTIVE');
}
function productOptions(data: ConfigurationSetupOverview) {
  return activeProducts(data).map((p) => ({ value: p.id, label: p.name }));
}

function ItemList({
  items,
  label,
}: {
  items: ReadonlyArray<{ id: string; text: string }>;
  label: string;
}) {
  if (items.length === 0) return null;
  return (
    <ul className={styles.itemList} aria-label={label}>
      {items.map((item) => (
        <li key={item.id}>{item.text}</li>
      ))}
    </ul>
  );
}

function FuelStep({ ctx }: { ctx: FormContext }) {
  const { save, busy, outcome } = useSaver('/api/setup/commands', ctx.refresh, ctx.onDenied);
  const [errors, setErrors] = useState<Errors>({});
  const products = activeProducts(ctx.data);
  // Held in state, not read from the form, so it is cleared even if the screen was redrawn while
  // the identity check was open.
  const [fuelName, setFuelName] = useState('');

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = fuelName.trim();
    const next = { name: name ? undefined : 'Enter the name of the fuel, for example Diesel.' };
    setErrors(next);
    if (hasErrors(next)) return;
    const code = suggestCode(
      name,
      (ctx.data.products ?? []).map((p) => p.code),
    );
    ctx.gate(async () => {
      const saved = await save(
        {
          commandType: 'CreateProduct',
          tenantId: ctx.tenantId,
          stationId: ctx.stationId,
          code,
          name,
        },
        `${name} was added.`,
      );
      if (saved) setFuelName('');
    });
  }

  return (
    <>
      <ItemList
        label="Fuel types added"
        items={products.map((p) => ({ id: p.id, text: p.name }))}
      />
      {ctx.data.capabilities.products ? (
        <form className={styles.form} onSubmit={submit} noValidate aria-label="Add a fuel type">
          <Field id="fuel-name" label="Fuel name" error={errors.name} required>
            <input
              id="fuel-name"
              name="name"
              value={fuelName}
              onChange={(event) => setFuelName(event.target.value)}
              autoComplete="off"
              maxLength={120}
              placeholder="Diesel"
            />
          </Field>
          <div className={styles.formActions}>
            <Button type="submit" loading={busy}>
              Add fuel type
            </Button>
            <Message outcome={outcome} />
          </div>
        </form>
      ) : null}
    </>
  );
}

function PriceStep({ ctx }: { ctx: FormContext }) {
  const { save, busy, outcome } = useSaver('/api/setup/commands', ctx.refresh, ctx.onDenied);
  const [errors, setErrors] = useState<Errors>({});
  const products = activeProducts(ctx.data);
  const nameOf = (id: string) => products.find((p) => p.id === id)?.name ?? 'Fuel';
  const prices = (ctx.data.prices ?? []).filter((p) => p.state !== 'SUPERSEDED');
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
    const productId = text(data, 'productId');
    const price = parsePositiveDecimal(text(data, 'price'), 6);
    const next = {
      product: productId ? undefined : 'Choose the fuel.',
      price: price ? undefined : 'Enter the price per litre, for example 1.65.',
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
      {prices.length > 0 ? (
        <ul className={styles.itemList} aria-label="Prices">
          {prices.map((p) => {
            const { label } = planPriceAdvance(p.state, ctx.data.capabilities);
            return (
              <li key={p.id}>
                {`${nameOf(p.productId)}: ${displayPrice(p.unitPrice)} USD per litre (${describePriceState(p.state)})`}
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
      {ctx.data.capabilities.priceRequest ? (
        <form className={styles.form} onSubmit={submit} noValidate aria-label="Set a selling price">
          <Field id="price-product" label="Fuel" error={errors.product} required>
            <Select
              id="price-product"
              name="productId"
              defaultValue=""
              placeholder="Choose the fuel"
              options={productOptions(ctx.data)}
            />
          </Field>
          <Field
            id="price-amount"
            label="Price per litre (USD)"
            hint="A manager approves the price before it is used on sales."
            error={errors.price}
            required
          >
            <input id="price-amount" name="price" inputMode="decimal" autoComplete="off" />
          </Field>
          <div className={styles.formActions}>
            <Button type="submit" loading={busy}>
              Save price
            </Button>
            <Message outcome={outcome} />
          </div>
        </form>
      ) : null}
      <p className={styles.note}>
        To change the price of a fuel that is already selling, use{' '}
        <Link href="/operations/daily/price-change">Change a price</Link>.
      </p>
    </>
  );
}

function TankStep({ ctx }: { ctx: FormContext }) {
  const { save, busy, outcome } = useSaver('/api/inventory/commands', ctx.refresh, ctx.onDenied);
  const [errors, setErrors] = useState<Errors>({});
  const products = activeProducts(ctx.data);
  const nameOf = (id: string) => products.find((p) => p.id === id)?.name ?? 'Fuel';
  const tanks = (ctx.data.tanks ?? []).filter((t) => t.status === 'ACTIVE');

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const name = text(data, 'name');
    const productId = text(data, 'productId');
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
      capacity: capacity ? undefined : 'Enter how many litres the tank holds.',
      reorder:
        reorderText && !reorder ? 'Enter a number of litres, or leave this empty.' : undefined,
      difference:
        differenceText && !difference
          ? 'Enter a number of litres, or leave this empty.'
          : undefined,
      red:
        redText && !red
          ? 'Enter a number of litres, or leave this empty.'
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
      if (saved) form.reset();
    });
  }

  return (
    <>
      <ItemList
        label="Tanks added"
        items={tanks.map((t) => ({
          id: t.id,
          text: `${t.code}: ${nameOf(t.productId)}, holds ${t.capacityLitres} litres`,
        }))}
      />
      {ctx.data.capabilities.tanks ? (
        <form className={styles.form} onSubmit={submit} noValidate aria-label="Add a tank">
          <Field id="tank-name" label="Tank name" error={errors.name} required>
            <input
              id="tank-name"
              name="name"
              autoComplete="off"
              maxLength={32}
              placeholder="Tank 1"
            />
          </Field>
          <Field id="tank-product" label="Fuel in this tank" error={errors.product} required>
            <Select
              id="tank-product"
              name="productId"
              defaultValue=""
              placeholder="Choose the fuel"
              options={productOptions(ctx.data)}
            />
          </Field>
          <Field id="tank-capacity" label="Litres the tank holds" error={errors.capacity} required>
            <input id="tank-capacity" name="capacity" inputMode="decimal" autoComplete="off" />
          </Field>
          <Field
            id="tank-difference"
            label="Yellow: explain above (litres)"
            hint="How far the dip reading may be from the book stock before the difference must be explained."
            error={errors.difference}
            optional
          >
            <input id="tank-difference" name="difference" inputMode="decimal" autoComplete="off" />
          </Field>
          <Field
            id="tank-red"
            label="Red: urgent above (litres)"
            hint="A difference above this is urgent. Leave it empty to use twice the yellow limit."
            error={errors.red}
            optional
          >
            <input id="tank-red" name="red" inputMode="decimal" autoComplete="off" />
          </Field>
          <Field
            id="tank-reorder"
            label="Warn me when stock falls to (litres)"
            hint="Used for low-stock reminders."
            error={errors.reorder}
            optional
          >
            <input id="tank-reorder" name="reorder" inputMode="decimal" autoComplete="off" />
          </Field>
          <div className={styles.formActions}>
            <Button type="submit" loading={busy}>
              Add tank
            </Button>
            <Message outcome={outcome} />
          </div>
        </form>
      ) : null}
    </>
  );
}

function PumpStep({ ctx }: { ctx: FormContext }) {
  const pumpSaver = useSaver('/api/setup/commands', ctx.refresh, ctx.onDenied);
  const nozzleSaver = useSaver('/api/setup/commands', ctx.refresh, ctx.onDenied);
  const [pumpErrors, setPumpErrors] = useState<Errors>({});
  const [nozzleErrors, setNozzleErrors] = useState<Errors>({});
  const pumps = (ctx.data.pumps ?? []).filter((p) => p.status === 'ACTIVE');
  const nozzles = (ctx.data.nozzles ?? []).filter((n) => n.status === 'ACTIVE');
  const products = activeProducts(ctx.data);
  const pumpLabel = (p: { number: string; name: string | null }) =>
    p.name ? `Pump ${p.number} (${p.name})` : `Pump ${p.number}`;

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
      if (saved) form.reset();
    });
  }

  function addNozzle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const pumpId = text(data, 'pumpId');
    const number = text(data, 'number');
    const productId = text(data, 'productId');
    const meter = text(data, 'meter');
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
        },
        `Nozzle ${number} was added.`,
      );
      if (saved) form.reset();
    });
  }

  const canEdit = ctx.data.capabilities.forecourt;
  return (
    <>
      <ItemList
        label="Pumps added"
        items={pumps.map((p) => {
          const own = nozzles.filter((n) => n.pumpId === p.id);
          return {
            id: p.id,
            text:
              own.length === 0
                ? `${pumpLabel(p)}: no nozzle yet`
                : `${pumpLabel(p)}: ${own
                    .map(
                      (n) =>
                        `nozzle ${n.number} (${products.find((x) => x.id === n.productId)?.name ?? 'fuel'})`,
                    )
                    .join(', ')}`,
          };
        })}
      />
      {canEdit ? (
        <>
          <form className={styles.form} onSubmit={addPump} noValidate aria-label="Add a pump">
            <h4 className={styles.subTitle}>Add a pump</h4>
            <Field id="pump-number" label="Pump number" error={pumpErrors.number} required>
              <input id="pump-number" name="number" autoComplete="off" maxLength={16} />
            </Field>
            <Field id="pump-name" label="Pump name" hint="Optional, for example Island 1." optional>
              <input id="pump-name" name="name" autoComplete="off" maxLength={80} />
            </Field>
            <div className={styles.formActions}>
              <Button type="submit" loading={pumpSaver.busy}>
                Add pump
              </Button>
              <Message outcome={pumpSaver.outcome} />
            </div>
          </form>
          {pumps.length > 0 ? (
            <form className={styles.form} onSubmit={addNozzle} noValidate aria-label="Add a nozzle">
              <h4 className={styles.subTitle}>Add a nozzle to a pump</h4>
              <Field id="nozzle-pump" label="Pump" error={nozzleErrors.pump} required>
                <Select
                  id="nozzle-pump"
                  name="pumpId"
                  defaultValue=""
                  placeholder="Choose the pump"
                  options={pumps.map((p) => ({ value: p.id, label: pumpLabel(p) }))}
                />
              </Field>
              <Field id="nozzle-number" label="Nozzle number" error={nozzleErrors.number} required>
                <input id="nozzle-number" name="number" autoComplete="off" maxLength={16} />
              </Field>
              <Field id="nozzle-product" label="Fuel sold" error={nozzleErrors.product} required>
                <Select
                  id="nozzle-product"
                  name="productId"
                  defaultValue=""
                  placeholder="Choose the fuel"
                  options={productOptions(ctx.data)}
                />
              </Field>
              <Field
                id="nozzle-meter"
                label="Meter serial number"
                hint="Printed on the meter. Opening readings are taken at the first shift."
                error={nozzleErrors.meter}
                required
              >
                <input id="nozzle-meter" name="meter" autoComplete="off" maxLength={80} />
              </Field>
              <div className={styles.formActions}>
                <Button type="submit" loading={nozzleSaver.busy}>
                  Add nozzle
                </Button>
                <Message outcome={nozzleSaver.outcome} />
              </div>
            </form>
          ) : null}
        </>
      ) : null}
    </>
  );
}

function ShiftStep({ ctx }: { ctx: FormContext }) {
  const { save, busy, outcome } = useSaver('/api/forecourt/commands', ctx.refresh, ctx.onDenied);
  const [errors, setErrors] = useState<Errors>({});
  const shifts = (ctx.data.shiftTemplates ?? []).filter((s) => s.active);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const name = text(data, 'name');
    const start = text(data, 'start');
    const minutes = hoursToMinutes(text(data, 'hours'));
    const next = {
      name: name ? undefined : 'Give the shift a name, for example Day shift.',
      start: /^([01]\d|2[0-3]):[0-5]\d$/.test(start) ? undefined : 'Choose the start time.',
      hours: minutes ? undefined : 'Enter how many hours the shift runs, for example 8.',
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
      if (saved) form.reset();
    });
  }

  return (
    <>
      <ItemList
        label="Shifts added"
        items={shifts.map((s) => ({
          id: s.id,
          text: `${s.name}${s.startTime ? ` from ${s.startTime}` : ''}, ${describeDuration(s.durationMinutes)}`,
        }))}
      />
      {ctx.data.capabilities.shiftTemplates ? (
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
          <Field id="shift-start" label="Starts at" error={errors.start} required>
            <input id="shift-start" name="start" type="time" />
          </Field>
          <Field id="shift-hours" label="Hours the shift runs" error={errors.hours} required>
            <input
              id="shift-hours"
              name="hours"
              inputMode="decimal"
              autoComplete="off"
              defaultValue="8"
            />
          </Field>
          <div className={styles.formActions}>
            <Button type="submit" loading={busy}>
              Add shift
            </Button>
            <Message outcome={outcome} />
          </div>
        </form>
      ) : null}
    </>
  );
}

function SupervisorStep({ ctx }: { ctx: FormContext }) {
  const { save, busy, outcome } = useSaver('/api/setup/commands', ctx.refresh, ctx.onDenied);
  const supervisors = ctx.data.supervisors ?? [];
  const [choice, setChoice] = useState(ctx.data.responsibleSupervisorMembershipId ?? '');
  const [error, setError] = useState<string>();

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
    <form
      className={styles.form}
      onSubmit={submit}
      noValidate
      aria-label="Choose the supervisor in charge"
    >
      <fieldset className={styles.choices}>
        <legend className={styles.note}>Who is in charge of this station?</legend>
        {supervisors.map((s) => (
          <Radio
            key={s.membershipId}
            name="supervisor"
            value={s.membershipId}
            checked={choice === s.membershipId}
            onChange={() => setChoice(s.membershipId)}
            label={s.name}
          />
        ))}
        {error ? (
          <p className={styles.messageError} role="alert">
            {error}
          </p>
        ) : null}
      </fieldset>
      <div className={styles.formActions}>
        <Button type="submit" loading={busy}>
          Save
        </Button>
        <Message outcome={outcome} />
      </div>
    </form>
  );
}

function StepBody({ step, ctx }: { step: GuidedStep; ctx: FormContext }): ReactNode {
  switch (step.id) {
    case 'fuel':
      return <FuelStep ctx={ctx} />;
    case 'prices':
      return <PriceStep ctx={ctx} />;
    case 'tanks':
      return <TankStep ctx={ctx} />;
    case 'pumps':
      return <PumpStep ctx={ctx} />;
    case 'shifts':
      return <ShiftStep ctx={ctx} />;
    case 'supervisor':
      return <SupervisorStep ctx={ctx} />;
  }
}

const TONE = { done: 'positive', todo: 'warning', blocked: 'neutral' } as const;
const LABEL = { done: 'Done', todo: 'To do', blocked: 'Not yet' } as const;

function StationGuide({
  tenantId,
  stationId,
  stationName,
}: {
  tenantId: string;
  stationId: string;
  stationName: string;
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
    />
  );
}

function GuideSteps({
  tenantId,
  stationId,
  stationName,
  data,
  refresh,
}: {
  tenantId: string;
  stationId: string;
  stationName: string;
  data: ConfigurationSetupOverview;
  refresh: () => void;
}) {
  const steps = buildGuidedSteps(data);
  // The step opened on first load stays open after saving, so its confirmation is not lost;
  // the person moves on with the "Next" button.
  const [open, setOpen] = useState<GuidedStepId | null>(() => firstOpenStep(steps));
  const [pending, setPending] = useState<(() => Promise<void>) | null>(null);
  const confirmedUntil = useRef(0);
  const { done, total } = progress(steps);
  const gate: Gate = (save) => {
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
  };

  return (
    <div className={styles.stack}>
      <div className={styles.progressBlock}>
        <p className={styles.progressText} id={`progress-${stationId}`}>
          {done === total
            ? `${stationName} is fully set up.`
            : `${done} of ${total} steps done for ${stationName}`}
        </p>
        <progress
          className={styles.progressBar}
          value={done}
          max={total}
          aria-labelledby={`progress-${stationId}`}
        />
      </div>
      <ol className={styles.stepList}>
        {steps.map((step, index) => {
          const expanded = open === step.id;
          const bodyId = `step-body-${step.id}`;
          const next = steps[index + 1];
          return (
            <li key={step.id} className={styles.step}>
              <button
                type="button"
                className={styles.stepHeader}
                aria-expanded={expanded}
                aria-controls={bodyId}
                disabled={step.status === 'blocked'}
                onClick={() => setOpen(expanded ? null : step.id)}
              >
                <span className={styles.stepNumber} aria-hidden="true">
                  {step.status === 'done' ? <Icon name="check-circle" /> : index + 1}
                </span>
                <span className={styles.stepText}>
                  <span className={styles.rowTitle}>{step.title}</span>
                  <span className={styles.rowDetail}>
                    {step.status === 'blocked' ? step.blockedReason : step.summary}
                  </span>
                </span>
                <StatusBadge tone={TONE[step.status]}>{LABEL[step.status]}</StatusBadge>
              </button>
              {expanded ? (
                <div id={bodyId} className={styles.stepBody}>
                  <p className={styles.note}>{step.purpose}</p>
                  {step.canEdit || step.status === 'done' ? (
                    <StepBody step={step} ctx={ctx} />
                  ) : (
                    <p className={styles.note}>
                      You can see this step but you do not have permission to change it.
                    </p>
                  )}
                  {step.status === 'done' && next && next.status !== 'blocked' ? (
                    <div className={styles.formActions}>
                      <Button variant="secondary" onClick={() => setOpen(next.id)}>
                        Next: {next.title}
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
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
  const [stationId, setStationId] = useState(overview.stationOptions[0]?.id ?? '');
  const station = overview.stationOptions.find((s) => s.id === stationId);
  if (!station) {
    return (
      <AccessDeniedState message="No stations are available to you yet. Ask the owner to add one." />
    );
  }
  return (
    <div className={styles.stack}>
      <p className={styles.note}>
        Work through these steps from top to bottom. You can stop at any time and come back; what
        you have saved stays saved.
      </p>
      {overview.stationOptions.length > 1 ? (
        <div className={styles.form}>
          <Field id="guide-station" label="Which station are you setting up?">
            <Select
              id="guide-station"
              value={stationId}
              onChange={(event) => setStationId(event.target.value)}
              options={overview.stationOptions.map((s) => ({ value: s.id, label: s.name }))}
            />
          </Field>
        </div>
      ) : null}
      <StationGuide
        key={station.id}
        tenantId={overview.tenantId}
        stationId={station.id}
        stationName={station.name}
      />
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
