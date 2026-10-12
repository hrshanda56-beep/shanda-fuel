'use client';

import { useState } from 'react';

import {
  AccessDeniedState,
  Button,
  ErrorState,
  Field,
  LoadingState,
} from '@/design-system/primitives';

import { Select } from '@/design-system/forms';

import { useSetupOverview, useSetupStations } from './setup-api';
import { ForecourtSection } from './setup-forecourt';
import { PricesSection } from './setup-prices';
import { ProductsSection } from './setup-products';
import { ShiftsSection } from './setup-shifts';
import { SuppliersSection } from './setup-suppliers';
import { TanksSection } from './setup-tanks';
import styles from './setup.module.css';

/**
 * Owner self-service station setup. Single entry point mounted by the
 * Settings page; it loads its own station list and data so Settings stays
 * unchanged. Stations still being onboarded are included, because that is
 * when they are configured.
 */
export function SetupPanel({
  tenantId,
  selectedStationId,
}: {
  tenantId: string;
  selectedStationId?: string;
}) {
  const stations = useSetupStations(tenantId);
  const [chosen, setChosen] = useState<string>();

  if (stations.status === 'loading') return <LoadingState label="Loading stations" />;
  if (stations.status === 'error') {
    return (
      <ErrorState
        title="Stations could not be loaded"
        message={stations.message}
        action={<Button onClick={stations.reload}>Try again</Button>}
      />
    );
  }
  if (stations.data.length === 0) {
    return <AccessDeniedState message="No station is available for you to set up." />;
  }
  const station =
    stations.data.find((item) => item.id === (chosen ?? selectedStationId)) ?? stations.data[0]!;
  return (
    <div className={styles.panel}>
      {stations.data.length > 1 ? (
        <Field id="setup-station" label="Station">
          <Select
            id="setup-station"
            value={station.id}
            onChange={(event) => setChosen(event.target.value)}
            options={stations.data.map((item) => ({
              value: item.id,
              label: `${item.name}${item.status === 'ONBOARDING' ? ' (being set up)' : ''}`,
            }))}
          />
        </Field>
      ) : null}
      <StationSetup key={station.id} tenantId={tenantId} station={station} />
    </div>
  );
}

function StationSetup({
  tenantId,
  station,
}: {
  tenantId: string;
  station: { id: string; name: string; status: string };
}) {
  const { state, reload } = useSetupOverview(tenantId, station.id);

  if (state.status === 'loading') return <LoadingState label="Loading setup" />;
  if (state.status === 'error') {
    return state.forbidden ? (
      <AccessDeniedState message="You do not have access to setup for this station." />
    ) : (
      <ErrorState
        title="Setup could not be loaded"
        message={state.message}
        action={<Button onClick={reload}>Try again</Button>}
      />
    );
  }
  const { data } = state;
  return (
    <div className={styles.panel}>
      <p className={styles.note}>
        Setting up <strong>{station.name}</strong>. Anything not entered stays blank. Nothing is
        assumed.
      </p>
      {data.blockers.length > 0 ? (
        <div className={styles.blockers} role="status">
          <h3 className={styles.blockersTitle}>Still needed before this station can trade</h3>
          <ul>
            {data.blockers.map((blocker) => (
              <li key={`${blocker.code}-${blocker.message}`}>{blocker.message}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <ProductsSection data={data} reload={reload} />
      <TanksSection data={data} reload={reload} />
      <ForecourtSection data={data} reload={reload} />
      <ShiftsSection data={data} reload={reload} />
      <PricesSection data={data} reload={reload} />
      <SuppliersSection data={data} reload={reload} />
    </div>
  );
}
