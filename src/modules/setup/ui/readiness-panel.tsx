'use client';

import {
  AccessDeniedState,
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  StatusBadge,
  type StatusTone,
} from '@/design-system/primitives';
import { Notice } from '@/design-system/feedback';
import { useState } from 'react';

import type { ReadinessStatus, SetupOverview, StationReadiness } from '../contracts';
import { statusLabel } from '../readiness';
import styles from './setup.module.css';
import { useSetupOverview } from './use-setup-overview';

const TONE: Record<ReadinessStatus, StatusTone> = {
  READY: 'positive',
  PARTIAL: 'warning',
  NOT_ENTERED: 'neutral',
};

function tabHref(tab: string) {
  const params = new URLSearchParams(window.location.search);
  params.set('tab', tab);
  return `/settings?${params.toString()}`;
}

function StationCard({
  station,
  tenantId,
  onActivated,
}: {
  station: StationReadiness;
  tenantId: string;
  onActivated: () => void;
}) {
  const headingId = `readiness-${station.stationId}`;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function activate() {
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch('/api/forecourt/commands', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({
          commandType: 'ActivateStation',
          tenantId,
          stationId: station.stationId,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        setError(body?.message ?? 'The station could not be activated. Nothing was changed.');
        return;
      }
      onActivated();
    } catch {
      setError('The station could not be activated. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.card} aria-labelledby={headingId}>
      <div className={styles.cardHeader}>
        <h3 id={headingId} className={styles.cardTitle}>
          {station.stationName} <span className={styles.note}>({station.stationCode})</span>
        </h3>
        <StatusBadge
          tone={
            station.stationStatus === 'ONBOARDING'
              ? 'pending'
              : station.ready
                ? 'positive'
                : 'warning'
          }
        >
          {station.stationStatus === 'ONBOARDING'
            ? 'Setting up'
            : station.ready
              ? 'Setup complete'
              : 'Setup incomplete'}
        </StatusBadge>
      </div>
      {station.stationStatus === 'ONBOARDING' ? (
        <div>
          {station.missing.length > 0 ? (
            <>
              <p className={styles.note}>Before this station can go live you still need:</p>
              <ul className={styles.list} aria-label={`${station.stationName} still needed`}>
                {station.missing.map((item) => (
                  <li key={item.code} className={styles.row}>
                    <div className={styles.rowMain}>
                      <span className={styles.rowTitle}>{item.label}</span>
                      <span className={styles.rowDetail}>{item.detail}</span>
                    </div>
                    <a href={tabHref(item.tab)}>Fix this</a>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className={styles.note}>
              Everything needed is in place. Opening stock is entered after the station goes live.
            </p>
          )}
          {station.canActivate ? (
            <Button variant="primary" loading={busy} onClick={activate}>
              Activate station
            </Button>
          ) : null}
          {error ? <p role="alert">{error}</p> : null}
        </div>
      ) : null}
      <ul className={styles.list} aria-label={`${station.stationName} setup`}>
        {station.areas.map((area) => (
          <li key={area.code} className={styles.row}>
            <div className={styles.rowMain}>
              <span className={styles.rowTitle}>{area.label}</span>
              <span className={styles.rowDetail}>{area.detail}</span>
            </div>
            <StatusBadge tone={TONE[area.status]}>{statusLabel(area.status)}</StatusBadge>
          </li>
        ))}
      </ul>
      {station.blockedSummary ? (
        <Notice tone="warning" title="Some transactions are blocked here">
          {station.blockedSummary}
        </Notice>
      ) : null}
    </section>
  );
}

export function ReadinessView({
  overview,
  onActivated = () => window.location.reload(),
}: {
  overview: Extract<SetupOverview, { status: 'ready' }>;
  onActivated?: () => void;
}) {
  if (!overview.canViewReadiness) {
    return <AccessDeniedState message="You do not have access to station setup readiness." />;
  }
  if (overview.stations.length === 0) {
    return (
      <EmptyState
        title="No stations to show"
        message="No stations are available to you yet. Stations appear here once they are created."
      />
    );
  }
  return (
    <div className={styles.stack}>
      <p className={styles.note}>
        This is read from what has been entered. Anything marked Not entered or Incomplete has not
        been set up, and transactions that depend on it are blocked until it is.
      </p>
      {overview.stations.map((station) => (
        <StationCard
          key={station.stationId}
          station={station}
          tenantId={overview.tenantId}
          onActivated={onActivated}
        />
      ))}
    </div>
  );
}

export function ReadinessPanel() {
  const { state, reload } = useSetupOverview();
  if (state.kind === 'loading') return <LoadingState label="Loading station setup" />;
  if (state.kind === 'unavailable') {
    return <AccessDeniedState message="You do not have access to station setup readiness." />;
  }
  if (state.kind === 'error') {
    return (
      <ErrorState
        title="Setup could not be loaded"
        message="Station setup could not be read just now. Nothing has been changed."
        action={<Button onClick={reload}>Try again</Button>}
      />
    );
  }
  return <ReadinessView overview={state.overview} />;
}
