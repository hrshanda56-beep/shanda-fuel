'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

import { Icon, type IconName } from '@/design-system/icons';
import { AccessDeniedState } from '@/design-system/primitives';
import { PageContainer } from '@/design-system/layout';

import type { SettingsView } from '../contracts';
import { SignOutButton } from './sign-out-button';
import { StaffPanel } from './staff-panel';
import { PaymentsPanel } from '../../setup/ui/payments-panel';
import { ReadinessPanel } from '../../setup/ui/readiness-panel';
import styles from './settings-workspace.module.css';

type Tab =
  'organisation' | 'companies' | 'stations' | 'readiness' | 'payments' | 'staff' | 'account';

const TABS: ReadonlyArray<{ value: Tab; label: string; icon: IconName }> = [
  { value: 'organisation', label: 'Organisation', icon: 'building' },
  { value: 'companies', label: 'Companies', icon: 'receipt' },
  { value: 'stations', label: 'Stations', icon: 'fuel' },
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

function AccountPanel({ view }: { view: SettingsView }) {
  const email = view.account.email ?? 'No email provided';
  return (
    <>
      <Section headingId="account-profile" title="Profile">
        <div className={styles.profileRow}>
          <span className={styles.avatar} aria-hidden="true">
            {initialsOf(view.account.name)}
          </span>
          <p className={styles.note}>
            Your name and email come from your sign-in account and are read-only here.
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
          <SignOutButton />
        </div>
      </Section>
    </>
  );
}

export function SettingsSectionMenu({
  items,
  active,
  onSelect,
}: {
  items: typeof TABS;
  active: (typeof TABS)[number];
  onSelect: (tab: Tab) => void;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !menu.current?.contains(event.target) && menu.current)
        menu.current.open = false;
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, []);
  function close() {
    if (menu.current) {
      menu.current.open = false;
      menu.current.querySelector('summary')?.focus();
    }
  }
  return (
    <details
      ref={menu}
      className={styles.sectionMenu}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          close();
        }
      }}
    >
      <summary className={styles.sectionTrigger} aria-label={`Settings section: ${active.label}`}>
        <Icon name={active.icon} />
        <span>{active.label}</span>
        <Icon name="chevron-down" className={styles.sectionChevron} />
      </summary>
      <nav className={styles.sectionOptions} aria-label="Choose Settings section">
        {items.map((item) => (
          <button
            key={item.value}
            type="button"
            aria-current={item.value === active.value ? 'page' : undefined}
            onClick={() => {
              onSelect(item.value);
              close();
            }}
          >
            <Icon name={item.icon} />
            <span>{item.label}</span>
            {item.value === active.value ? <Icon name="check" /> : null}
          </button>
        ))}
      </nav>
    </details>
  );
}

export function SettingsStations({ context }: { context: SettingsView['context'] }) {
  const stations = context.selectedStation ? [context.selectedStation] : (context.stations ?? []);
  return (
    <Section headingId="stations" title={context.selectedStation ? 'Station details' : 'Stations'}>
      {stations.length ? (
        stations.map((station) => (
          <section key={station.id}>
            <h3>{station.name}</h3>
            <Fields
              items={[
                { label: 'Code', value: station.code },
                { label: 'Time zone', value: station.timezone },
              ]}
            />
          </section>
        ))
      ) : (
        <p className={styles.note}>No stations are available to your account in this selection.</p>
      )}
    </Section>
  );
}

export function SettingsWorkspace({ view }: { view: SettingsView }) {
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
            <AccountPanel view={view} />
          </div>
        </div>
      </PageContainer>
    );
  }

  const visibleTabs = TABS.filter((item) =>
    item.value === 'staff'
      ? Boolean(view.staff?.canManage)
      : item.value === 'readiness'
        ? Boolean(view.access?.canViewReadiness)
        : item.value === 'payments'
          ? Boolean(view.access?.canViewPayments)
          : true,
  );
  const active = visibleTabs.find((item) => item.value === tab) ?? visibleTabs[0]!;
  const { selectedStation, legalEntities } = view.context;

  return (
    <PageContainer width="wide" className={`settings-page ${styles.page}`}>
      <div className={styles.layout}>
        <SettingsSectionMenu items={visibleTabs} active={active} onSelect={setTab} />
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
            {['organisation', 'companies', 'stations'].includes(tab) ? (
              <p className={styles.note}>These details are read-only on this screen.</p>
            ) : null}
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

          {tab === 'stations' ? <SettingsStations context={view.context} /> : null}

          {tab === 'readiness' && view.access?.canViewReadiness ? <ReadinessPanel /> : null}

          {tab === 'payments' && view.access?.canViewPayments ? <PaymentsPanel /> : null}

          {tab === 'staff' && view.staff?.canManage ? (
            <StaffPanel
              tenantId={organisation.id}
              overview={view.staff}
              selectedStationId={selectedStation?.id}
            />
          ) : null}

          {tab === 'account' ? <AccountPanel view={view} /> : null}
        </div>
      </div>
    </PageContainer>
  );
}
