'use client';

import { useEffect, useRef, useState } from 'react';

import { Icon, type IconName } from '@/design-system/icons';
import { AccessDeniedState, Button, StatusBadge } from '@/design-system/primitives';
import { PageContainer } from '@/design-system/layout';
import { CardEmpty, CardRow, CardRows, CardTiles, SectionCard } from '@/design-system/section-card';

import type { SettingsView } from '../contracts';
import { SignOutButton } from './sign-out-button';
import { StaffPanel } from './staff-panel';
import { AuditPanel } from '../../audit/ui/audit-panel';
import { StationSetupGuide } from '../../setup/ui/guided-setup-panel';
import { AlertSettingsPanel } from '../../setup/ui/alert-settings-panel';
import { PaymentsPanel } from '../../setup/ui/payments-panel';
import { ReadinessPanel } from '../../setup/ui/readiness-panel';
import { AddCompany, AddStation, EditCompany, EditStation } from './structure-forms';
import styles from './settings-workspace.module.css';

type Tab =
  | 'organisation'
  | 'stations'
  | 'readiness'
  | 'payments'
  | 'staff'
  | 'alerts'
  | 'activity'
  | 'account';

const TABS: ReadonlyArray<{ value: Tab; label: string; icon: IconName }> = [
  { value: 'organisation', label: 'Organisation', icon: 'building' },
  { value: 'stations', label: 'Stations', icon: 'fuel' },
  { value: 'readiness', label: 'Readiness', icon: 'check-circle' },
  { value: 'payments', label: 'Payments', icon: 'card' },
  { value: 'staff', label: 'Staff', icon: 'users' },
  { value: 'alerts', label: 'Reminders', icon: 'bell' },
  { value: 'activity', label: 'Activity log', icon: 'clock' },
  { value: 'account', label: 'Account', icon: 'lock' },
];

const ROLE_LABELS: Readonly<Record<string, string>> = {
  OWNER: 'Owner',
  ADMINISTRATOR: 'Administrator',
  FINANCE: 'Finance',
  SUPERVISOR: 'Supervisor',
  ATTENDANT: 'Attendant',
};

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]!.charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1]!.charAt(0) : '';
  return (first + last).toUpperCase();
}

