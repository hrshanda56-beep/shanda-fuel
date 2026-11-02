'use client';

import {
  AccessDeniedState,
  Button,
  ErrorState,
  LoadingState,
  StatusBadge,
  type StatusTone,
} from '@/design-system/primitives';
import { Notice } from '@/design-system/feedback';
import { CardRow, CardRows, SectionCard } from '@/design-system/section-card';
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

/**
 * Where "Fix this" leads. Station setup lives on the Stations section and opens for the station
 * the item belongs to; payments and staff keep their own sections.
 */
function fixHref(tab: string, stationId: string) {
  const params = new URLSearchParams(window.location.search);
  if (tab === 'setup') {
    params.set('tab', 'stations');
    params.set('setup', stationId);
  } else {
    params.set('tab', tab);
    params.delete('setup');
  }
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

  const settingUp = station.stationStatus === 'ONBOARDING';

  return (
    <SectionCard
      id={`readiness-${station.stationId}`}
      title={
        <>
          {station.stationName} <span className={styles.note}>({station.stationCode})</span>
        </>
      }
      action={
        <StatusBadge tone={settingUp ? 'pending' : station.ready ? 'positive' : 'warning'}>
          {settingUp ? 'Setting up' : station.ready ? 'Setup complete' : 'Setup incomplete'}
        </StatusBadge>
      }
    >
      {settingUp ? (
        <div className={styles.todo}>
          {station.missing.length > 0 ? (
            <>
              <p className={styles.note}>Before this station can go live you still need:</p>
              <ul className={styles.todoList} aria-label={`${station.stationName} still needed`}>
                {station.missing.map((item) => (
                  <li key={item.code} className={styles.todoItem}>
                    <div>
                      <span className={styles.rowTitle}>{item.label}</span>
                      <span className={styles.rowDetail}>{item.detail}</span>
                    </div>
                    <a
                      className="button button-secondary button-sm"
                      href={fixHref(item.tab, station.stationId)}
                    >
                      Fix this
                    </a>
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
            <div>
              <Button variant="primary" loading={busy} onClick={activate}>
                Activate station
              </Button>
            </div>
          ) : null}
          {error ? (
            <p className={styles.messageError} role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
      <CardRows label={`${station.stationName} setup`}>
        {station.areas.map((area) => (
          <CardRow
            key={area.code}
            title={area.label}
            detail={area.detail}
            aside={<StatusBadge tone={TONE[area.status]}>{statusLabel(area.status)}</StatusBadge>}
          />
        ))}
      </CardRows>
      {station.blockedSummary ? (
        <Notice tone="warning" title="Some transactions are blocked here">
          {station.blockedSummary}
        </Notice>
      ) : null}
    </SectionCard>
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
      <SectionCard
        id="readiness"
        title="Readiness"
        note="No stations are available to you yet. Stations appear here once they are created."
      />
    );
  }
  const ready = overview.stations.filter((station) => station.ready).length;
  const total = overview.stations.length;
  return (
    <div className={styles.stack}>
      <SectionCard
        id="readiness"
        title="Readiness"
        note="This is read from what has been entered. Anything marked Not entered or Incomplete has not been set up, and transactions that depend on it are blocked until it is."
        action={
          <StatusBadge tone={ready === total ? 'positive' : 'warning'}>
            {ready === total
              ? total === 1
                ? 'Station set up'
                : 'All stations set up'
              : ready === 0
                ? 'No station set up yet'
                : `${ready} of ${total} stations set up`}
          </StatusBadge>
        }
      />
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
