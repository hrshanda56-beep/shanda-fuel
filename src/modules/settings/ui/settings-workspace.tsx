'use client';

import { useState, type ReactNode } from 'react';

import { Icon, type IconName } from '@/design-system/icons';
import { AccessDeniedState, ContextRequiredState } from '@/design-system/primitives';
import { PageContainer } from '@/design-system/layout';

import type { SettingsView } from '../contracts';
import { SignOutButton } from './sign-out-button';
import { StaffPanel } from './staff-panel';
import styles from './settings-workspace.module.css';

type Tab = 'organisation' | 'companies' | 'stations' | 'staff' | 'account';
type AuthProviderName = 'BETTER_AUTH' | 'CLERK';

const TABS: ReadonlyArray<{ value: Tab; label: string; icon: IconName }> = [
  { value: 'organisation', label: 'Organisation', icon: 'building' },
  { value: 'companies', label: 'Companies', icon: 'receipt' },
  { value: 'stations', label: 'Stations', icon: 'fuel' },
  { value: 'staff', label: 'Staff', icon: 'users' },
  { value: 'account', label: 'Account', icon: 'users' },
];

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]!.charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1]!.charAt(0) : '';
  return (first + last).toUpperCase();
}

function Fields({ items }: { items: ReadonlyArray<{ label: string; value: ReactNode }> }) {
  return (
    <dl className={styles.fields}>
      {items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function InfoCard({
  headingId,
  title,
  children,
}: {
  headingId: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.card}>
      <h3 id={headingId} className={styles.cardTitle}>
        {title}
      </h3>
      {children}
    </div>
  );
}

function AccountPanel({ view, provider }: { view: SettingsView; provider: AuthProviderName }) {
  const email = view.account.email ?? 'No email provided';
  return (
    <>
      <div className={`${styles.card} ${styles.profileCard}`}>
        <span className={styles.avatar} aria-hidden="true">
          {initialsOf(view.account.name)}
        </span>
        <div className={styles.profileText}>
          <p className={styles.profileName}>{view.account.name}</p>
          <p className={styles.profileMeta}>{email}</p>
        </div>
      </div>
      <InfoCard headingId="account-details" title="Your details">
        <Fields
          items={[
            { label: 'Name', value: view.account.name },
            { label: 'Email', value: email },
          ]}
        />
      </InfoCard>
      <div className={styles.signOutRow}>
        <SignOutButton provider={provider} />
      </div>
    </>
  );
}

export function SettingsWorkspace({
  view,
  provider,
}: {
  view: SettingsView;
  provider: AuthProviderName;
}) {
  const [tab, setTab] = useState<Tab>('organisation');
  const organisation = view.context.status === 'ready' ? view.context.organisation : undefined;

  if (!organisation) {
    return (
      <PageContainer width="wide">
        <div className={styles.frame}>
          <div className={styles.content}>
            <header className={styles.contentHeader}>
              <h2 className={styles.contentTitle}>Organisation</h2>
            </header>
            <InfoCard headingId="organisation-unavailable" title="Not available">
              <AccessDeniedState message="No organisation is available for this account." />
            </InfoCard>
            <AccountPanel view={view} provider={provider} />
          </div>
        </div>
      </PageContainer>
    );
  }

  const visibleTabs = TABS.filter((item) => item.value !== 'staff' || view.staff?.canManage);
  const active = visibleTabs.find((item) => item.value === tab) ?? visibleTabs[0]!;
  const { selectedStation, legalEntities } = view.context;

  return (
    <PageContainer width="wide">
      <div className={styles.frame}>
        <nav className={styles.subnav} aria-label="Settings sections">
          {visibleTabs.map((item) => (
            <button
              key={item.value}
              type="button"
              className={styles.subnavItem}
              aria-pressed={item.value === tab}
              onClick={() => setTab(item.value)}
            >
              <Icon name={item.icon} className={styles.subnavIcon} />
              {item.label}
            </button>
          ))}
        </nav>

        <div className={styles.content}>
          <header className={styles.contentHeader}>
            <h2 className={styles.contentTitle}>{active.label}</h2>
            <p className={styles.note}>
              You can look at these details here. Ask your administrator to change them.
            </p>
          </header>

          {tab === 'organisation' ? (
            <InfoCard headingId="organisation" title="Organisation details">
              <Fields items={[{ label: 'Name', value: organisation.name }]} />
            </InfoCard>
          ) : null}

          {tab === 'companies' ? (
            legalEntities.length > 0 ? (
              legalEntities.map((legalEntity) => (
                <InfoCard
                  key={legalEntity.id}
                  headingId={`company-${legalEntity.id}`}
                  title="Company"
                >
                  <Fields items={[{ label: 'Name', value: legalEntity.name }]} />
                </InfoCard>
              ))
            ) : (
              <InfoCard headingId="legal-entities" title="Companies">
                <p className={styles.note}>No companies are available to you.</p>
              </InfoCard>
            )
          ) : null}

          {tab === 'stations' ? (
            selectedStation ? (
              <InfoCard headingId="stations" title="Station details">
                <Fields
                  items={[
                    { label: 'Name', value: selectedStation.name },
                    { label: 'Code', value: selectedStation.code },
                    { label: 'Time zone', value: selectedStation.timezone },
                  ]}
                />
              </InfoCard>
            ) : (
              <ContextRequiredState
                title="Choose a station"
                message="Pick a station at the top of the page to see its details."
              />
            )
          ) : null}

          {tab === 'staff' && view.staff?.canManage ? (
            <StaffPanel tenantId={organisation.id} overview={view.staff} provider={provider} />
          ) : null}

          {tab === 'account' ? <AccountPanel view={view} provider={provider} /> : null}
        </div>
      </div>
    </PageContainer>
  );
}
