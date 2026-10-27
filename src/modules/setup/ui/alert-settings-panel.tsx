'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

import { Button, ErrorState, Field, LoadingState, SuccessState } from '@/design-system/primitives';

import { friendlySetupError } from '../guided-setup';

type Loaded = {
  settings: {
    dueSoonDays: number;
    posSettlementLagDays: number;
    reportGraceDays: number;
    cashShortageMinimum: string;
  };
  version: number | null;
  canManage: boolean;
};

const whole = (text: string, min: number, max: number): number | null => {
  if (!/^\d+$/.test(text.trim())) return null;
  const value = Number(text.trim());
  return value >= min && value <= max ? value : null;
};

/**
 * When reminders start. They warn people; they never block any work. Until the organisation saves
 * its own numbers, the starting values shown here apply.
 */
export function AlertSettingsPanel({
  tenantId,
  stationId,
}: Readonly<{ tenantId: string; stationId: string | undefined }>) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dueSoon, setDueSoon] = useState('');
  const [posLag, setPosLag] = useState('');
  const [grace, setGrace] = useState('');
  const [minimum, setMinimum] = useState('');
  const key = useRef<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch(`/api/setup/alert-settings?tenantId=${tenantId}`, {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      const result = (await response.json()) as Loaded & { message?: string };
      if (!response.ok)
        throw new Error(result.message ?? 'The reminder settings could not be loaded.');
      setLoaded(result);
      setDueSoon(String(result.settings.dueSoonDays));
      setPosLag(String(result.settings.posSettlementLagDays));
      setGrace(String(result.settings.reportGraceDays));
      setMinimum(result.settings.cashShortageMinimum);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'The reminder settings could not be loaded.',
      );
    }
  }, [tenantId]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!loaded || !stationId) return;
    const days = whole(dueSoon, 1, 60);
    const lag = whole(posLag, 0, 30);
    const late = whole(grace, 0, 14);
    const amount = minimum.trim().replace(/,/g, '');
    if (days === null) return setError('Invoices due soon: enter a number of days from 1 to 60.');
    if (lag === null) return setError('Card payments: enter a number of days from 0 to 30.');
    if (late === null) return setError('Daily reports: enter a number of days from 0 to 14.');
    if (!/^\d+(?:\.\d{1,4})?$/.test(amount))
      return setError('Cash shortage: enter an amount such as 5.');
    setBusy(true);
    setError(null);
    setSaved(false);
    const body = {
      commandType: 'SetAlertSettings',
      tenantId,
      stationId,
      dueSoonDays: days,
      posSettlementLagDays: lag,
      reportGraceDays: late,
      cashShortageMinimum: amount,
      ...(loaded.version !== null ? { expectedVersion: loaded.version } : {}),
    };
    key.current ??= crypto.randomUUID();
    try {
      const response = await fetch('/api/setup/commands', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'idempotency-key': key.current },
        body: JSON.stringify(body),
      });
      const result = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) {
        key.current = null;
        setError(friendlySetupError(response.status, result.message));
        return;
      }
      key.current = null;
      setSaved(true);
      await load();
    } catch {
      setError('We could not reach the server. Nothing was saved.');
    } finally {
      setBusy(false);
    }
  }

  if (!loaded && !error) return <LoadingState label="Loading reminder settings" />;
  if (!loaded) {
    return (
      <ErrorState
        message={error!}
        action={<Button onClick={() => void load()}>Try again</Button>}
      />
    );
  }
  const editable = loaded.canManage && Boolean(stationId);

  return (
    <section aria-labelledby="alert-settings-title" className="pg">
      <h3 id="alert-settings-title" className="sr-only">
        Reminders
      </h3>
      <p className="pg-intro">
        Choose when the system should remind you. Reminders appear on the Finance page. They never
        stop anyone from working.
        {loaded.version === null
          ? ' You have not changed these yet, so the starting values apply.'
          : ''}
      </p>
      {!loaded.canManage ? (
        <p className="field-hint">Only the owner or an administrator can change these.</p>
      ) : !stationId ? (
        <p className="field-hint">Choose a station at the top of the page to save changes.</p>
      ) : null}
      {error ? <ErrorState message={error} /> : null}
      {saved ? (
        <SuccessState title="Saved" message="Reminders will use these numbers from now on." />
      ) : null}
      <form onSubmit={save} className="pg-form">
        <div className="pg-form-grid">
          <Field
            id="alert-due-soon"
            label="Warn about supplier invoices due within (days)"
            hint="Invoices falling due in this many days show as “due soon”."
          >
            <input
              id="alert-due-soon"
              value={dueSoon}
              onChange={(e) => setDueSoon(e.target.value)}
              inputMode="numeric"
              disabled={!editable}
            />
          </Field>
          <Field
            id="alert-pos-lag"
            label="Card and mobile payments are late after (days)"
            hint="If a card or mobile payment has not been matched to a payout by then, it is flagged."
          >
            <input
              id="alert-pos-lag"
              value={posLag}
              onChange={(e) => setPosLag(e.target.value)}
              inputMode="numeric"
              disabled={!editable}
            />
          </Field>
          <Field
            id="alert-grace"
            label="A daily report is late after (days)"
            hint="0 flags a report the day after the day worked; larger numbers allow more time."
          >
            <input
              id="alert-grace"
              value={grace}
              onChange={(e) => setGrace(e.target.value)}
              inputMode="numeric"
              disabled={!editable}
            />
          </Field>
          <Field
            id="alert-cash-minimum"
            label="Ignore cash shortages smaller than (USD)"
            hint="Tiny differences are not worth a reminder."
          >
            <input
              id="alert-cash-minimum"
              value={minimum}
              onChange={(e) => setMinimum(e.target.value)}
              inputMode="decimal"
              disabled={!editable}
            />
          </Field>
        </div>
        <div className="pg-form-actions">
          <Button type="submit" loading={busy} disabled={!editable}>
            Save reminders
          </Button>
        </div>
      </form>
    </section>
  );
}
