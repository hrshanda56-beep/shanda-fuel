'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { ConfirmDialog } from '../../../design-system/confirm-dialog';
import { InlineError } from '../../../design-system/inline-error';
import { Button } from '../../../design-system/primitives';
import { useToast } from '../../../design-system/toast';
import { describeFailure, type UserMessage, userMessage } from '../../../design-system/user-messages';
import { CloseMetersSheet } from './close-meters-sheet';
import {
  nextStep,
  TRAIL,
  trailActions,
  type StationSetup,
  type StepAction,
  type StepOverview,
} from './next-step';
import { shiftLabel, shiftNameFor, type ShiftName } from './shift-labels';

function toLocalInput(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

type ShiftChoice = ShiftName | 'Custom';
const SHIFT_PRESETS: Record<ShiftName, { hour: number; length: number }> = {
  Morning: { hour: 6, length: 8 },
  Afternoon: { hour: 14, length: 8 },
  Night: { hour: 22, length: 8 },
};

type Props = Readonly<{
  tenantId: string;
  stationId: string;
  /** Called after a command succeeds, so the page around the card can refresh too. */
  onChanged?: () => void;
}>;

type Pending = Readonly<{
  action: Extract<StepAction, { kind: 'command' }>;
}>;

/**
 * "Quick actions": one clear thing to do, with a button that does it. It reads the same overview as the
 * Daily Operations page and sends the same named commands. Each action that cannot be quietly undone
 * asks first; a failure is shown next to the button; a success is a short toast.
 */
export function NextStepCard({ tenantId, stationId, onChanged }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [overview, setOverview] = useState<StepOverview | null>(null);
  const [setup, setSetup] = useState<StationSetup>(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<UserMessage | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [startAt, setStartAt] = useState(() => toLocalInput(new Date()));
  const [hours, setHours] = useState('8');
  const [shiftChoice, setShiftChoice] = useState<ShiftChoice | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [pendingShift, setPendingShift] = useState<{
    action: Extract<StepAction, { kind: 'newShift' }>;
    start: Date;
    end: Date;
  } | null>(null);
  const [metersFor, setMetersFor] = useState<Extract<StepAction, { kind: 'closeMeters' }> | null>(
    null,
  );
  const [retry, setRetry] = useState<(() => void) | null>(null);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ tenantId, stationId });
      const [response, setupResponse] = await Promise.all([
        fetch(`/api/forecourt/operations/overview?${params}`, { cache: 'no-store' }),
        fetch(`/api/setup/overview?${params}`, { cache: 'no-store' }).catch(() => null),
      ]);
      if (!response.ok) {
        // No access, or the overview is unavailable: this card simply stays out of the way.
        setHidden(true);
        return;
      }
      setOverview((await response.json()) as StepOverview);
      setSetup(await readSetup(setupResponse, stationId));
      setHidden(false);
    } catch {
      setHidden(true);
    }
  }, [tenantId, stationId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  if (hidden || !overview) return null;

  const timezone = overview.station.timezone;
  const step = nextStep(overview, { tenantId, stationId }, () => crypto.randomUUID(), setup);
  const { action } = step;
  const trail = trailActions(overview, { tenantId, stationId }, () => crypto.randomUUID(), setup);

  /** Runs one named command, then refreshes this card, the page around it and the dashboard. */
  async function send(
    commandType: string,
    values: Record<string, unknown>,
    subjectId: string,
    success: string,
    extra: Record<string, unknown> = {},
  ): Promise<boolean> {
    setBusy(true);
    setError(null);
    setRetry(null);
    try {
      const response = await fetch('/api/forecourt/commands', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': `next-step-${commandType}-${subjectId}-${crypto.randomUUID()}`,
        },
        body: JSON.stringify({ commandType, ...values, ...extra }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
          message?: string;
        };
        throw describeFailure(response.status, body.error, body.message);
      }
      setFormOpen(false);
      toast.show(success);
      await load();
      onChanged?.();
      router.refresh();
      return true;
    } catch (caught) {
      const message = isUserMessage(caught) ? caught : userMessage('UNKNOWN');
      setError(message);
      await load();
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function confirmCommand() {
    if (!pending) return;
    const { action: current } = pending;
    const ok = await send(current.commandType, current.values, current.subjectId, current.success);
    // On success the dialog closes; on failure it closes too, so the error sits by the button.
    setPending(null);
    if (!ok) setRetry(() => () => setPending({ action: current }));
  }

  function askStartShift(action: Extract<StepAction, { kind: 'newShift' }>) {
    const start = new Date(startAt);
    const length = Number(hours);
    if (Number.isNaN(start.getTime()) || !(length > 0 && length <= 24)) {
      setError({
        code: 'UNKNOWN',
        title: 'Check the shift times',
        body: 'Enter a start time and a length between 1 and 24 hours.',
      });
      return;
    }
    setError(null);
    setPendingShift({ action, start, end: new Date(start.getTime() + length * 3_600_000) });
  }

  async function confirmStartShift() {
    if (!pendingShift) return;
    const { action: current, start, end } = pendingShift;
    const ok = await send('StartShift', current.values, 'new-shift', 'Shift started', {
      plannedStartAt: start.toISOString(),
      plannedEndAt: end.toISOString(),
    });
    setPendingShift(null);
    if (!ok) setRetry(() => () => setPendingShift({ action: current, start, end }));
  }

  function chooseShift(choice: ShiftChoice) {
    setShiftChoice(choice);
    if (choice === 'Custom') return;
    const preset = SHIFT_PRESETS[choice];
    const start = new Date();
    start.setHours(preset.hour, 0, 0, 0);
    setStartAt(toLocalInput(start));
    setHours(String(preset.length));
  }

  const startDate = new Date(startAt);
  const defaultChoice: ShiftChoice = Number.isNaN(startDate.getTime())
    ? 'Custom'
    : shiftNameFor(startDate.toISOString(), timezone);
  const activeChoice = shiftChoice ?? defaultChoice;

  function press(item: StepAction | null) {
    if (!item) return;
    if (item.kind === 'command') setPending({ action: item });
    else if (item.kind === 'newShift') setFormOpen(true);
    else if (item.kind === 'closeMeters') setMetersFor(item);
  }

  return (
    <section
      className="next-step"
      aria-labelledby="next-step-title"
      data-done={step.stage === null || undefined}
    >
      <p className="eyebrow">Quick actions</p>
      <h2 id="next-step-title">{step.title}</h2>
      {action?.kind === 'link' ? (
        <a className="button button-primary next-step-action" href={action.href}>
          {action.label}
        </a>
      ) : null}
      {action?.kind === 'newShift' ? (
        formOpen ? (
          <form
            className="next-step-form"
            onSubmit={(event) => {
              event.preventDefault();
              askStartShift(action);
            }}
          >
            <label>
              Shift
              <select
                value={activeChoice}
                onChange={(event) => chooseShift(event.target.value as ShiftChoice)}
              >
                <option value="Morning">Morning</option>
                <option value="Afternoon">Afternoon</option>
                <option value="Night">Night</option>
                <option value="Custom">Custom</option>
              </select>
            </label>
            <label>
              Shift starts
              <input
                type="datetime-local"
                value={startAt}
                onChange={(event) => {
                  setStartAt(event.target.value);
                  setShiftChoice(null);
                }}
                required
              />
            </label>
            <label>
              Length (hours)
              <input
                type="number"
                min="1"
                max="24"
                step="0.5"
                inputMode="decimal"
                value={hours}
                onChange={(event) => setHours(event.target.value)}
                required
              />
            </label>
            <Button type="submit" variant="primary" loading={busy}>
              Start shift
            </Button>
          </form>
        ) : (
          <Button variant="primary" className="next-step-action" onClick={() => setFormOpen(true)}>
            {action.label}
          </Button>
        )
      ) : null}
      {action?.kind === 'command' ? (
        <Button
          variant="primary"
          className="next-step-action"
          onClick={() => press(action)}
          loading={busy}
        >
          {action.label}
        </Button>
      ) : null}
      {action?.kind === 'closeMeters' ? (
        <Button variant="primary" className="next-step-action" onClick={() => press(action)}>
          {action.label}
        </Button>
      ) : null}
      {action?.kind === 'blocked' ? (
        <>
          <Button variant="primary" className="next-step-action" disabled aria-describedby="next-step-reason">
            {action.label}
          </Button>
          <p className="action-reason" id="next-step-reason">
            {action.reason}
          </p>
        </>
      ) : null}
      <InlineError error={error} onRetry={retry ?? undefined} />
      <ol className="next-step-trail" aria-label="Quick actions for the day">
        {TRAIL.map((label, index) => {
          const state =
            step.stage === null || index < step.stage
              ? 'done'
              : index === step.stage
                ? 'current'
                : undefined;
          const item = trail[index] ?? null;
          const content = (
            <>
              <span aria-hidden="true">{state === 'done' ? '✓' : index + 1}</span>
              {label}
            </>
          );
          return (
            <li key={label} data-state={state}>
              {item?.kind === 'link' ? (
                <a href={item.href}>{content}</a>
              ) : item && item.kind !== 'blocked' ? (
                <button type="button" disabled={busy} onClick={() => press(item)}>
                  {content}
                </button>
              ) : (
                <span className="next-step-chip" aria-disabled="true">
                  {content}
                </span>
              )}
            </li>
          );
        })}
      </ol>

      <ConfirmDialog
        open={pending !== null}
        title={pending?.action.confirm.title ?? ''}
        lines={pending?.action.confirm.lines}
        confirmLabel={pending?.action.confirm.confirmLabel ?? 'Confirm'}
        busy={busy}
        onConfirm={() => void confirmCommand()}
        onClose={() => setPending(null)}
      />
      <ConfirmDialog
        open={pendingShift !== null}
        title="Start shift?"
        lines={
          pendingShift
            ? [
                {
                  label: 'Shift',
                  value: shiftLabel(
                    pendingShift.start.toISOString(),
                    pendingShift.end.toISOString(),
                    timezone,
                  ),
                },
              ]
            : []
        }
        confirmLabel="Start shift"
        busy={busy}
        onConfirm={() => void confirmStartShift()}
        onClose={() => setPendingShift(null)}
      />
      {metersFor ? (
        <CloseMetersSheet
          open
          tenantId={tenantId}
          stationId={stationId}
          businessDayId={metersFor.businessDayId}
          shiftId={metersFor.shiftId}
          shiftVersion={metersFor.version}
          plannedStartAt={metersFor.plannedStartAt}
          plannedEndAt={metersFor.plannedEndAt}
          timezone={timezone}
          onClose={() => setMetersFor(null)}
          onClosed={() => {
            setMetersFor(null);
            toast.show('Shift closed');
            void load();
            onChanged?.();
            router.refresh();
          }}
        />
      ) : null}
    </section>
  );
}

function isUserMessage(value: unknown): value is UserMessage {
  return typeof value === 'object' && value !== null && 'title' in value && 'code' in value;
}

type SetupResponse = {
  status?: string;
  canViewReadiness?: boolean;
  stations?: ReadonlyArray<{
    stationId: string;
    areas: ReadonlyArray<{ code: string; status: string }>;
  }>;
};

async function readSetup(response: Response | null, stationId: string): Promise<StationSetup> {
  if (!response?.ok) return null;
  const body = (await response.json().catch(() => null)) as SetupResponse | null;
  if (!body || body.status !== 'ready' || body.canViewReadiness === false) return null;
  const station = body.stations?.find((item) => item.stationId === stationId);
  if (!station) return null;
  const area = (code: string) => station.areas.find((item) => item.code === code)?.status;
  return {
    hasPumps: area('PUMPS') !== undefined && area('PUMPS') !== 'NOT_ENTERED',
    hasAttendants: area('STAFF') === 'READY',
  };
}
