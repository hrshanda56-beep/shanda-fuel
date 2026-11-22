'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/design-system/primitives';
import { formatBusinessDate } from '@/design-system/formatters';
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

type Step = 'pick' | 'check';
const SEQUENCE: readonly Step[] = ['pick', 'check'];
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
  const wizard = useWizard<Step>({
    start: 'pick',
    sequence: SEQUENCE,
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
      router.push(daily({ businessDayId }));
    } catch {
      setProblem('The day could not be started. Check the connection, then try again.');
    } finally {
      setBusy(false);
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

  const startDate = data.canGoBack && (
    <section aria-labelledby="past-days-start">
      <h2 id="past-days-start">Station start date</h2>
      <p className="panel-detail">
        The first day this station is run in the app. Days before it cannot be recorded. Leave it
        empty to allow up to 90 days back.
      </p>
      <label>
        Start date
        <input
          type="date"
          value={goLive}
          max={data.today}
          onChange={(event) => setGoLive(event.target.value)}
        />
      </label>
      <div>
        <Button type="button" onClick={() => void saveGoLive()} disabled={goLiveBusy}>
          Save start date
        </Button>
      </div>
      {goLiveNote ? (
        <p className="panel-detail" role="status">
          {goLiveNote}
        </p>
      ) : null}
    </section>
  );

  const recorded = data.recorded.length > 0 && (
    <section aria-labelledby="past-days-recorded">
      <h2 id="past-days-recorded">Days already added</h2>
      <ul>
        {data.recorded.map((day) => (
          <li key={day.id}>
            <a href={daily({ businessDayId: day.id })}>{formatBusinessDate(day.date)}</a>
          </li>
        ))}
      </ul>
    </section>
  );

  if (!data.canRecord) {
    return (
      <WizardCard>
        <WizardNotice>
          Only a supervisor or the owner can record a past day. Ask one of them to do it.
        </WizardNotice>
        {recorded}
        {startDate}
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
        {recorded}
        {startDate}
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
              date ? wizard.go('check') : wizard.setProblem('Choose a day to continue.')
            }
          />
        </WizardStep>
      ) : (
        <WizardStep
          wizard={wizard}
          title="Check this day"
          hint="Nothing is saved until you press the button below."
        >
          <WizardSummary>
            <WizardSummaryRow
              label="Day to record"
              onChange={() => wizard.back()}
              changeLabel="Change"
            >
              {date ? formatBusinessDate(date) : '—'}
            </WizardSummaryRow>
          </WizardSummary>
          <WizardNotice>
            This day will be marked as added late, with your name and today’s date. You will then
            enter its shifts and figures the same way as on a normal day.
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
      {recorded}
      {startDate}
    </WizardCard>
  );
}
