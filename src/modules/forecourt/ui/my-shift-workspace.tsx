'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { Icon, type IconName } from '@/design-system/icons';
import {
  Button,
  ErrorState,
  Field,
  NumericInput,
  Skeleton,
  SkeletonBlock,
  StatusBadge,
} from '@/design-system/primitives';
import type { StatusTone } from '@/design-system/primitives';

import {
  checkReading,
  deriveMyShiftView,
  formatShiftWindow,
  type MeterView,
  type MyShiftBoundaryReason,
  type MyShiftData,
  type StepState,
} from '../my-shift-state';
import {
  ATTENTION_LIMIT,
  summariseAttention,
  summariseFigures,
  type AttentionItem,
} from '../my-shift-summary';

type Scope = { tenantId: string; stationId: string };

type Load =
  | { status: 'loading' }
  | { status: 'ready'; data: MyShiftData }
  | { status: 'forbidden' }
  | { status: 'error'; message: string };

const STEP_TONE: Record<StepState, StatusTone> = {
  done: 'positive',
  due: 'warning',
  not_due: 'neutral',
  waiting: 'neutral',
  blocked: 'critical',
  needs_supervisor: 'critical',
};

/** Plain-language messages; server detail is only shown when it is safe to read. */
export function mapCaptureError(status: number, code?: string, message?: string): string {
  if (status === 401) return 'Your session has ended. Please sign in again.';
  if (status === 403) return 'You are not allowed to record this reading. Tell your supervisor.';
  if (status === 429) return 'Too many attempts. Wait a moment and try again.';
  if (status === 409) {
    return message && code === 'CONFLICT'
      ? `${message}. Refresh the page and check the meter.`
      : 'This shift has changed. Refresh the page and try again.';
  }
  if (status === 400 || status === 422) {
    return message ?? 'That reading could not be saved. Check the number and try again.';
  }
  return 'The reading could not be saved. Nothing was recorded. Try again.';
}

type Attempt = { value: string; boundaryId: string; key: string };

