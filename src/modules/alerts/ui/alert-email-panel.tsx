'use client';

import { useCallback, useEffect, useState } from 'react';

import { Button, ErrorState, LoadingState, SuccessState } from '@/design-system/primitives';

import { friendlySetupError } from '../../setup/guided-setup';

type Loaded = {
  enabled: boolean;
  version: number | null;
  canManage: boolean;
  receive: boolean;
};

/**
 * Alert email (ADR-020). One switch for the organisation, which starts OFF and which only the owner
 * or an administrator can change, and one for the person looking at the page. The email says only
 * what kind of thing needs a look and links to it: no amounts and no names.
 */
export function AlertEmailPanel({
  tenantId,
  stationId,
}: Readonly<{ tenantId: string; stationId: string | undefined }>) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!stationId) return;
    setError(null);
    try {
      const response = await fetch(
        `/api/alerts/email-settings?tenantId=${tenantId}&stationId=${stationId}`,
        { cache: 'no-store', credentials: 'same-origin' },
      );
      const result = (await response.json()) as Loaded & { message?: string };
      if (!response.ok)
        throw new Error(result.message ?? 'The email settings could not be loaded.');
      setLoaded(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The email settings could not be loaded.');
    }
  }, [tenantId, stationId]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  async function save(body: Record<string, unknown>, done: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch('/api/alerts/email-settings', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({ tenantId, stationId, ...body }),
      });
      const result = (await response.json().catch(() => ({}))) as { message?: string };
      if (!response.ok) {
        setError(friendlySetupError(response.status, result.message));
        return;
      }
      setMessage(done);
      await load();
    } catch {
      setError('We could not reach the server. Nothing was saved.');
    } finally {
      setBusy(false);
    }
  }

  if (!stationId) {
    return (
      <p className="field-hint">Choose a station at the top of the page to see these settings.</p>
    );
  }
  if (!loaded && !error) return <LoadingState label="Loading email settings" />;
  if (!loaded) {
    return (
      <ErrorState
        message={error!}
        action={<Button onClick={() => void load()}>Try again</Button>}
      />
    );
  }

  return (
    <section aria-labelledby="alert-email-title" className="stack">
      <h2 id="alert-email-title">Email alerts</h2>
      <p>
        Once a morning, Shanda Fuel can email you when something needs attention at your station.
        The email names the kind of problem and links to it. It never contains amounts or names, so
        open the app to see the details.
      </p>
      {error ? <ErrorState message={error} /> : null}
      {message ? <SuccessState title="Saved" message={message} /> : null}

      <div className="stack">
        <h3>For you</h3>
        {!loaded.enabled ? (
          <p className="field-hint">
            Email alerts are switched off for the organisation, so nothing is sent yet.
          </p>
        ) : null}
        <p>
          {loaded.receive
            ? 'You will receive these emails.'
            : 'You have switched these emails off.'}
        </p>
        <Button
          loading={busy}
          onClick={() =>
            void save(
              { scope: 'ME', receive: !loaded.receive },
              loaded.receive
                ? 'You will no longer get alert emails.'
                : 'You will get alert emails.',
            )
          }
        >
          {loaded.receive ? 'Stop emailing me' : 'Email me again'}
        </Button>
      </div>

      {loaded.canManage ? (
        <div className="stack">
          <h3>For the organisation</h3>
          <p>
            {loaded.enabled
              ? 'Alert emails are on. Owners, administrators and finance staff get them for their stations, and each supervisor for their own station. Anyone can switch themselves off.'
              : 'Alert emails are off. Nobody is emailed until you turn them on.'}
          </p>
          <Button
            loading={busy}
            onClick={() =>
              void save(
                {
                  scope: 'ORGANISATION',
                  enabled: !loaded.enabled,
                  ...(loaded.version !== null ? { expectedVersion: loaded.version } : {}),
                },
                loaded.enabled ? 'Alert emails are now off.' : 'Alert emails are now on.',
              )
            }
          >
            {loaded.enabled ? 'Turn alert emails off' : 'Turn alert emails on'}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
