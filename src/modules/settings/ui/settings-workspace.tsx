'use client';

import { useState } from 'react';

import { SegmentedControl } from '@/design-system/page-kit';
import { AccessDeniedState, ContextRequiredState } from '@/design-system/primitives';
import { PageContainer, Section } from '@/design-system/layout';

import type { SettingsView } from '../contracts';
import { SignOutButton } from './sign-out-button';
import styles from './settings-workspace.module.css';

type Tab = 'organisation' | 'companies' | 'stations' | 'account';

const TABS: ReadonlyArray<{ value: Tab; label: string }> = [
  { value: 'organisation', label: 'Organisation' },
  { value: 'companies', label: 'Companies' },
  { value: 'stations', label: 'Stations' },
  { value: 'account', label: 'Account' },
];

function AccountSection({ view }: { view: SettingsView }) {
  return (
    <Section headingId="account" title="Account">
      <dl className={styles.detailList}>
        <div>
          <dt>Name</dt>
          <dd>{view.account.name}</dd>
        </div>
        <div>
          <dt>Email</dt>
          <dd>{view.account.email}</dd>
        </div>
      </dl>
      <div className={styles.signOutRow}>
        <SignOutButton />
      </div>
    </Section>
  );
}

export function SettingsWorkspace({ view }: { view: SettingsView }) {
  const [tab, setTab] = useState<Tab>('organisation');
  const hasContext = view.context.status === 'ready' && view.context.organisation;

  if (!hasContext) {
    return (
      <PageContainer width="wide">
        <div className={styles.workspace}>
          <Section headingId="organisation-unavailable" title="Organisation">
            <AccessDeniedState message="No organisation is available for this account." />
          </Section>
          <AccountSection view={view} />
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer width="wide">
      <div className={styles.workspace}>
        <p className={styles.readOnlyNote}>
          You can look at these details here. Ask your administrator to change them.
        </p>
        <SegmentedControl
          label="Settings sections"
          options={TABS}
          value={tab}
          onChange={setTab}
          fit="content"
        />

        {tab === 'organisation' ? (
          <Section headingId="organisation" title="Organisation">
            <dl className={styles.detailList}>
              <div>
                <dt>Name</dt>
                <dd>{view.context.organisation.name}</dd>
              </div>
            </dl>
          </Section>
        ) : null}

        {tab === 'companies' ? (
          <Section headingId="legal-entities" title="Companies">
            {view.context.legalEntities.length > 0 ? (
              <ul className={styles.entityList}>
                {view.context.legalEntities.map((legalEntity) => (
                  <li key={legalEntity.id}>
                    <strong>{legalEntity.name}</strong>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.readOnlyNote}>No companies are available to you.</p>
            )}
          </Section>
        ) : null}

        {tab === 'stations' ? (
          <Section headingId="stations" title="Stations">
            {view.context.selectedStation ? (
              <dl className={styles.detailList}>
                <div>
                  <dt>Name</dt>
                  <dd>{view.context.selectedStation.name}</dd>
                </div>
                <div>
                  <dt>Code</dt>
                  <dd>{view.context.selectedStation.code}</dd>
                </div>
                <div>
                  <dt>Time zone</dt>
                  <dd>{view.context.selectedStation.timezone}</dd>
                </div>
              </dl>
            ) : (
              <ContextRequiredState
                title="Choose a station"
                message="Pick a station at the top of the page to see its details."
              />
            )}
          </Section>
        ) : null}

        {tab === 'account' ? <AccountSection view={view} /> : null}
      </div>
    </PageContainer>
  );
}