function AccountPanel({ view }: { view: SettingsView }) {
  const email = view.account.email ?? 'No email provided';
  return (
    <>
      <SectionCard
        id="account-profile"
        title="Profile"
        note="Your name and email come from your sign-in account and are read-only here."
      >
        <div className={styles.profileRow}>
          <span className={styles.avatar} aria-hidden="true">
            {initialsOf(view.account.name)}
          </span>
          <dl className={styles.profileFacts}>
            <div>
              <dt>Name</dt>
              <dd>{view.account.name}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{email}</dd>
            </div>
          </dl>
        </div>
      </SectionCard>
      <SectionCard
        id="account-session"
        title="Session"
        note="Sign out of Shanda Fuel on this device."
        action={<SignOutButton />}
      />
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

export function SettingsStations({
  context,
  tenantId,
  canManage = false,
  onSetup,
}: {
  context: SettingsView['context'];
  tenantId?: string;
  canManage?: boolean;
  /** Opens the guided setup for one station. Left out when the person cannot set stations up. */
  onSetup?: (stationId: string) => void;
}) {
  const stations = context.selectedStation ? [context.selectedStation] : (context.stations ?? []);
  const canEdit = Boolean(canManage && tenantId);
  return (
    <SectionCard
      id="stations"
      title={context.selectedStation ? 'Station details' : 'Stations'}
      note={
        canEdit && context.legalEntities.length === 0
          ? 'Add a company under Organisation before adding a station.'
          : undefined
      }
      action={
        canEdit ? <AddStation tenantId={tenantId!} companies={context.legalEntities} /> : undefined
      }
    >
      {stations.length ? (
        <CardRows label="Stations">
          {stations.map((station) => {
            const settingUp = station.status === 'ONBOARDING';
            return (
              <CardRow
                key={station.id}
                title={station.name}
                badge={
                  <StatusBadge tone={settingUp ? 'pending' : 'positive'}>
                    {settingUp ? 'Setting up' : 'Live'}
                  </StatusBadge>
                }
                detail={`${station.code} · ${station.timezone}`}
                aside={
                  <>
                    {onSetup ? (
                      <Button
                        variant={settingUp ? 'primary' : 'secondary'}
                        size="sm"
                        aria-label={`Station setup for ${station.name}`}
                        onClick={() => onSetup(station.id)}
                      >
                        Station setup
                      </Button>
                    ) : null}
                    {canEdit ? <EditStation tenantId={tenantId!} station={station} /> : null}
                  </>
                }
              />
            );
          })}
        </CardRows>
      ) : (
        <CardEmpty>No stations are available to your account in this selection.</CardEmpty>
      )}
    </SectionCard>
  );
}

/** A station's people, read only: name and role, nothing about access. */
function StationStaffList({
  stationName,
  staff,
}: {
  stationName: string;
  staff: NonNullable<SettingsView['stationView']>['staff'];
}) {
  return (
    <SectionCard
      id="station-staff"
      title={`Staff at ${stationName}`}
      note="This list is read only. A manager changes who works here."
    >
      {staff.length > 0 ? (
        <CardRows label={`Staff at ${stationName}`}>
          {staff.map((person) => (
            <CardRow
              key={`${person.name}-${person.role}`}
              title={person.name}
              aside={
                <span className={styles.roleLabel}>{ROLE_LABELS[person.role] ?? person.role}</span>
              }
            />
          ))}
        </CardRows>
      ) : (
        <CardEmpty>Nobody is assigned to this station yet.</CardEmpty>
      )}
    </SectionCard>
  );
}

export function SettingsWorkspace({
  view,
  initialTab,
  initialSetupStation,
}: {
  view: SettingsView;
  /** A section to open first, e.g. from a link on the readiness list. */
  initialTab?: string;
  /** A station whose setup should open straight away, e.g. from the readiness list. */
  initialSetupStation?: string;
}) {
  // Station setup lives on the Stations section, so an older link to it lands there.
  const requested = initialTab === 'setup' ? 'stations' : initialTab;
  const [tab, setTab] = useState<Tab>(
    TABS.some((item) => item.value === requested) ? (requested as Tab) : 'organisation',
  );
  const [setupStationId, setSetupStationId] = useState<string | null>(() =>
    initialTab === 'setup' || initialSetupStation
      ? (initialSetupStation ??
        view.context.selectedStation?.id ??
        view.context.stations?.[0]?.id ??
        null)
      : null,
  );
  const content = useRef<HTMLDivElement>(null);
  const organisation = view.context.status === 'ready' ? view.context.organisation : undefined;

  // Opening or leaving a station's setup swaps the whole card, so focus moves to the new heading
  // instead of being lost with the button that was pressed.
  const [focusRequests, setFocusRequests] = useState(0);
  const askForFocus = () => setFocusRequests((count) => count + 1);
  useEffect(() => {
    if (focusRequests === 0) return;
    const heading = content.current?.querySelector<HTMLElement>('h2');
    heading?.setAttribute('tabindex', '-1');
    heading?.focus();
  }, [focusRequests]);

  if (!organisation) {
    return (
      <PageContainer width="wide" className={`settings-page ${styles.page}`}>
        <div className={styles.layout}>
          <div className={styles.content}>
            <SectionCard id="organisation-unavailable" title="Organisation">
              <AccessDeniedState message="No organisation is available for this account." />
            </SectionCard>
            <AccountPanel view={view} />
          </div>
        </div>
      </PageContainer>
    );
  }

  const stationView = view.stationView;
  const visibleTabs = TABS.filter((item) =>
    stationView
      ? item.value === 'account' ||
        (item.value === 'staff' && stationView.canViewStaff) ||
        (item.value === 'activity' && stationView.canViewActivity)
      : item.value === 'staff'
        ? Boolean(view.staff?.canManage)
        : item.value === 'alerts'
          ? Boolean(view.access?.canManageAlerts)
          : item.value === 'activity'
            ? Boolean(view.access?.canViewAudit)
            : item.value === 'readiness'
              ? Boolean(view.access?.canViewReadiness)
              : item.value === 'payments'
                ? Boolean(view.access?.canViewPayments)
                : true,
  );
  const active = visibleTabs.find((item) => item.value === tab) ?? visibleTabs[0]!;
  const shown = active.value;
  const { selectedStation, legalEntities } = view.context;
  const canSetUp = Boolean(view.access?.canViewReadiness);
  const stations = selectedStation ? [selectedStation] : (view.context.stations ?? []);
  const setupStation = canSetUp ? stations.find((item) => item.id === setupStationId) : undefined;

  // The section lives in the address, so a refresh or a shared link returns to it.
  function choose(next: Tab) {
    setSetupStationId(null);
    setTab(next);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', next);
      window.history.replaceState(window.history.state, '', url);
    } catch {
      // The section still works without a shareable link.
    }
  }

  return (
    <PageContainer width="wide" className={`settings-page ${styles.page}`}>
      <div className={styles.layout}>
        <SettingsSectionMenu items={visibleTabs} active={active} onSelect={choose} />
        <nav
          className={styles.subnav}
          aria-label="Settings sections"
          onKeyDown={(event) => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
            const buttons = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>('button'),
            );
            const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
            if (at < 0) return;
            event.preventDefault();
            const step = event.key === 'ArrowDown' ? 1 : -1;
            buttons[(at + step + buttons.length) % buttons.length]?.focus();
          }}
        >
          {visibleTabs.map((item) => (
            <button
              key={item.value}
              type="button"
              className={styles.subnavItem}
              aria-pressed={item.value === shown}
              onClick={() => choose(item.value)}
            >
              <Icon name={item.icon} className={styles.subnavIcon} />
              {item.label}
            </button>
          ))}
        </nav>

        <div className={styles.content} ref={content}>
          {shown === 'organisation' ? (
            <>
              <SectionCard
                id="organisation"
                title="Organisation"
                note={
                  view.access?.canManageCompanies
                    ? undefined
                    : 'These details are read-only on this screen.'
                }
              >
                <CardTiles items={[{ label: 'Name', value: organisation.name }]} />
              </SectionCard>
              <SectionCard
                id="companies"
                title="Companies"
                action={
                  view.access?.canManageCompanies ? <AddCompany tenantId={organisation.id} /> : null
                }
              >
                {legalEntities.length > 0 ? (
                  <CardRows label="Companies">
                    {legalEntities.map((legalEntity) => (
                      <CardRow
                        key={legalEntity.id}
                        title={legalEntity.name}
                        aside={
                          view.access?.canManageCompanies ? (
                            <EditCompany tenantId={organisation.id} company={legalEntity} />
                          ) : null
                        }
                      />
                    ))}
                  </CardRows>
                ) : (
                  <CardEmpty>No companies are available to you.</CardEmpty>
                )}
              </SectionCard>
            </>
          ) : null}

          {shown === 'stations' && setupStation ? (
            <SectionCard
              id="station-setup"
              title={`Station setup: ${setupStation.name}`}
              note="Work through these steps from top to bottom. You can stop at any time and come back; what you have saved stays saved."
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setSetupStationId(null);
                    askForFocus();
                  }}
                >
                  <Icon name="chevron-right" className={styles.backIcon} />
                  Back to stations
                </Button>
              }
            >
              <StationSetupGuide
                key={setupStation.id}
                tenantId={organisation.id}
                stationId={setupStation.id}
                stationName={setupStation.name}
              />
            </SectionCard>
          ) : null}

          {shown === 'stations' && !setupStation ? (
            <SettingsStations
              context={view.context}
              tenantId={organisation.id}
              canManage={Boolean(view.access?.canManageStations)}
              onSetup={
                canSetUp
                  ? (stationId) => {
                      setSetupStationId(stationId);
                      askForFocus();
                    }
                  : undefined
              }
            />
          ) : null}

          {shown === 'readiness' && view.access?.canViewReadiness ? <ReadinessPanel /> : null}

          {shown === 'payments' && view.access?.canViewPayments ? <PaymentsPanel /> : null}

          {shown === 'staff' && stationView ? (
            <StationStaffList stationName={stationView.stationName} staff={stationView.staff} />
          ) : null}

          {shown === 'staff' && !stationView && view.staff?.canManage ? (
            <SectionCard id="staff" title="Staff">
              <StaffPanel
                tenantId={organisation.id}
                overview={view.staff}
                selectedStationId={selectedStation?.id}
              />
            </SectionCard>
          ) : null}

          {shown === 'alerts' && view.access?.canManageAlerts ? (
            <AlertSettingsPanel tenantId={organisation.id} stationId={selectedStation?.id} />
          ) : null}

          {shown === 'activity' && stationView ? (
            <AuditPanel
              tenantId={organisation.id}
              stationId={stationView.stationId}
              timezone={selectedStation?.timezone}
            />
          ) : null}

          {shown === 'activity' && !stationView && view.access?.canViewAudit ? (
            <AuditPanel tenantId={organisation.id} timezone={selectedStation?.timezone} />
          ) : null}

          {shown === 'account' ? <AccountPanel view={view} /> : null}
        </div>
      </div>
    </PageContainer>
  );
}
