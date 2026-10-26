'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

import {
  AccessDeniedState,
  Button,
  ErrorState,
  Field,
  LoadingState,
  StatusBadge,
} from '@/design-system/primitives';
import { friendlySetupError } from '@/modules/setup/guided-setup';
import { StepUpDialog } from '@/modules/setup/ui/step-up-dialog';

import {
  checkCutoverReading,
  checkNewPrice,
  describePriceChange,
  nextPriceChangeStep,
  quickSteps,
  readingsBlocker,
  whoCanHelp,
  type PriceChangeData,
  type PriceChangeProduct,
  type QuickStep,
} from '../price-change-state';
import styles from './price-change.module.css';

type Scope = { tenantId: string; stationId: string };
type Load =
  | { status: 'loading' }
  | { status: 'forbidden' }
  | { status: 'error' }
  | { status: 'ready'; data: PriceChangeData };
type Outcome = { kind: 'success' | 'error'; message: string };
type Gate = (run: () => Promise<void>) => void;

const STEP_UP_REUSE_MS = 5 * 60_000;

const COMMAND_OF: Record<Exclude<QuickStep, 'DRAFT'>, string> = {
  REQUEST: 'RequestPriceChange',
  APPROVE: 'ApprovePriceChange',
  PREPARE: 'PreparePriceActivation',
};

/**
 * Switching a fuel to a new price. The person types the price once; the screen then takes the price
 * through every step they are allowed to do, asks for the pump meter readings, and switches it on.
 */
export function PriceChangeWorkspace({
  tenantId,
  stationId,
  initialData,
}: Scope & { initialData?: PriceChangeData }) {
  const [load, setLoad] = useState<Load>(
    initialData ? { status: 'ready', data: initialData } : { status: 'loading' },
  );
  const [pending, setPending] = useState<(() => Promise<void>) | null>(null);
  const confirmedUntil = useRef(0);

  const fetchData = useCallback(
    async (signal?: AbortSignal): Promise<Load> => {
      try {
        const response = await fetch(
          `/api/forecourt/price-change?${new URLSearchParams({ tenantId, stationId })}`,
          { cache: 'no-store', credentials: 'same-origin', signal },
        );
        if (response.status === 403) return { status: 'forbidden' };
        const body = (await response.json().catch(() => null)) as PriceChangeData | null;
        return response.ok && body ? { status: 'ready', data: body } : { status: 'error' };
      } catch {
        return { status: 'error' };
      }
    },
    [tenantId, stationId],
  );
  const refresh = useCallback(async () => setLoad(await fetchData()), [fetchData]);

  useEffect(() => {
    if (initialData) return;
    const controller = new AbortController();
    void fetchData(controller.signal).then((result) => {
      if (!controller.signal.aborted) setLoad(result);
    });
    return () => controller.abort();
  }, [fetchData, initialData]);

  const gate: Gate = (run) => {
    if (Date.now() < confirmedUntil.current) void run();
    else setPending(() => run);
  };

  if (load.status === 'loading') return <LoadingState label="Loading prices…" />;
  if (load.status === 'forbidden') {
    return <AccessDeniedState message="Your account cannot change prices at this station." />;
  }
  if (load.status === 'error') {
    return (
      <ErrorState
        title="Prices could not be loaded"
        message="Check your connection and try again."
        action={<Button onClick={() => void refresh()}>Try again</Button>}
      />
    );
  }
  const data = load.data;

  return (
    <div className={styles.stack}>
      <p className={styles.intro}>
        Type the new price for a fuel. You will then be asked for the number on each pump meter, and
        the new price starts at that moment. {data.station.name}
      </p>
      {data.products.length === 0 ? (
        <p className={styles.muted}>
          No fuel with a pump is set up at this station yet. Finish the setup guide first.
        </p>
      ) : (
        data.products.map((product) => (
          <ProductCard
            key={product.productId}
            data={data}
            product={product}
            refresh={refresh}
            gate={gate}
            onDenied={() => {
              confirmedUntil.current = 0;
            }}
          />
        ))
      )}
      <StepUpDialog
        open={pending !== null}
        tenantId={tenantId}
        description="Changing a price needs a fresh identity check. Nothing is changed until you confirm."
        onCancel={() => setPending(null)}
        onVerified={() => {
          confirmedUntil.current = Date.now() + STEP_UP_REUSE_MS;
          const run = pending;
          setPending(null);
          if (run) void run();
        }}
      />
    </div>
  );
}

type CardProps = {
  data: PriceChangeData;
  product: PriceChangeProduct;
  refresh: () => Promise<void>;
  gate: Gate;
  onDenied: () => void;
};