export function MyShiftWorkspace({
  tenantId,
  stationId,
  initialData,
}: Scope & { initialData?: MyShiftData }) {
  const [load, setLoad] = useState<Load>(
    initialData ? { status: 'ready', data: initialData } : { status: 'loading' },
  );
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [notice, setNotice] = useState<string>();
  const attempts = useRef(new Map<string, Attempt>());

  const fetchShift = useCallback(
    async (signal?: AbortSignal): Promise<Load> => {
      const failure: Load = {
        status: 'error',
        message: 'Your shift could not be loaded. Check your connection and try again.',
      };
      try {
        const response = await fetch(
          `/api/forecourt/my-shift?${new URLSearchParams({ tenantId, stationId })}`,
          { cache: 'no-store', signal },
        );
        if (response.status === 403) return { status: 'forbidden' };
        const body = (await response.json().catch(() => null)) as MyShiftData | null;
        if (!response.ok || !body) return failure;
        return { status: 'ready', data: body };
      } catch {
        return failure;
      }
    },
    [tenantId, stationId],
  );

  /** Reload after a save or a retry. */
  const refresh = useCallback(async () => {
    setLoad(await fetchShift());
  }, [fetchShift]);

  useEffect(() => {
    if (initialData) return;
    const controller = new AbortController();
    void fetchShift(controller.signal).then((result) => {
      if (!controller.signal.aborted) setLoad(result);
    });
    return () => controller.abort();
  }, [fetchShift, initialData]);

  if (load.status === 'loading') return <MyShiftSkeleton />;
  if (load.status === 'forbidden') {
    return (
      <ErrorState
        title="You cannot open this page"
        message="Your account does not have access to this station's shift."
      />
    );
  }
  if (load.status === 'error') {
    return (
      <ErrorState
        title="Could not load your shift"
        message={load.message}
        action={
          <Button variant="primary" size="lg" onClick={() => void refresh()}>
            Try again
          </Button>
        }
      />
    );
  }

  const data = load.data;
  const view = deriveMyShiftView(data);
  const shift = data.shift;
  const tz = data.station.timezone;
  const when = shift ? formatShiftWindow(shift.plannedStartAt, shift.plannedEndAt, tz) : null;

  function openCapture(nozzleId: string) {
    setNotice(undefined);
    setOpenFor(nozzleId);
  }

  async function submit(
    meterView: MeterView,
    boundary: MyShiftBoundaryReason,
    value: string,
    note: string,
  ): Promise<string | null> {
    if (!shift || !meterView.meter.meterInstallationId)
      return 'No meter is set up for this nozzle.';
    const mapKey = `${shift.id}:${meterView.meter.nozzleId}:${boundary}`;
    let attempt = attempts.current.get(mapKey);
    // A retry of the same reading reuses its ids so it can never record twice;
    // a changed reading is a new attempt.
    if (!attempt || attempt.value !== value) {
      attempt = {
        value,
        boundaryId: crypto.randomUUID(),
        key: `ui-my-shift-${crypto.randomUUID()}`,
      };
      attempts.current.set(mapKey, attempt);
    }
    try {
      const response = await fetch('/api/forecourt/commands', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': attempt.key },
        body: JSON.stringify({
          commandType: 'ConfirmBoundary',
          tenantId: data.tenantId,
          stationId: data.station.id,
          boundaryId: attempt.boundaryId,
          nozzleId: meterView.meter.nozzleId,
          meterInstallationId: meterView.meter.meterInstallationId,
          businessDayId: shift.businessDayId,
          shiftId: shift.id,
          responsibleAttendantId: data.responsibleAttendantId,
          reason: boundary,
          readingStatus: 'AVAILABLE',
          readingValue: value,
          ...(note ? { exceptionReason: note } : {}),
          expectedVersion: shift.version,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
        };
        return mapCaptureError(response.status, body.error, body.message);
      }
      attempts.current.delete(mapKey);
      setOpenFor(null);
      setNotice(
        `${boundary === 'SHIFT_OPEN' ? 'Opening' : 'Closing'} reading saved for ${meterView.label}.`,
      );
      await refresh();
      return null;
    } catch {
      return 'No connection. Nothing was recorded. Check your signal and try again.';
    }
  }

  const figures = summariseFigures(view);
  const attention = summariseAttention(data, view);
  const next = view.next;
  const nextMeter =
    next.kind === 'record'
      ? view.meters.find((meterView) => meterView.meter.nozzleId === next.nozzleId)
      : undefined;
  const canCapture = data.canCapture && view.phase === 'running';

  return (
    <div className="my-shift">
      <header className="my-shift-header">
        {/* The shell's own heading owns #page-title; ids must be unique. */}
        <h1>{data.station.name}</h1>
        <p className="my-shift-meta">
          {shift ? <span className="my-shift-when numeric">{when}</span> : null}
          <StatusBadge tone={view.phase === 'running' ? 'positive' : 'neutral'}>
            {view.headline}
          </StatusBadge>
          {shift?.label ? <span className="my-shift-label">{shift.label}</span> : null}
        </p>
      </header>

      <div className="my-shift-live" role="status" aria-live="polite">
        {notice ? <p className="my-shift-notice">{notice}</p> : null}
      </div>

      {view.meters.length > 0 ? (
        <dl className="my-shift-figures" aria-label="Shift progress">
          <Figure
            label="Completed"
            value={figures.completed}
            caption={`of ${figures.total}`}
            icon="check-circle"
            tone="done"
          />
          <Figure label="Pending" value={figures.pending} icon="clock" tone="pending" />
          <Figure
            label="Due now"
            value={figures.due}
            icon="alert"
            tone="due"
            active={figures.due > 0}
          />
        </dl>
      ) : null}

      <div className="my-shift-side">
        <section className="my-shift-panel my-shift-next" aria-labelledby="next-title">
          <h2 id="next-title" className="my-shift-section-title">
            What to do next
          </h2>
          <div className="my-shift-next-main">
            <span className="my-shift-ring" aria-hidden="true">
              <Icon name={next.kind === 'record' ? 'fuel' : 'check-circle'} />
            </span>
            {next.kind === 'record' ? (
              <p className="my-shift-next-text">
                <strong>{nextMeter?.label ?? next.label}</strong>
                <span>
                  {nextMeter ? `${nextMeter.meter.productName} · ` : ''}
                  {next.boundary === 'SHIFT_OPEN' ? 'Opening' : 'Closing'} reading
                </span>
              </p>
            ) : (
              <p className="my-shift-next-text">
                <span>{next.message}</span>
              </p>
            )}
          </div>
          {next.kind === 'record' ? (
            <Button
              variant="primary"
              size="lg"
              block
              aria-label={`Record reading for ${nextMeter?.label ?? 'the next nozzle'}`}
              onClick={() => openCapture(next.nozzleId)}
            >
              Record reading
            </Button>
          ) : null}
        </section>

        <section
          className="my-shift-panel"
          aria-labelledby="attention-title"
          data-empty={attention.length === 0 || undefined}
        >
          <h2 id="attention-title" className="my-shift-section-title">
            Needs attention
          </h2>
          {attention.length > 0 ? (
            <ul className="my-shift-attention">
              {attention.slice(0, ATTENTION_LIMIT).map((item) => (
                <li key={item.id}>
                  <AttentionRow item={item} onOpen={openCapture} />
                </li>
              ))}
              {attention.length > ATTENTION_LIMIT ? (
                <li className="my-shift-attention-more">
                  and {attention.length - ATTENTION_LIMIT} more
                </li>
              ) : null}
            </ul>
          ) : (
            <>
              <Icon name="check-circle" />
              <p className="my-shift-quiet">Nothing needs attention.</p>
            </>
          )}
        </section>
      </div>

      {view.meters.length > 0 ? (
        <section aria-labelledby="meters-title" className="my-shift-meters">
          <h2 id="meters-title" className="my-shift-section-title">
            Meter readings
          </h2>
          <div className="my-shift-columns" aria-hidden="true">
            <span>Pump / Nozzle</span>
            <span>Fuel</span>
            <span>Opening</span>
            <span>Closing</span>
            <span />
          </div>
          <ul className="my-shift-list">
            {view.meters.map((meterView) => (
              <MeterCard
                key={meterView.meter.nozzleId}
                view={meterView}
                canCapture={canCapture}
                open={openFor === meterView.meter.nozzleId}
                onOpen={() => openCapture(meterView.meter.nozzleId)}
                onCancel={() => setOpenFor(null)}
                onSubmit={(boundary, value, note) => submit(meterView, boundary, value, note)}
              />
            ))}
          </ul>
        </section>
      ) : shift ? (
        <p className="my-shift-empty">
          No meters are set up for this station yet. Tell your supervisor.
        </p>
      ) : null}
    </div>
  );
}

type FigureTone = 'done' | 'pending' | 'due';

/** A dashboard-style key figure: icon, short label, one strong number. */
function Figure({
  label,
  value,
  caption,
  icon,
  tone,
  active = true,
}: {
  label: string;
  value: number;
  caption?: string;
  icon: IconName;
  tone: FigureTone;
  active?: boolean;
}) {
  return (
    <div className="my-shift-figure" data-tone={tone} data-active={active || undefined}>
      <span className="my-shift-figure-icon" aria-hidden="true">
        <Icon name={icon} />
      </span>
      <dt>{label}</dt>
      <dd>
        <span className="my-shift-figure-value numeric">{value}</span>
        {caption ? <span className="my-shift-figure-caption">{caption}</span> : null}
      </dd>
    </div>
  );
}

function AttentionRow({
  item,
  onOpen,
}: {
  item: AttentionItem;
  onOpen: (nozzleId: string) => void;
}) {
  const nozzleId = item.nozzleId;
  const text = (
    <>
      <Icon name="alert" className="my-shift-attention-icon" />
      <span className="my-shift-attention-text">
        <span className="my-shift-attention-title">{item.title}</span>
        <span className="my-shift-attention-detail">{item.detail}</span>
      </span>
    </>
  );
  // Whole row is the target when the attendant can act on it from here.
  return nozzleId ? (
    <button type="button" className="my-shift-attention-row" onClick={() => onOpen(nozzleId)}>
      {text}
      <Icon name="chevron-right" className="my-shift-attention-chevron" />
    </button>
  ) : (
    <div className="my-shift-attention-row">{text}</div>
  );
}

function MeterCard({
  view,
  canCapture,
  open,
  onOpen,
  onCancel,
  onSubmit,
}: {
  view: MeterView;
  canCapture: boolean;
  open: boolean;
  onOpen: () => void;
  onCancel: () => void;
  onSubmit: (
    boundary: MyShiftBoundaryReason,
    value: string,
    note: string,
  ) => Promise<string | null>;
}) {
  const boundary: MyShiftBoundaryReason | null =
    view.opening.state === 'due'
      ? 'SHIFT_OPEN'
      : view.closing.state === 'due'
        ? 'SHIFT_CLOSE'
        : null;
  const id = `meter-${view.meter.nozzleId}`;
  const steps = [view.opening, view.closing];
  // Completed meters recede; due ones stand out; problems are marked.
  const tone = steps.some((step) => step.state === 'blocked' || step.state === 'needs_supervisor')
    ? 'issue'
    : boundary
      ? 'due'
      : steps.every((step) => step.state === 'done')
        ? 'done'
        : 'idle';

  return (
    <li className="my-shift-card" data-tone={tone}>
      <div className="my-shift-card-head">
        <h3>{view.label}</h3>
        <p>{view.meter.productName}</p>
      </div>
      <dl className="my-shift-steps">
        <Step title="Opening reading" step={view.opening} />
        <Step title="Closing reading" step={view.closing} />
      </dl>
      {boundary && canCapture && !open ? (
        <Button
          variant="secondary"
          size="sm"
          className="my-shift-record"
          aria-label={`Record ${boundary === 'SHIFT_OPEN' ? 'opening' : 'closing'} reading for ${view.label}`}
          onClick={onOpen}
        >
          Record →
        </Button>
      ) : null}
      {boundary && canCapture && open ? (
        <CaptureForm
          id={id}
          view={view}
          boundary={boundary}
          onCancel={onCancel}
          onSubmit={onSubmit}
        />
      ) : null}
    </li>
  );
}

function Step({ title, step }: { title: string; step: MeterView['opening'] }) {
  return (
    <div className="my-shift-step">
      <dt>{title}</dt>
      <dd>
        {step.value ? <span className="my-shift-value numeric">{step.value}</span> : null}
        <StatusBadge tone={STEP_TONE[step.state]}>
          {step.state === 'done' ? '✓ ' : ''}
          {step.text}
        </StatusBadge>
      </dd>
    </div>
  );
}

function CaptureForm({
  id,
  view,
  boundary,
  onCancel,
  onSubmit,
}: {
  id: string;
  view: MeterView;
  boundary: MyShiftBoundaryReason;
  onCancel: () => void;
  onSubmit: (
    boundary: MyShiftBoundaryReason,
    value: string,
    note: string,
  ) => Promise<string | null>;
}) {
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string>();
  const [noteError, setNoteError] = useState<string>();
  const [pending, setPending] = useState(false);
  const previous = view.meter.previousReading;
  // A brand-new meter has nothing to inherit; the server requires a stated reason.
  const needsNote = boundary === 'SHIFT_OPEN' && previous === null;
  const isOpening = boundary === 'SHIFT_OPEN';

  useEffect(() => {
    document.getElementById(`${id}-reading`)?.focus();
  }, [id]);

  async function handle(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    const checked = checkReading(value, {
      boundary,
      openingValue: view.opening.value,
      previousReading: previous,
    });
    setError(checked.ok ? undefined : checked.message);
    const trimmed = note.trim();
    setNoteError(needsNote && !trimmed ? 'Say why there is no earlier reading.' : undefined);
    if (!checked.ok || (needsNote && !trimmed)) return;
    setPending(true);
    const failure = await onSubmit(boundary, checked.value, needsNote ? trimmed : '');
    setPending(false);
    if (failure) setError(failure);
  }

  return (
    <form
      className="my-shift-form"
      onSubmit={handle}
      noValidate
      aria-label={`${isOpening ? 'Opening' : 'Closing'} reading for ${view.label}`}
    >
      <NumericInput
        id={`${id}-reading`}
        label={isOpening ? 'Opening reading' : 'Closing reading'}
        hint={
          isOpening
            ? previous
              ? `Read the meter. It should match the last closing reading: ${previous}.`
              : 'Read the number on the meter and type it here.'
            : `Read the number on the meter. Opening reading was ${view.opening.value ?? 'not recorded'}.`
        }
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          setError(undefined);
        }}
        error={error}
        unit="L"
        autoComplete="off"
        required
        disabled={pending}
      />
      {needsNote ? (
        <Field
          id={`${id}-note`}
          label="Why is there no earlier reading?"
          error={noteError}
          required
        >
          <input
            id={`${id}-note`}
            className="my-shift-note"
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
              setNoteError(undefined);
            }}
            placeholder="For example: new meter, first reading"
            disabled={pending}
          />
        </Field>
      ) : null}
      <div className="my-shift-form-actions">
        <Button type="submit" variant="primary" size="lg" block loading={pending}>
          {pending ? 'Saving…' : isOpening ? 'Save opening reading' : 'Save closing reading'}
        </Button>
        <Button type="button" variant="quiet" size="lg" block onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
      </div>
      <p className="my-shift-form-help">
        Cannot read the meter? Do not guess. Tell your supervisor.
      </p>
    </form>
  );
}

function MyShiftSkeleton() {
  return (
    <div className="my-shift" aria-busy="true">
      <Skeleton lines={2} label="Loading your shift" />
      <div className="my-shift-figures" aria-hidden="true">
        {[0, 1, 2].map((index) => (
          <SkeletonBlock key={index} height="6rem" />
        ))}
      </div>
      <Skeleton lines={3} label="Loading meters" />
    </div>
  );
}
