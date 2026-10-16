'use client';

import { useRef, useState, type FormEvent, type ReactNode } from 'react';

import { Select } from '@/design-system/forms';
import { Button, EmptyState, ErrorState, Field, StatusBadge } from '@/design-system/primitives';
import {
  isValidIanaTimeZone,
  stationLocalDateTimeToIso,
} from '../../../platform/domain/zoned-time';
import { StepUpDialog, type StepUpProvider } from './step-up-dialog';

import type {
  ConfigurationSetupOverview,
  SetupOverview,
  SetupProduct,
  SetupTank,
} from '../contracts';
import styles from './setup.module.css';
import { useSetupOverview } from './use-setup-overview';

type Ready = Extract<SetupOverview, { status: 'ready' }>;
type CommandEndpoint =
  '/api/setup/commands' | '/api/inventory/commands' | '/api/forecourt/commands';
type Outcome = { kind: 'success' | 'error'; message: string };

function stationLabel(data: ConfigurationSetupOverview, overview: Ready): string {
  const station = overview.stationOptions.find((item) => item.id === data.stationId);
  return station ? `${station.name} (${station.code})` : data.stationId;
}

function useSetupCommand(
  data: ConfigurationSetupOverview,
  onDone: () => void,
): {
  run: (
    endpoint: CommandEndpoint,
    body: Record<string, unknown>,
    success: string,
  ) => Promise<boolean>;
  busy: boolean;
  outcome?: Outcome;
} {
  const keys = useRef(new Map<string, string>());
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>();

  async function run(endpoint: CommandEndpoint, body: Record<string, unknown>, success: string) {
    const requestKey = JSON.stringify({ endpoint, body });
    const idempotencyKey = keys.current.get(requestKey) ?? `setup-form-${crypto.randomUUID()}`;
    keys.current.set(requestKey, idempotencyKey);
    setBusy(true);
    setOutcome(undefined);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
        body: JSON.stringify({ ...body, tenantId: data.tenantId, stationId: data.stationId }),
      });
      const result = (await response.json().catch(() => null)) as { message?: string } | null;
      if (!response.ok) {
        setOutcome({
          kind: 'error',
          message: result?.message ?? 'That configuration could not be saved. Nothing was changed.',
        });
        return false;
      }
      keys.current.delete(requestKey);
      setOutcome({ kind: 'success', message: success });
      onDone();
      return true;
    } catch {
      setOutcome({
        kind: 'error',
        message: 'That configuration could not be saved. Check your connection and try again.',
      });
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { run, busy, outcome };
}

function Feedback({ outcome }: { outcome?: Outcome }) {
  return outcome ? (
    <p className={styles.message} role={outcome.kind === 'error' ? 'alert' : 'status'}>
      {outcome.message}
    </p>
  ) : null;
}