function ProductCard({ data, product, refresh, gate, onDenied }: CardProps) {
  const { tenantId } = data;
  const stationId = data.station.id;
  const keys = useRef(new Map<string, string>());
  const attempts = useRef(new Map<string, string>());
  const closed = useRef(new Set<string>());
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>();
  const [priceError, setPriceError] = useState<string>();
  const [readings, setReadings] = useState<Record<string, string>>({});
  const [readingErrors, setReadingErrors] = useState<Record<string, string | undefined>>({});
  const [attendantId, setAttendantId] = useState(data.attendants[0]?.id ?? '');

  const change = product.change;
  const next = change ? nextPriceChangeStep(change, product.nozzles, data.capabilities) : null;

  /** One command. A retry of the same body reuses its key, so it can never be applied twice. */
  async function post(url: string, body: Record<string, unknown>): Promise<unknown> {
    const logical = JSON.stringify(body);
    const key = keys.current.get(logical) ?? `price-change-${crypto.randomUUID()}`;
    keys.current.set(logical, key);
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => null)) as {
      message?: string;
      priceId?: string;
      data?: { priceId?: string };
    } | null;
    if (!response.ok) {
      if (response.status === 403) onDenied();
      throw new Error(friendlySetupError(response.status, payload?.message));
    }
    keys.current.delete(logical);
    return payload;
  }

  /** Runs `work`, then reloads. Any failure is shown in words and nothing further is attempted. */
  async function run(work: () => Promise<string>) {
    setBusy(true);
    setOutcome(undefined);
    try {
      setOutcome({ kind: 'success', message: await work() });
    } catch (error) {
      setOutcome({
        kind: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'That could not be saved. Check your connection and try again.',
      });
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  async function advance(state: string | null, priceId: string | null, unitPrice: string) {
    const plan = quickSteps(state, data.capabilities);
    let id = priceId;
    for (const { step, expectedVersion } of plan.run) {
      if (step === 'DRAFT') {
        const created = (await post('/api/setup/commands', {
          commandType: 'DraftPriceChange',
          tenantId,
          stationId,
          productId: product.productId,
          unitPrice,
          currency: 'USD',
          effectiveFrom: new Date().toISOString(),
        })) as { priceId?: string; data?: { priceId?: string } } | null;
        id = created?.priceId ?? created?.data?.priceId ?? null;
        if (!id)
          throw new Error('The price was saved but could not be found again. Reload the page.');
      } else {
        await post('/api/forecourt/commands', {
          commandType: COMMAND_OF[step],
          tenantId,
          stationId,
          priceId: id,
          expectedVersion,
        });
      }
    }
    return plan.stoppedAt;
  }

  function submitPrice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const checked = checkNewPrice(
      String(new FormData(form).get('price') ?? ''),
      product.currentPrice,
    );
    if (!checked.ok) {
      setPriceError(checked.message);
      return;
    }
    setPriceError(undefined);
    gate(() =>
      run(async () => {
        const stoppedAt = await advance(null, null, checked.value);
        form.reset();
        return stoppedAt
          ? `The new price was saved. ${whoCanHelp(stoppedAt)}`
          : 'The new price is ready. Now enter the pump meter readings.';
      }),
    );
  }

  function continueChange() {
    if (!change) return;
    gate(() =>
      run(async () => {
        const stoppedAt = await advance(change.state, change.priceId, change.unitPrice);
        return stoppedAt ? whoCanHelp(stoppedAt) : 'Done. The next step is below.';
      }),
    );
  }

  function activate() {
    if (!change) return;
    gate(() =>
      run(async () => {
        await post('/api/forecourt/commands', {
          commandType: 'ActivatePriceChange',
          tenantId,
          stationId,
          priceId: change.priceId,
          expectedVersion: change.version,
        });
        return `${product.name} now sells at ${change.unitPrice} per litre.`;
      }),
    );
  }

  function submitReadings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!change || !data.shift) return;
    const shift = data.shift;
    const todo = product.nozzles.filter((nozzle) => !nozzle.done);
    const errors: Record<string, string | undefined> = {};
    const values: Record<string, string> = {};
    for (const nozzle of todo) {
      const checked = checkCutoverReading(readings[nozzle.nozzleId] ?? '', nozzle.lastReading);
      if (checked.ok) values[nozzle.nozzleId] = checked.value;
      else errors[nozzle.nozzleId] = checked.message;
    }
    setReadingErrors(errors);
    if (Object.values(errors).some(Boolean)) return;
    if (!attendantId) return;
    gate(() =>
      run(async () => {
        const base = {
          tenantId,
          stationId,
          businessDayId: shift.businessDayId,
          shiftId: shift.id,
          responsibleAttendantId: attendantId,
          readingStatus: 'AVAILABLE',
        };
        const boundaryId = (kind: string, nozzleId: string) => {
          const slot = `${change.priceId}:${nozzleId}:${kind}`;
          const id = attempts.current.get(slot) ?? crypto.randomUUID();
          attempts.current.set(slot, id);
          return id;
        };
        // Every pump is read for the old price first, then for the new one, so no old-price litres
        // are ever counted after the switch starts.
        for (const nozzle of todo) {
          const slot = `${change.priceId}:${nozzle.nozzleId}:closed`;
          if (closed.current.has(slot)) continue;
          await post('/api/forecourt/commands', {
            ...base,
            commandType: 'ConfirmBoundary',
            boundaryId: boundaryId('close', nozzle.nozzleId),
            nozzleId: nozzle.nozzleId,
            meterInstallationId: nozzle.meterInstallationId,
            reason: 'SHIFT_CLOSE',
            readingValue: values[nozzle.nozzleId],
            expectedVersion: shift.version,
          });
          closed.current.add(slot);
        }
        for (const nozzle of todo) {
          await post('/api/forecourt/commands', {
            ...base,
            commandType: 'ConfirmPriceChangeBoundary',
            boundaryId: boundaryId('change', nozzle.nozzleId),
            nozzleId: nozzle.nozzleId,
            meterInstallationId: nozzle.meterInstallationId,
            reason: 'PRICE_CHANGE',
            readingValue: values[nozzle.nozzleId],
            priceChangeId: change.priceId,
            expectedVersion: change.version,
          });
        }
        if (!data.capabilities.activate) {
          return `Pump readings saved. ${whoCanHelp('activate')}`;
        }
        await post('/api/forecourt/commands', {
          commandType: 'ActivatePriceChange',
          tenantId,
          stationId,
          priceId: change.priceId,
          expectedVersion: change.version,
        });
        return `${product.name} now sells at ${change.unitPrice} per litre.`;
      }),
    );
  }

  const blocker = change ? readingsBlocker(data, product) : null;

  return (
    <section className={`card ${styles.card}`} aria-label={product.name}>
      <div className={styles.cardHead}>
        <h3>{product.name}</h3>
        <p className={styles.muted}>
          {product.currentPrice === null
            ? 'No price in use yet'
            : `In use now: ${product.currentPrice} per litre`}
        </p>
      </div>

      {!change ? (
        <form className={styles.form} onSubmit={submitPrice} noValidate>
          <Field id={`price-${product.productId}`} label="New price per litre" error={priceError}>
            <input
              name="price"
              inputMode="decimal"
              autoComplete="off"
              placeholder="For example 1.65"
            />
          </Field>
          <div className={styles.actions}>
            <Button type="submit" loading={busy} disabled={!data.capabilities.request}>
              Change the price
            </Button>
          </div>
          {!data.capabilities.request ? (
            <p className={styles.muted}>A manager or owner needs to start a price change.</p>
          ) : null}
        </form>
      ) : (
        <div className={styles.form}>
          <p className={styles.actions}>
            <strong>New price: {change.unitPrice} per litre</strong>
            <StatusBadge tone="pending">
              {describePriceChange(
                change.state,
                product.nozzles.length > 0 && product.nozzles.every((nozzle) => nozzle.done),
              )}
            </StatusBadge>
          </p>

          {next && next.step !== 'NONE' && next.blockedBy ? (
            <p className={styles.muted}>{whoCanHelp(next.blockedBy)}</p>
          ) : null}

          {next && ['REQUEST', 'APPROVE', 'PREPARE'].includes(next.step) && !next.blockedBy ? (
            <div className={styles.actions}>
              <Button onClick={continueChange} loading={busy}>
                Continue
              </Button>
            </div>
          ) : null}

          {next?.step === 'READINGS' && !next.blockedBy ? (
            blocker ? (
              <p className={styles.messageError}>{blocker}</p>
            ) : (
              <form className={styles.readings} onSubmit={submitReadings} noValidate>
                <p className={styles.muted}>
                  Read the number shown on each pump meter now. Pumps must not sell while you do
                  this.
                </p>
                {data.attendants.length > 1 ? (
                  <Field id={`who-${product.productId}`} label="Who is reading the meters?">
                    <select
                      value={attendantId}
                      onChange={(event) => setAttendantId(event.target.value)}
                    >
                      {data.attendants.map((attendant) => (
                        <option key={attendant.id} value={attendant.id}>
                          {attendant.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                ) : null}
                {product.nozzles
                  .filter((nozzle) => !nozzle.done)
                  .map((nozzle) => (
                    <Field
                      key={nozzle.nozzleId}
                      id={`reading-${nozzle.nozzleId}`}
                      label={nozzle.label}
                      hint={nozzle.lastReading ? `Last reading: ${nozzle.lastReading}` : undefined}
                      error={readingErrors[nozzle.nozzleId]}
                    >
                      <input
                        inputMode="decimal"
                        autoComplete="off"
                        value={readings[nozzle.nozzleId] ?? ''}
                        onChange={(event) =>
                          setReadings((current) => ({
                            ...current,
                            [nozzle.nozzleId]: event.target.value,
                          }))
                        }
                      />
                    </Field>
                  ))}
                <div className={styles.actions}>
                  <Button type="submit" loading={busy}>
                    Save readings and switch the price
                  </Button>
                </div>
              </form>
            )
          ) : null}

          {next?.step === 'ACTIVATE' && !next.blockedBy ? (
            <div className={styles.actions}>
              <Button onClick={activate} loading={busy}>
                Switch to {change.unitPrice} now
              </Button>
            </div>
          ) : null}
        </div>
      )}

      {outcome ? (
        <p
          className={outcome.kind === 'error' ? styles.messageError : styles.message}
          role={outcome.kind === 'error' ? 'alert' : 'status'}
        >
          {outcome.message}
        </p>
      ) : null}
    </section>
  );
}
