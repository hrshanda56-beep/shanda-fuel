'use client';

import { useState } from 'react';

import { Modal } from '@/design-system/modal';
import {
  AccessDeniedState,
  Button,
  ErrorState,
  LoadingState,
  StatusBadge,
} from '@/design-system/primitives';
import { SectionCard } from '@/design-system/section-card';
import { WizardMenu } from '@/design-system/wizard-kit';

import type { SettingsStation, SettingsView } from '../../settings/contracts';
import type { SetupOverview } from '../contracts';
import { CompleteStation } from './complete-station';
import { StationCards } from './station-detail';
import styles from './setup.module.css';
import { useSetupOverview } from './use-setup-overview';

type Mode = { kind: 'idle' } | { kind: 'pick' } | { kind: 'station'; stationId: string };

const things = (count: number) => `${count} ${count === 1 ? 'thing' : 'things'}`;

/**
 * Readiness, built like the Stations page: the same station cards, and first a plain question,
 * "Some stations have things left to do. Do you want to complete them now?". Yes leads through one
 * station at a time (#251), asking only about what is missing there, so nobody has to leave this
 * page to finish what they saw on it.
 */
export function ReadinessView({
  overview,
  onChanged = () => window.location.reload(),
  staff,
  onOpenStation,
  onOpenStaff,
}: {
  overview: Extract<SetupOverview, { status: 'ready' }>;
  /** Who can be invited from the loop; absent when the person cannot manage staff. */
  staff?: NonNullable<SettingsView['staff']>;
  /** Re-reads the readiness check after something was saved. */
  onChanged?: () => void;
  /** Opens a finished station's own page. */
  onOpenStation?: (stationId: string) => void;
  /** Takes the person to Staff, to assign someone to a station. */
  onOpenStaff?: () => void;
}) {
  const [mode, setMode] = useState<Mode>({ kind: 'idle' });
  const [declined, setDeclined] = useState(false);

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

  const incomplete = overview.stations.filter((station) => station.missing.length > 0);
  const stations: SettingsStation[] = overview.stations.map((station) => ({
    id: station.stationId,
    code: station.stationCode,
    name: station.stationName,
    timezone: '',
    status: station.stationStatus,
  }));
  const current =
    mode.kind === 'station'
      ? overview.stations.find((station) => station.stationId === mode.stationId)
      : undefined;
  const others = incomplete.filter((station) => station.stationId !== current?.stationId);

  return (
    <div className={styles.stack}>
      <SectionCard
        id="readiness"
        title="Readiness"
        action={
          <StatusBadge tone={incomplete.length === 0 ? 'positive' : 'warning'}>
            {incomplete.length === 0
              ? overview.stations.length === 1
                ? 'Station set up'
                : 'All stations set up'
              : `${incomplete.length} of ${overview.stations.length} to finish`}
          </StatusBadge>
        }
        note={
          incomplete.length === 0
            ? 'Every station has what it needs.'
            : `${
                incomplete.length === 1 ? 'One station has' : `${incomplete.length} stations have`
              } things left to do.`
        }
      >
        {incomplete.length > 0 && !declined ? (
          <div className={styles.todo}>
            <p className={styles.rowTitle}>Do you want to complete them now?</p>
            <div className={styles.formActions}>
              <Button onClick={() => setMode({ kind: 'pick' })}>Yes, complete them</Button>
              <Button variant="secondary" onClick={() => setDeclined(true)}>
                No, not now
              </Button>
            </div>
          </div>
        ) : null}
      </SectionCard>

      <StationCards
        stations={stations}
        readiness={overview.stations}
        canSeeReadiness
        onOpen={(stationId) => {
          const found = overview.stations.find((station) => station.stationId === stationId);
          if (found && found.missing.length > 0) setMode({ kind: 'station', stationId });
          else onOpenStation?.(stationId);
        }}
      />

      {mode.kind === 'pick' ? (
        <Modal
          open
          onClose={() => setMode({ kind: 'idle' })}
          title="Which station first?"
          presentation="page"
          size="md"
        >
          <WizardMenu<string>
            title="Which station do you want to start with?"
            name="readiness-station"
            onPick={(stationId) => setMode({ kind: 'station', stationId })}
            onCancel={() => setMode({ kind: 'idle' })}
            options={incomplete.map((station) => ({
              value: station.stationId,
              label: station.stationName,
              detail: `${things(station.missing.length)} to do`,
            }))}
          />
        </Modal>
      ) : null}

      {current ? (
        <CompleteStation
          key={current.stationId}
          tenantId={overview.tenantId}
          overview={overview}
          staff={staff}
          station={current}
          hasNext={others.length > 0}
          canActivate={current.canActivate}
          onChanged={onChanged}
          onNext={() => setMode({ kind: 'pick' })}
          onOpenStaff={onOpenStaff}
          onClose={() => setMode({ kind: 'idle' })}
        />
      ) : null}
    </div>
  );
}

export function ReadinessPanel({
  staff,
  onOpenStation,
  onOpenStaff,
}: {
  staff?: NonNullable<SettingsView['staff']>;
  onOpenStation?: (stationId: string) => void;
  onOpenStaff?: () => void;
}) {
  const { state, reload, refresh } = useSetupOverview();
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
  return (
    <ReadinessView
      overview={state.overview}
      staff={staff}
      onChanged={refresh}
      onOpenStation={onOpenStation}
      onOpenStaff={onOpenStaff}
    />
  );
}
