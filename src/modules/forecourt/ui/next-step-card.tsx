'use client';

import { useCallback, useEffect, useState } from 'react';

import { Button } from '../../../design-system/primitives';
import { nextStep, TRAIL, trailActions, type StepAction, type StepOverview } from './next-step';

function toLocalInput(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

type Props = Readonly<{
  tenantId: string;
  stationId: string;
  /** Called after a command succeeds, so the page around the card can refresh too. */
  onChanged?: () => void;
}>;

/**
 * "Quick actions": one clear thing to do, with a button that does it. It reads the
 * same overview as the Daily Operations page and sends the same named commands.
 */
export function NextStepCard({ tenantId, stationId, onChanged }: Props) {
  const [overview, setOverview] = useState<StepOverview | null>(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [formOpen, setFormOpen] = useState(false);
  const [startAt, setStartAt] = useState(() => toLocalInput(new Date()));
  const [hours, setHours] = useState('8');

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ tenantId, stationId });
      const response = await fetch(`/api/forecourt/operations/overview?${params}`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        // No access, or the overview is unavailable: this card simply stays out of the way.
        setHidden(true);
        return;
      }
      setOverview((await response.json()) as StepOverview);
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

  const step = nextStep(overview, { tenantId, stationId }, () => crypto.randomUUID());
  const { action } = step;
  const trail = trailActions(overview, { tenantId, stationId }, () => crypto.randomUUID());

  async function startNewShift(action: StepAction) {
    if (action.kind !== 'newShift') return;
    const start = new Date(startAt);
    const length = Number(hours);
    if (Number.isNaN(start.getTime()) || !(length > 0 && length <= 24)) {
      setError('Enter a start time and a length between 1 and 24 hours.');
      return;
    }
    await send('StartShift', action.values, 'new-shift', {
      plannedStartAt: start.toISOString(),
      plannedEndAt: new Date(start.getTime() + length * 3_600_000).toISOString(),
    });
  }

  async function run(action: StepAction | null) {
    if (!action || action.kind !== 'command') return;
    if (action.confirm && !window.confirm(action.confirm)) return;
    await send(action.commandType, action.values, action.subjectId);
  }

  async function send(
    commandType: string,
    values: Record<string, unknown>,
    subjectId: string,
    extra: Record<string, unknown> = {},
  ) {
    setBusy(true);
    setError(undefined);
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
        const body = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? 'That did not go through. Refresh and try again.');
      }
      setFormOpen(false);
      await load();
      onChanged?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That did not go through.');
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="next-step"
      aria-labelledby="next-step-title"
      data-done={step.stage === null || undefined}
    >
      <p className="eyebrow">Quick actions</p>
      <h2 id="next-step-title">{step.title}</h2>
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
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
              void startNewShift(action);
            }}
          >
            <label>
              Shift starts
              <input
                type="datetime-local"
                value={startAt}
                onChange={(event) => setStartAt(event.target.value)}
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
          onClick={() => void run(action)}
          loading={busy}
        >
          {action.label}
        </Button>
      ) : null}
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
              ) : item?.kind === 'newShift' ? (
                <button type="button" onClick={() => setFormOpen(true)}>
                  {content}
                </button>
              ) : item?.kind === 'command' ? (
                <button type="button" disabled={busy} onClick={() => void run(item)}>
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
    </section>
  );
}
