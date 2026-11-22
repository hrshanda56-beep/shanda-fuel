'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/design-system/primitives';
import { formatBusinessDate } from '@/design-system/formatters';
import { stationLocalToInstant } from '@/platform/domain/business-time';
import {
  WizardActions,
  WizardCard,
  WizardChoice,
  WizardChoices,
  WizardNotice,
  WizardStep,
  WizardSummary,
  WizardSummaryRow,
  useWizard,
} from '@/design-system/wizard';

import type { PastDaysData } from '../past-days';
import { lockClosedDays, useLockVerification } from './lock-days';

type Step = 'pick' | 'shift' | 'check';
const NEWEST_SHOWN = 7;

/** "Record a past day": pick a missing day, check it, then carry on in Daily Operations for that day. */
export function PastDaysWorkspace({
  tenantId,
  stationId,
  data,
}: {
  tenantId: string;
  stationId: string;
  data: PastDaysData;
}) {
  const router = useRouter();
  const [date, setDate] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const daily = (extra: Record<string, string> = {}) =>
    `/operations/daily?${new URLSearchParams({ tenantId, stationId, ...extra })}`;
  const [templateId, setTemplateId] = useState<string | null>(null);
  const templates = data.shiftTemplates;
  // With one shift there is nothing to ask; with several, the person says which one they recorded.
  const sequence: readonly Step[] =
    templates.length > 1 ? ['pick', 'shift', 'check'] : ['pick', 'check'];
  const chosenTemplate =
    templates.find((template) => template.id === templateId) ??
    (templates.length === 1 ? templates[0] : undefined);
  const wizard = useWizard<Step>({
    start: 'pick',
    sequence,
    onCancel: () => router.push(daily()),
  });

  const newestFirst = [...data.missing].reverse();
  const shown = showAll ? newestFirst : newestFirst.slice(0, NEWEST_SHOWN);

  async function record() {
    if (!date) return;
    setBusy(true);
    setProblem(null);
    const businessDayId = crypto.randomUUID();
    try {
      const response = await fetch('/api/forecourt/commands', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': `past-day-${businessDayId}`,
        },
        body: JSON.stringify({
          commandType: 'OpenPastBusinessDay',
          tenantId,
          stationId,
          businessDayId,
          businessDate: date,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { message?: string };
        setProblem(body.message ?? 'The day could not be started. Nothing was saved. Try again.');
        return;
      }
      // Straight on to the shift: start it for that day, then the shift screens ask who was on duty.
      const plannedStartAt =
        chosenTemplate?.startTime
          ? stationLocalToInstant(
              `${date}T${chosenTemplate.startTime.slice(0, 5)}`,
              data.timezone,
            )?.toISOString()
          : undefined;
      if (!chosenTemplate || !plannedStartAt) {
        // No shift can be started for them; the day is recorded, so carry on from its page.
        router.push(daily({ businessDayId }));
        return;
      }
      const shiftId = crypto.randomUUID();
      const started = await fetch('/api/forecourt/commands', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': `past-day-shift-${shiftId}`,
        },
        body: JSON.stringify({
          commandType: 'StartShift',
          tenantId,
          stationId,
          businessDayId,
          shiftId,
          expectedVersion: 0,
          plannedStartAt,
          shiftTemplateId: chosenTemplate.id,
        }),
      });
      if (!started.ok) {
        router.push(daily({ businessDayId }));
        return;
      }
      router.push(daily({ businessDayId, shiftId }));
    } catch {
      setProblem('The day could not be started. Check the connection, then try again.');
    } finally {
      setBusy(false);
    }
  }

  const verifyIdentity = useLockVerification();
  const [locking, setLocking] = useState(false);
  const [lockNote, setLockNote] = useState<string | null>(null);
  const closedDays = data.recorded.filter((day) => day.state === 'CLOSED');

  async function lockAll() {
    setLocking(true);
    setLockNote(null);
    try {
      await verifyIdentity(tenantId);
      const outcomes = await lockClosedDays({ tenantId, stationId }, closedDays);
      const locked = outcomes.filter((outcome) => outcome.locked).length;
      const skipped = outcomes.filter((outcome) => !outcome.locked);
      setLockNote(
        skipped.length === 0
          ? `Locked ${locked} ${locked === 1 ? 'day' : 'days'}.`
          : `Locked ${locked} of ${outcomes.length}. ${skipped.length} could not be locked: ${
              skipped[0]?.message ?? 'open that day to see why.'
            }`,
      );
      router.refresh();
    } catch (caught) {
      setLockNote(
        caught instanceof Error
          ? caught.message
          : 'The days could not be locked. Nothing was changed.',
      );
    } finally {
      setLocking(false);
    }
  }

  const [goLive, setGoLive] = useState(data.goLiveDate ?? '');
  const [goLiveBusy, setGoLiveBusy] = useState(false);
  const [goLiveNote, setGoLiveNote] = useState<string | null>(null);

  async function saveGoLive() {
    setGoLiveBusy(true);
    setGoLiveNote(null);
    try {
      const response = await fetch('/api/forecourt/commands', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': `go-live-${crypto.randomUUID()}`,
        },
        body: JSON.stringify({
          commandType: 'SetStationGoLiveDate',
          tenantId,
          stationId,
          goLiveDate: goLive || null,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { message?: string };
        setGoLiveNote(body.message ?? 'The start date could not be saved. Try again.');
        return;
      }
      setGoLiveNote('Saved.');
      router.refresh();
    } catch {
      setGoLiveNote('The start date could not be saved. Check the connection, then try again.');
    } finally {
      setGoLiveBusy(false);
    }
  }

  const [view, setView] = useState<'main' | 'start' | 'recorded'>('main');
  const subWizard = { position: 1, total: 0, captureHeading: wizard.captureHeading };
  const backButton = (
    <div>
      <Button type="button" variant="quiet" onClick={() => setView('main')}>
        Back
      </Button>
    </div>
  );

  /** Quiet links to the two side screens, so the main screen asks one thing only. */
  const sideLinks =
    (data.canGoBack || data.recorded.length > 0) && (
      <div className="ops-wizard-links past-days-links">
        {data.recorded.length > 0 ? (
          <Button type="button" variant="quiet" onClick={() => setView('recorded')}>
            Days already added
          </Button>
        ) : null}
        {data.canGoBack ? (
          <Button type="button" variant="quiet" onClick={() => setView('start')}>
            Station start date
          </Button>
        ) : null}
      </div>
    );

  if (view === 'start' && data.canGoBack) {
    return (
      <WizardCard>
        <WizardStep
          wizard={subWizard}
          title="When did this station start?"
          hint="Days before it cannot be recorded. Leave it empty to allow up to 90 days back."
        >
          <label>
            Start date
            <input
              type="date"
              value={goLive}
              max={data.today}
              onChange={(event) => setGoLive(event.target.value)}
            />
          </label>
          {goLiveNote ? (
            <p className="panel-detail" role="status">
              {goLiveNote}
            </p>
          ) : null}
          <WizardActions
            wizard={{ atStart: false, back: () => setView('main') }}
            onContinue={() => void saveGoLive()}
            continueLabel="Save start date"
            busy={goLiveBusy}
          />
        </WizardStep>
      </WizardCard>
    );
  }

  if (view === 'recorded' && data.recorded.length > 0) {
    return (
      <WizardCard>
        <WizardStep wizard={subWizard} title="Days already added">
          <ul>
            {data.recorded.map((day) => (
              <li key={day.id}>
                <a href={daily({ businessDayId: day.id })}>{formatBusinessDate(day.date)}</a>
              </li>
            ))}
          </ul>
          {data.canGoBack && closedDays.length > 0 ? (
            <>
              <p className="panel-detail">
                {closedDays.length} added {closedDays.length === 1 ? 'day is' : 'days are'} closed
                and ready to lock. You will be asked to confirm it is you once.
              </p>
              <div>
                <Button type="button" onClick={() => void lockAll()} disabled={locking}>
                  {closedDays.length === 1
                    ? 'Lock this day'
                    : `Lock all ${closedDays.length} closed days`}
                </Button>
              </div>
            </>
          ) : null}
          {lockNote ? (
            <p className="panel-detail" role="status">
              {lockNote}
            </p>
          ) : null}
          {backButton}
        </WizardStep>
      </WizardCard>
    );
  }

  if (!data.canRecord) {
    return (
      <WizardCard>
        <WizardNotice>
          Only a supervisor or the owner can record a past day. Ask one of them to do it.
        </WizardNotice>
        {sideLinks}
      </WizardCard>
    );
  }

  if (data.missing.length === 0) {
    return (
      <WizardCard>
        <WizardNotice>
          {data.goLiveDate
            ? `Every day since ${formatBusinessDate(data.goLiveDate)} already has a record.`
            : 'Every day you can record already has a record.'}
        </WizardNotice>
        <div>
          <Button type="button" onClick={() => router.push(daily())}>
            Back to Daily Operations
          </Button>
        </div>
        {sideLinks}
      </WizardCard>
    );
  }

  return (
    <WizardCard>
      {wizard.step === 'pick' ? (
        <WizardStep
          wizard={wizard}
          title="Which day do you want to record?"
          hint={
            data.canGoBack
              ? 'These days have no record yet.'
              : 'These days have no record yet. For anything older, ask the owner.'
          }
        >
          <WizardChoices label="Day to record">
            {shown.map((day) => (
              <WizardChoice
                key={day}
                id={`past-day-${day}`}
                name="past-day"
                checked={date === day}
                onPick={() => setDate(day)}
              >
                {formatBusinessDate(day)}
              </WizardChoice>
            ))}
          </WizardChoices>
          {!showAll && newestFirst.length > NEWEST_SHOWN ? (
            <div>
              <Button type="button" variant="quiet" onClick={() => setShowAll(true)}>
                Show earlier days
              </Button>
            </div>
          ) : null}
          {wizard.problem ? <WizardNotice>{wizard.problem}</WizardNotice> : null}
          <WizardActions
            wizard={wizard}
            onContinue={() =>
              date
                ? wizard.go(templates.length > 1 ? 'shift' : 'check')
                : wizard.setProblem('Choose a day to continue.')
            }
          />
        </WizardStep>
      ) : wizard.step === 'shift' ? (
        <WizardStep wizard={wizard} title="Which shift was it?">
          <WizardChoices label="Shift">
            {templates.map((template) => (
              <WizardChoice
                key={template.id}
                id={`past-shift-${template.id}`}
                name="past-shift"
                checked={templateId === template.id}
                onPick={() => setTemplateId(template.id)}
              >
                {template.name}
              </WizardChoice>
            ))}
          </WizardChoices>
          {wizard.problem ? <WizardNotice>{wizard.problem}</WizardNotice> : null}
          <WizardActions
            wizard={wizard}
            onContinue={() =>
              templateId ? wizard.go('check') : wizard.setProblem('Choose a shift to continue.')
            }
          />
        </WizardStep>
      ) : (
        <WizardStep
          wizard={wizard}
          title="Check this day"
          hint="Nothing is saved until you confirm."
        >
          <WizardSummary>
            <WizardSummaryRow
              label="Day to record"
              onChange={() => wizard.change('pick')}
              changeLabel="Change"
            >
              {date ? formatBusinessDate(date) : '—'}
            </WizardSummaryRow>
            {chosenTemplate ? (
              <WizardSummaryRow
                label="Shift"
                onChange={() => wizard.change('shift')}
                changeLabel="Change"
              >
                {chosenTemplate.name}
              </WizardSummaryRow>
            ) : null}
          </WizardSummary>
          <WizardNotice>
            This day will be marked as added late, with your name and today’s date. You will then
            enter who was on shift and its figures the same way as on a normal day.
          </WizardNotice>
          {problem ? <WizardNotice>{problem}</WizardNotice> : null}
          <WizardActions
            wizard={wizard}
            onContinue={() => void record()}
            continueLabel="Start recording this day"
            busy={busy}
          />
        </WizardStep>
      )}
      {wizard.step === 'pick' ? sideLinks : null}
    </WizardCard>
  );
}
