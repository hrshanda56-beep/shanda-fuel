'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  Button,
  ErrorState,
  Field,
  NumericInput,
  Skeleton,
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

export function MyShiftWorkspace({ tenantId, stationId }: Scope) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
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
    const controller = new AbortController();
    void fetchShift(controller.signal).then((result) => {
      if (!controller.signal.aborted) setLoad(result);
    });
    return () => controller.abort();
  }, [fetchShift]);

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
  const shiftLine = shift ? `${shift.label ?? 'Shift'} · ${when}` : 'No shift right now';

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

  return (
    <div className="my-shift">
      <header className="my-shift-header">
        <p className="eyebrow">My Shift</p>
        <h1 id="page-title">{data.station.name}</h1>
        <p className="my-shift-when">{shiftLine}</p>
        <p className="my-shift-headline">
          <StatusBadge tone={view.phase === 'running' ? 'positive' : 'neutral'}>
            {view.headline}
          </StatusBadge>
        </p>
      </header>

      <div className="my-shift-live" role="status" aria-live="polite">
        {notice ? <p className="my-shift-notice">{notice}</p> : null}
      </div>

      <section className="my-shift-next" aria-labelledby="next-title">
        <h2 id="next-title">What to do next</h2>
        {view.next.kind === 'record' ? (
          <Button
            variant="primary"
            size="lg"
            block
            onClick={() => openCapture(view.next.kind === 'record' ? view.next.nozzleId : '')}
          >
            Record reading
          </Button>
        ) : null}
        <p className="my-shift-next-text">
          {view.next.kind === 'record' ? view.next.label : view.next.message}
        </p>
      </section>

      {view.meters.length > 0 ? (
        <section aria-labelledby="meters-title" className="my-shift-meters">
          <h2 id="meters-title">Meter readings</h2>
          <ul className="my-shift-list">
            {view.meters.map((meterView) => (
              <MeterCard
                key={meterView.meter.nozzleId}
                view={meterView}
                canCapture={data.canCapture && view.phase === 'running'}
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

  return (
    <li className="my-shift-card">
      <div className="my-shift-card-head">
        <h3>{view.label}</h3>
        <p>{view.meter.productName}</p>
      </div>
      <dl className="my-shift-steps">
        <Step title="Opening reading" step={view.opening} />
        <Step title="Closing reading" step={view.closing} />
      </dl>
      {boundary && canCapture && !open ? (
        <Button variant="secondary" size="lg" block onClick={onOpen}>
          {boundary === 'SHIFT_OPEN' ? 'Record opening reading' : 'Record closing reading'}
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
        <StatusBadge tone={STEP_TONE[step.state]}>
          {step.state === 'done' ? '✓ ' : ''}
          {step.text}
        </StatusBadge>
        {step.value ? <span className="my-shift-value numeric">{step.value}</span> : null}
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
      <Skeleton lines={3} label="Loading your shift" />
      <Skeleton lines={3} label="Loading meters" />
    </div>
  );
}