function Section({
  title,
  intro,
  children,
}: {
  title: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <section
      className={styles.card}
      aria-labelledby={`setup-${title.toLowerCase().replaceAll(' ', '-')}`}
    >
      <div className={styles.cardHeader}>
        <div>
          <h3 id={`setup-${title.toLowerCase().replaceAll(' ', '-')}`} className={styles.cardTitle}>
            {title}
          </h3>
          <p className={styles.note}>{intro}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function ProductForm({ data, onDone }: { data: ConfigurationSetupOverview; onDone: () => void }) {
  const { run, busy, outcome } = useSetupCommand(data, onDone);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!code.trim() || !name.trim()) return;
    if (
      await run(
        '/api/setup/commands',
        { commandType: 'CreateProduct', code: code.trim(), name: name.trim() },
        `${name.trim()} was added.`,
      )
    ) {
      setCode('');
      setName('');
    }
  }
  return (
    <>
      {data.products?.length ? (
        <ul className={styles.list}>
          {data.products.map((product) => (
            <li className={styles.row} key={product.id}>
              <div className={styles.rowMain}>
                <span className={styles.rowTitle}>{product.name}</span>
                <span className={styles.rowDetail}>{product.code}</span>
              </div>
              <StatusBadge tone={product.status === 'ACTIVE' ? 'positive' : 'neutral'}>
                {product.status}
              </StatusBadge>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          title="No products entered"
          message="Add only products the station actually sells."
        />
      )}
      {data.capabilities.products ? (
        <form className={styles.form} onSubmit={submit} noValidate>
          <Field id="setup-product-code" label="Product code" required>
            <input
              id="setup-product-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              maxLength={32}
              required
            />
          </Field>
          <Field id="setup-product-name" label="Product name" required>
            <input
              id="setup-product-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={120}
              required
            />
          </Field>
          <div className={styles.formActions}>
            <Button type="submit" loading={busy}>
              Add product
            </Button>
            <Feedback outcome={outcome} />
          </div>
        </form>
      ) : null}
    </>
  );
}

function TankForm({ data, onDone }: { data: ConfigurationSetupOverview; onDone: () => void }) {
  const { run, busy, outcome } = useSetupCommand(data, onDone);
  const [values, setValues] = useState({
    code: '',
    productId: '',
    capacityLitres: '',
    reorderLevelLitres: '',
    acceptableVarianceLitres: '',
  });
  const activeProducts = data.products?.filter((product) => product.status === 'ACTIVE') ?? [];
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (
      !values.code ||
      !values.productId ||
      !values.capacityLitres ||
      !values.acceptableVarianceLitres
    )
      return;
    if (
      await run(
        '/api/inventory/commands',
        {
          commandType: 'CreateTank',
          ...values,
          reorderLevelLitres: values.reorderLevelLitres || null,
        },
        `${values.code} was added.`,
      )
    )
      setValues({
        code: '',
        productId: '',
        capacityLitres: '',
        reorderLevelLitres: '',
        acceptableVarianceLitres: '',
      });
  }
  return (
    <>
      {data.tanks?.length ? (
        <ul className={styles.list}>
          {data.tanks.map((tank) => (
            <li className={styles.row} key={tank.id}>
              <div className={styles.rowMain}>
                <span className={styles.rowTitle}>{tank.code}</span>
                <span className={styles.rowDetail}>
                  {productName(data.products, tank.productId)} · capacity {tank.capacityLitres} L
                </span>
              </div>
              <StatusBadge tone={tank.status === 'ACTIVE' ? 'positive' : 'neutral'}>
                {tank.status}
              </StatusBadge>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          title="No tanks entered"
          message="Capacity is not opening stock; enter the physical tank configuration first."
        />
      )}
      {data.capabilities.tanks ? (
        <form className={styles.form} onSubmit={submit} noValidate>
          <Field id="setup-tank-code" label="Tank code" required>
            <input
              id="setup-tank-code"
              value={values.code}
              onChange={(event) => setValues({ ...values, code: event.target.value })}
              required
            />
          </Field>
          <Field id="setup-tank-product" label="Fuel product" required>
            <Select
              id="setup-tank-product"
              value={values.productId}
              onChange={(event) => setValues({ ...values, productId: event.target.value })}
              options={activeProducts.map((product) => ({
                value: product.id,
                label: `${product.name} (${product.code})`,
              }))}
              placeholder="Choose a product"
            />
          </Field>
          <Field id="setup-tank-capacity" label="Capacity litres" required>
            <input
              id="setup-tank-capacity"
              inputMode="decimal"
              value={values.capacityLitres}
              onChange={(event) => setValues({ ...values, capacityLitres: event.target.value })}
              required
            />
          </Field>
          <Field id="setup-tank-reorder" label="Reorder level litres">
            <input
              id="setup-tank-reorder"
              inputMode="decimal"
              value={values.reorderLevelLitres}
              onChange={(event) => setValues({ ...values, reorderLevelLitres: event.target.value })}
            />
          </Field>
          <Field id="setup-tank-tolerance" label="Variance tolerance litres" required>
            <input
              id="setup-tank-tolerance"
              inputMode="decimal"
              value={values.acceptableVarianceLitres}
              onChange={(event) =>
                setValues({ ...values, acceptableVarianceLitres: event.target.value })
              }
              required
            />
          </Field>
          <div className={styles.formActions}>
            <Button type="submit" loading={busy}>
              Add tank
            </Button>
            <Feedback outcome={outcome} />
          </div>
        </form>
      ) : null}
    </>
  );
}

function productName(products: readonly SetupProduct[] | null | undefined, id: string): string {
  return products?.find((product) => product.id === id)?.name ?? 'Unknown product';
}

function ForecourtForms({
  data,
  onDone,
}: {
  data: ConfigurationSetupOverview;
  onDone: () => void;
}) {
  const { run, busy, outcome } = useSetupCommand(data, onDone);
  const pumps = data.pumps ?? [];
  const products = data.products?.filter((product) => product.status === 'ACTIVE') ?? [];
  const [pump, setPump] = useState({ number: '', name: '' });
  const [nozzle, setNozzle] = useState({
    pumpId: '',
    number: '',
    productId: '',
    meterSerialNumber: '',
  });
  async function addPump(event: FormEvent) {
    event.preventDefault();
    if (!pump.number.trim()) return;
    if (
      await run(
        '/api/setup/commands',
        { commandType: 'CreatePump', number: pump.number.trim(), name: pump.name.trim() || null },
        `Pump ${pump.number.trim()} was added.`,
      )
    )
      setPump({ number: '', name: '' });
  }
  async function addNozzle(event: FormEvent) {
    event.preventDefault();
    if (
      !nozzle.pumpId ||
      !nozzle.number.trim() ||
      !nozzle.productId ||
      !nozzle.meterSerialNumber.trim()
    )
      return;
    if (
      await run(
        '/api/setup/commands',
        {
          commandType: 'CreateNozzle',
          ...nozzle,
          number: nozzle.number.trim(),
          meterSerialNumber: nozzle.meterSerialNumber.trim(),
        },
        `Nozzle ${nozzle.number.trim()} and its meter were added.`,
      )
    )
      setNozzle({ pumpId: '', number: '', productId: '', meterSerialNumber: '' });
  }
  return (
    <>
      <ul className={styles.list}>
        {pumps.map((item) => (
          <li className={styles.row} key={item.id}>
            <div className={styles.rowMain}>
              <span className={styles.rowTitle}>Pump {item.number}</span>
              <span className={styles.rowDetail}>{item.name ?? 'No name'}</span>
            </div>
            <StatusBadge tone={item.status === 'ACTIVE' ? 'positive' : 'neutral'}>
              {item.status}
            </StatusBadge>
          </li>
        ))}
      </ul>
      {data.capabilities.forecourt ? (
        <>
          <form className={styles.form} onSubmit={addPump} noValidate>
            <Field id="setup-pump-number" label="Pump number" required>
              <input
                id="setup-pump-number"
                value={pump.number}
                onChange={(event) => setPump({ ...pump, number: event.target.value })}
                required
              />
            </Field>
            <Field id="setup-pump-name" label="Pump name">
              <input
                id="setup-pump-name"
                value={pump.name}
                onChange={(event) => setPump({ ...pump, name: event.target.value })}
              />
            </Field>
            <div className={styles.formActions}>
              <Button type="submit" loading={busy}>
                Add pump
              </Button>
              <Feedback outcome={outcome} />
            </div>
          </form>
          <form className={styles.form} onSubmit={addNozzle} noValidate>
            <Field id="setup-nozzle-pump" label="Pump" required>
              <Select
                id="setup-nozzle-pump"
                value={nozzle.pumpId}
                onChange={(event) => setNozzle({ ...nozzle, pumpId: event.target.value })}
                options={pumps
                  .filter((item) => item.status === 'ACTIVE')
                  .map((item) => ({ value: item.id, label: `Pump ${item.number}` }))}
                placeholder="Choose a pump"
              />
            </Field>
            <Field id="setup-nozzle-number" label="Nozzle number" required>
              <input
                id="setup-nozzle-number"
                value={nozzle.number}
                onChange={(event) => setNozzle({ ...nozzle, number: event.target.value })}
                required
              />
            </Field>
            <Field id="setup-nozzle-product" label="Fuel product" required>
              <Select
                id="setup-nozzle-product"
                value={nozzle.productId}
                onChange={(event) => setNozzle({ ...nozzle, productId: event.target.value })}
                options={products.map((item) => ({
                  value: item.id,
                  label: `${item.name} (${item.code})`,
                }))}
                placeholder="Choose a product"
              />
            </Field>
            <Field id="setup-meter-serial" label="Current meter serial" required>
              <input
                id="setup-meter-serial"
                value={nozzle.meterSerialNumber}
                onChange={(event) =>
                  setNozzle({ ...nozzle, meterSerialNumber: event.target.value })
                }
                required
              />
            </Field>
            <p className={styles.note}>
              This creates the nozzle, meter and first installation together. It does not invent an
              opening reading.
            </p>
            <div className={styles.formActions}>
              <Button type="submit" loading={busy}>
                Add nozzle and meter
              </Button>
              <Feedback outcome={outcome} />
            </div>
          </form>
        </>
      ) : null}
      <p className={styles.note}>
        The current schema records nozzle product, pump and meter installation, but not a physical
        nozzle-to-tank routing map. Verify that routing independently before live selling; do not
        infer it from matching product names.
      </p>
    </>
  );
}

function ShiftTemplateForm({
  data,
  onDone,
  provider,
}: {
  data: ConfigurationSetupOverview;
  onDone: () => void;
  provider: StepUpProvider;
}) {
  const { run, busy, outcome } = useSetupCommand(data, onDone);
  const [values, setValues] = useState({
    code: '',
    name: '',
    startTime: '',
    durationMinutes: '480',
  });
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [pending, setPending] = useState<Record<string, unknown> | null>(null);
  async function save() {
    if (!pending) return;
    setStepUpOpen(false);
    if (await run('/api/forecourt/commands', pending, `${values.name} was added.`))
      setValues({ code: '', name: '', startTime: '', durationMinutes: '480' });
    setPending(null);
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (
      !values.code.trim() ||
      !values.name.trim() ||
      !values.startTime ||
      !Number(values.durationMinutes)
    )
      return;
    setPending({
      commandType: 'DefineShiftTemplate',
      shiftTemplateId: crypto.randomUUID(),
      expectedVersion: 0,
      code: values.code.trim(),
      name: values.name.trim(),
      startTime: values.startTime,
      durationMinutes: Number(values.durationMinutes),
      active: true,
    });
    setStepUpOpen(true);
  }
  return (
    <>
      {data.shiftTemplates?.length ? (
        <ul className={styles.list}>
          {data.shiftTemplates.map((shift) => (
            <li className={styles.row} key={shift.id}>
              <div className={styles.rowMain}>
                <span className={styles.rowTitle}>{shift.name}</span>
                <span className={styles.rowDetail}>
                  {shift.code} · {shift.startTime ?? 'no fixed start'} · {shift.durationMinutes}{' '}
                  minutes
                </span>
              </div>
              <StatusBadge tone={shift.active ? 'positive' : 'neutral'}>
                {shift.active ? 'Active' : 'Inactive'}
              </StatusBadge>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          title="No shift templates entered"
          message="A shift template is required before the station can open an operational shift."
        />
      )}
      {data.capabilities.shiftTemplates ? (
        <form className={styles.form} onSubmit={submit} noValidate>
          <Field id="setup-shift-code" label="Shift code" required>
            <input
              id="setup-shift-code"
              value={values.code}
              onChange={(event) => setValues({ ...values, code: event.target.value })}
              required
            />
          </Field>
          <Field id="setup-shift-name" label="Shift name" required>
            <input
              id="setup-shift-name"
              value={values.name}
              onChange={(event) => setValues({ ...values, name: event.target.value })}
              required
            />
          </Field>
          <Field id="setup-shift-start" label="Station-local start time" required>
            <input
              id="setup-shift-start"
              type="time"
              value={values.startTime}
              onChange={(event) => setValues({ ...values, startTime: event.target.value })}
              required
            />
          </Field>
          <Field id="setup-shift-duration" label="Duration in minutes" required>
            <input
              id="setup-shift-duration"
              type="number"
              min={1}
              max={1440}
              value={values.durationMinutes}
              onChange={(event) => setValues({ ...values, durationMinutes: event.target.value })}
              required
            />
          </Field>
          <div className={styles.formActions}>
            <Button type="submit" loading={busy}>
              Add shift template
            </Button>
            <Feedback outcome={outcome} />
          </div>
        </form>
      ) : null}
      <StepUpDialog
        open={stepUpOpen}
        tenantId={data.tenantId}
        provider={provider}
        onVerified={() => void save()}
        onCancel={() => {
          setStepUpOpen(false);
          setPending(null);
        }}
      />
    </>
  );
}

function PriceForm({ data, onDone }: { data: ConfigurationSetupOverview; onDone: () => void }) {
  const { run, busy, outcome } = useSetupCommand(data, onDone);
  const products = data.products?.filter((product) => product.status === 'ACTIVE') ?? [];
  const [values, setValues] = useState({
    productId: '',
    unitPrice: '',
    currency: '',
    effectiveFrom: '',
  });
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!values.productId || !values.unitPrice || !values.currency || !values.effectiveFrom) return;
    if (
      await run(
        '/api/setup/commands',
        {
          commandType: 'DraftPriceChange',
          ...values,
          effectiveFrom: stationLocalDateTimeToIso(values.effectiveFrom, data.stationTimezone),
          currency: values.currency.toUpperCase(),
        },
        'The draft price was saved. Continue the existing approval and activation sequence before selling.',
      )
    )
      setValues({ productId: '', unitPrice: '', currency: '', effectiveFrom: '' });
  }
  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      <Field id="setup-price-product" label="Fuel product" required>
        <Select
          id="setup-price-product"
          value={values.productId}
          onChange={(event) => setValues({ ...values, productId: event.target.value })}
          options={products.map((item) => ({
            value: item.id,
            label: `${item.name} (${item.code})`,
          }))}
          placeholder="Choose a product"
        />
      </Field>
      <Field id="setup-price-unit" label="Unit price" required>
        <input
          id="setup-price-unit"
          inputMode="decimal"
          value={values.unitPrice}
          onChange={(event) => setValues({ ...values, unitPrice: event.target.value })}
          required
        />
      </Field>
      <Field id="setup-price-currency" label="Currency" required>
        <input
          id="setup-price-currency"
          maxLength={3}
          value={values.currency}
          onChange={(event) => setValues({ ...values, currency: event.target.value })}
          required
        />
      </Field>
      <Field
        id="setup-price-effective"
        label="Effective from"
        hint="Use the station-local cutover time; activation remains separately authorized."
        required
      >
        <input
          id="setup-price-effective"
          type="datetime-local"
          value={values.effectiveFrom}
          onChange={(event) => setValues({ ...values, effectiveFrom: event.target.value })}
          required
        />
      </Field>
      <div className={styles.formActions}>
        <Button type="submit" loading={busy}>
          Save draft price
        </Button>
        <Feedback outcome={outcome} />
      </div>
    </form>
  );
}

export function ConfigurationPanel({ provider }: { provider: StepUpProvider }) {
  const { state, refresh } = useSetupOverview();
  if (state.kind === 'loading')
    return <p className={styles.note}>Loading station configuration…</p>;
  if (state.kind === 'unavailable')
    return (
      <ErrorState
        title="Configuration unavailable"
        message="You do not have access to station configuration."
      />
    );
  if (state.kind === 'error')
    return (
      <ErrorState
        title="Configuration could not be loaded"
        message="Nothing was changed. Refresh and try again."
      />
    );
  if (!state.overview.data)
    return (
      <ErrorState
        title="Choose a station"
        message="Choose an authorized station in the context selector before entering setup data."
      />
    );
  const { data } = state.overview;
  if (!isValidIanaTimeZone(data.stationTimezone))
    return (
      <ErrorState
        title="Station timezone unavailable"
        message="Configuration dates cannot be entered until the station's authoritative IANA timezone is available. Nothing was changed."
      />
    );
  return (
    <div className={styles.stack}>
      <p className={styles.note}>
        Authorized setup for {stationLabel(data, state.overview)}. These forms call existing named
        commands; they do not create opening readings, financial balances or physical tank-routing
        assumptions.
      </p>
      <Section
        title="Fuel products"
        intro="Products are tenant-scoped; add only fuel that the station actually sells."
      >
        <ProductForm data={data} onDone={refresh} />
      </Section>
      <Section
        title="Tanks"
        intro="Capture physical capacity and variance tolerance. Opening stock is recorded separately in Inventory."
      >
        <TankForm data={data} onDone={refresh} />
      </Section>
      <Section
        title="Pumps, nozzles and meters"
        intro="The nozzle form atomically records the nozzle, meter serial and current installation."
      >
        <ForecourtForms data={data} onDone={refresh} />
      </Section>
      <Section
        title="Shift templates"
        intro={`Starts and durations are recorded as station configuration. The station timezone is ${data.stationTimezone || 'unavailable'}; no browser timezone is used.`}
      >
        <ShiftTemplateForm data={data} onDone={refresh} provider={provider} />
      </Section>
      <Section
        title="Selling prices"
        intro="A draft is not an effective price. Approval, boundary evidence and activation remain required."
      >
        <PriceForm data={data} onDone={refresh} />
      </Section>
    </div>
  );
}
