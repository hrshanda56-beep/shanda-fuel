'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { Modal } from '@/design-system/modal';
import { Button, ErrorState, LoadingState, SuccessState } from '@/design-system/primitives';
import { CardRow, CardRows, SectionCard } from '@/design-system/section-card';

import { cleanMinimum, daysLabel } from '../alert-settings-checks';
import { friendlySetupError } from '../guided-setup';
import { AlertSettingsWizard, type ReminderValues } from './alert-settings-wizard';

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

/**
 * When reminders start. They warn people; they never block any work. Until the organisation saves
 * its own numbers, the starting values shown here apply. The settings are listed; "Change reminders"
 * opens a guide that asks about one setting at a time.
 */
export function AlertSettingsPanel({
  tenantId,
  stationId,
}: Readonly<{ tenantId: string; stationId: string | undefined }>) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
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
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'The reminder settings could not be loaded.',
      );
    }
  }, [tenantId]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  async function save(values: ReminderValues) {
    if (!loaded || !stationId) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    const body = {
      commandType: 'SetAlertSettings',
      tenantId,
      stationId,
      dueSoonDays: Number(values.dueSoon.trim()),
      posSettlementLagDays: Number(values.posLag.trim()),
      reportGraceDays: Number(values.grace.trim()),
      cashShortageMinimum: cleanMinimum(values.minimum),
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
      setOpen(false);
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
  const { settings } = loaded;

  return (
    <SectionCard
      id="alert-settings"
      title="Reminders"
      note={`Choose when the system should remind you. Reminders appear on the Finance page and never stop anyone from working.${
        loaded.version === null
          ? ' You have not changed these yet, so the starting values apply.'
          : ''
      }`}
      action={
        editable ? (
          <Button
            aria-haspopup="dialog"
            onClick={() => {
              setError(null);
              setSaved(false);
              setOpen(true);
            }}
          >
            Change reminders
          </Button>
        ) : null
      }
    >
      {!loaded.canManage ? (
        <p className="sc-message">Only the owner or an administrator can change these.</p>
      ) : !stationId ? (
        <p className="sc-message">Choose a station at the top of the page to save changes.</p>
      ) : null}
      {error && !open ? <ErrorState message={error} /> : null}
      {saved ? (
        <SuccessState title="Saved" message="Reminders will use these numbers from now on." />
      ) : null}
      <CardRows label="Reminder settings">
        <CardRow
          title="Supplier invoices due soon"
          detail={`Warn ${daysLabel(settings.dueSoonDays)} before they are due`}
        />
        <CardRow
          title="Card and mobile payments"
          detail={`Late after ${daysLabel(settings.posSettlementLagDays)}`}
        />
        <CardRow
          title="Daily reports"
          detail={`Late after ${daysLabel(settings.reportGraceDays)}`}
        />
        <CardRow
          title="Cash shortages"
          detail={`Ignore shortages smaller than US$${settings.cashShortageMinimum}`}
        />
      </CardRows>
      <Modal
        open={open}
        onClose={() => !busy && setOpen(false)}
        title="Change reminders"
        presentation="page"
        backLabel="Settings"
        size="sm"
        dismissible={!busy}
      >
        {open ? (
          <AlertSettingsWizard
            current={{
              dueSoon: String(settings.dueSoonDays),
              posLag: String(settings.posSettlementLagDays),
              grace: String(settings.reportGraceDays),
              minimum: settings.cashShortageMinimum,
            }}
            busy={busy}
            error={error}
            onCancel={() => setOpen(false)}
            onSubmit={(values) => void save(values)}
          />
        ) : null}
      </Modal>
    </SectionCard>
  );
}
