'use client';

import { useState, type ReactNode } from 'react';

import { Icon, type IconName } from '@/design-system/icons';
import { AccessDeniedState, ContextRequiredState } from '@/design-system/primitives';
import { PageContainer } from '@/design-system/layout';

import type { SettingsView } from '../contracts';
import { SignOutButton } from './sign-out-button';
import { StaffPanel } from './staff-panel';
import { PaymentsPanel } from '../../setup/ui/payments-panel';
import { ReadinessPanel } from '../../setup/ui/readiness-panel';
import { ConfigurationPanel } from '../../setup/ui/configuration-panel';
import styles from './settings-workspace.module.css';

type Tab =
  | 'organisation'
  | 'companies'
  | 'stations'
  | 'configuration'
  | 'readiness'
  | 'payments'
  | 'staff'
  | 'account';
type AuthProviderName = 'BETTER_AUTH' | 'CLERK';

const TABS: ReadonlyArray<{ value: Tab; label: string; icon: IconName }> = [
  { value: 'organisation', label: 'Organisation', icon: 'building' },
  { value: 'companies', label: 'Companies', icon: 'receipt' },
  { value: 'stations', label: 'Stations', icon: 'fuel' },
  { value: 'configuration', label: 'Configuration', icon: 'settings' },
  { value: 'readiness', label: 'Readiness', icon: 'check-circle' },
  { value: 'payments', label: 'Payments', icon: 'receipt' },
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

/** A titled block inside the settings panel: heading, optional intro, then its fields. */
function Section({
  headingId,
  title,
  intro,
  children,
}: {
  headingId: string;
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <div className={styles.sectionHead}>
        <h3 id={headingId} className={styles.sectionTitle}>
          {title}
        </h3>
        {intro ? <p className={styles.note}>{intro}</p> : null}
      </div>
      {children}
    </section>
  );
}

function AccountPanel({ view, provider }: { view: SettingsView; provider: AuthProviderName }) {
  const email = view.account.email ?? 'No email provided';
  return (
    <>
      <Section headingId="account-profile" title="Profile">
        <div className={styles.profileRow}>
          <span className={styles.avatar} aria-hidden="true">
            {initialsOf(view.account.name)}
          </span>
          <p className={styles.note}>
            Your name and email come from your sign-in account. Ask your administrator to change
            them.
          </p>
        </div>
        <Fields
          items={[
            { label: 'Name', value: view.account.name },
            { label: 'Email', value: email },
          ]}
        />
      </Section>
      <Section
        headingId="account-session"
        title="Session"
        intro="Sign out of Shanda Fuel on this device."
      >
        <div className={styles.signOutRow}>
          <SignOutButton provider={provider} />
        </div>
      </Section>
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
      <PageContainer width="wide" className={`settings-page ${styles.page}`}>
        <div className={styles.layout}>
          <div className={styles.content}>
            <header className={styles.contentHeader}>
              <h2 className={styles.contentTitle}>Organisation</h2>
            </header>
            <Section headingId="organisation-unavailable" title="Not available">
              <AccessDeniedState message="No organisation is available for this account." />
            </Section>
            <AccountPanel view={view} provider={provider} />
          </div>
        </div>
      </PageContainer>
    );
  }

  const visibleTabs = TABS.filter(
    (item) =>
      (item.value !== 'staff' &&
        item.value !== 'readiness' &&
        item.value !== 'payments' &&
        item.value !== 'configuration') ||
      view.staff?.canManage,
  );
  const active = visibleTabs.find((item) => item.value === tab) ?? visibleTabs[0]!;
  const { selectedStation, legalEntities } = view.context;

  return (
    <PageContainer width="wide" className={`settings-page ${styles.page}`}>
      <div className={styles.layout}>
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
            {tab === 'staff' ? null : (
              <p className={styles.note}>
                You can look at these details here. Ask your administrator to change them.
              </p>
            )}
          </header>

          {tab === 'organisation' ? (
            <Section headingId="organisation" title="Organisation details">
              <Fields items={[{ label: 'Name', value: organisation.name }]} />
            </Section>
          ) : null}

          {tab === 'companies' ? (
            <Section headingId="companies" title="Companies">
              {legalEntities.length > 0 ? (
                <Fields
                  items={legalEntities.map((legalEntity, index) => ({
                    label: legalEntities.length > 1 ? `Company ${index + 1}` : 'Company',
                    value: legalEntity.name,
                  }))}
                />
              ) : (
                <p className={styles.note}>No companies are available to you.</p>
              )}
            </Section>
          ) : null}

          {tab === 'stations' ? (
            selectedStation ? (
              <Section headingId="stations" title="Station details">
                <Fields
                  items={[
                    { label: 'Name', value: selectedStation.name },
                    { label: 'Code', value: selectedStation.code },
                    { label: 'Time zone', value: selectedStation.timezone },
                  ]}
                />
              </Section>
            ) : (
              <ContextRequiredState
                title="Choose a station"
                message="Pick a station at the top of the page to see its details."
              />
            )
          ) : null}

          {tab === 'readiness' && view.staff?.canManage ? <ReadinessPanel /> : null}

          {tab === 'configuration' && view.staff?.canManage ? (
            <ConfigurationPanel provider={provider} />
          ) : null}

          {tab === 'payments' && view.staff?.canManage ? (
            <PaymentsPanel provider={provider} />
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
