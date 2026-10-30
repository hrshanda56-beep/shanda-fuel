'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useConfirm } from '../../../design-system/feedback-provider';
import { Button } from '../../../design-system/primitives';
import { dailyOperationsProblem } from './daily-operations-state';
import {
  nextStep,
  TRAIL,
  trailActions,
  type PrecedingCommand,
  type StepAction,
  type StepOverview,
} from './next-step';

/** Said after a step succeeds, so the card never changes without telling the person what happened. */
const DONE_MESSAGE: Record<string, string> = {
  OpenBusinessDay: 'Business day opened. Now start the first shift.',
  StartShift: 'Shift started. Now enter the figures.',
  CloseMeters: 'Meters closed.',
  CompleteShift: 'Shift closed.',
  CloseBusinessDay: 'Business day closed.',
};

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
  const confirm = useConfirm();
  const router = useRouter();
  const [overview, setOverview] = useState<StepOverview | null>(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

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
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  if (hidden || !overview) return null;

  const step = nextStep(overview, { tenantId, stationId }, () => crypto.randomUUID());
  const { action } = step;
  const trail = trailActions(overview, { tenantId, stationId }, () => crypto.randomUUID());
  // When closing the shift is refused, the usual fix is on the figures: point the way there.
  const closing =
    action?.kind === 'command' &&
    (action.commandType === 'CompleteShift' || action.commandType === 'CloseMeters');
  const figuresLink = trail[1]?.kind === 'link' ? trail[1] : null;

  async function run(action: StepAction | null) {
    if (!action || action.kind !== 'command') return;
    if (action.confirm) {
      // The first sentence is the question; anything after it says what will happen.
      const [question = action.confirm, ...rest] = action.confirm.split(/(?<=\?)\s+/);
      const agreed = await confirm({
        title: question,
        consequence: rest.join(' ') || 'This cannot be undone from here.',
        confirmLabel: action.label,
        tone: 'warning',
      });
      if (!agreed) return;
    }
    let extra: Record<string, unknown> = {};
    if (action.askReason) {
      const reason = (window.prompt(action.askReason.question) ?? '').trim();
      if (reason.length < 5) {
        setError('Closing now needs a reason of at least 5 characters. The day was not closed.');
        return;
      }
      extra = { [action.askReason.field]: reason };
    }
    await send(action.commandType, action.values, action.subjectId, extra, action.before);
  }

  async function post(
    commandType: string,
    values: Record<string, unknown>,
    subjectId: string,
    extra: Record<string, unknown> = {},
  ) {
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
        message?: string;
        code?: string;
      };
      throw new Error(dailyOperationsProblem(response.status, body.code, body.message).message);
    }
  }

  async function send(
    commandType: string,
    values: Record<string, unknown>,
    subjectId: string,
    extra: Record<string, unknown> = {},
    before?: PrecedingCommand,
  ) {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      // Opening the day comes first; if the shift then fails, the day stays open and the
      // refreshed card offers the shift on its own.
      if (before) await post(before.commandType, before.values, before.subjectId);
      await post(commandType, values, subjectId, extra);
      if (commandType === 'StartShift') {
        // A shift that has just started needs its opening readings, which the page asks for first.
        const params = new URLSearchParams({
          tenantId,
          stationId,
          businessDayId: String(values.businessDayId),
          shiftId: String(values.shiftId),
        });
        router.push(`/operations/daily?${params.toString()}`);
        return;
      }
      setNotice(DONE_MESSAGE[commandType]);
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
      {notice ? (
        <p className="next-step-detail" role="status">
          ✓ {notice}
        </p>
      ) : null}
      {step.detail ? <p className="next-step-detail">{step.detail}</p> : null}
      {error ? (
        <p className="field-error" role="alert">
          {error}
        </p>
      ) : null}
      {error && closing && figuresLink ? (
        <a className="button button-secondary next-step-action" href={figuresLink.href}>
          Go to the shift figures
        </a>
      ) : null}
      {action?.kind === 'link' ? (
        <a className="button button-primary next-step-action" href={action.href}>
          {action.label}
        </a>
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
