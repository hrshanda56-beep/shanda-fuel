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

import type { ReadinessStatus, SetupOverview, StationReadiness } from '../contracts';
import { statusLabel } from '../readiness';
import styles from './setup.module.css';
import { useSetupOverview } from './use-setup-overview';

const TONE: Record<ReadinessStatus, StatusTone> = {
  READY: 'positive',
  PARTIAL: 'warning',
  NOT_ENTERED: 'neutral',
};

function StationCard({ station }: { station: StationReadiness }) {
  const headingId = `readiness-${station.stationId}`;
  return (
    <section className={styles.card} aria-labelledby={headingId}>
      <div className={styles.cardHeader}>
        <h3 id={headingId} className={styles.cardTitle}>
          {station.stationName} <span className={styles.note}>({station.stationCode})</span>
        </h3>
        <StatusBadge tone={station.ready ? 'positive' : 'warning'}>
          {station.ready ? 'Setup complete' : 'Setup incomplete'}
        </StatusBadge>
      </div>
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
}: {
  overview: Extract<SetupOverview, { status: 'ready' }>;
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
        <StationCard key={station.stationId} station={station} />
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
