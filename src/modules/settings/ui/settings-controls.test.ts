import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('@clerk/nextjs', () => ({
  useReverification: (callback: unknown) => callback,
  useClerk: () => ({ signOut: vi.fn() }),
}));
import { writeFileSync } from 'node:fs';
import { SettingsSectionMenu, SettingsWorkspace, SettingsStations } from './settings-workspace';
import { StaffPanel } from './staff-panel';
import type { StaffOverview } from '@/modules/staff/contracts';
const overview: StaffOverview = {
  canManage: true,
  canInviteOwner: true,
  scopeOptions: [
    {
      id: 'e',
      name: 'Entity',
      stations: [
        { id: 'a', name: 'Alpha', code: 'A' },
        { id: 'b', name: 'Beta', code: 'B' },
      ],
    },
  ],
  pendingInvitations: [],
  deactivatedStaff: [],
  activeStaff: [
    {
      membershipId: 'm',
      identityId: 'i',
      name: 'Alpha attendant',
      email: null,
      status: 'ACTIVE',
      roles: ['ATTENDANT'],
      scopeLabels: ['Alpha'],
      assignments: [{ role: 'ATTENDANT', scopeType: 'STATION', stationId: 'a' }],
    },
  ],
};
describe('Settings controls', () => {
  it('renders the section menu with all permitted sections', () => {
    const html = renderToStaticMarkup(
      createElement(SettingsWorkspace, {
        view: {
          account: { name: 'Owner', email: null },
          context: {
            status: 'ready',
            organisation: { id: 't', name: 'Tenant' },
            legalEntities: [],
            selectedStation: null,
          },
          staff: overview,
        },
      }),
    );
    expect(html).toContain('aria-label="Settings section: Organisation"');
    expect(html).toContain('<span>Staff</span>');
    expect(html).toContain('<span>Account</span>');
  });
  it('does not expose management section choices without management permission', () => {
    const html = renderToStaticMarkup(
      createElement(SettingsWorkspace, {
        view: {
          account: { name: 'Staff', email: null },
          context: {
            status: 'ready',
            organisation: { id: 't', name: 'Tenant' },
            legalEntities: [],
            selectedStation: null,
          },
        },
      }),
    );
    expect(html).not.toContain('<span>Staff</span>');
  });
  it('renders role/status controls and the matching station staff', () => {
    const html = renderToStaticMarkup(
      createElement(StaffPanel, { tenantId: 't', overview, selectedStationId: 'a' }),
    );
    expect(html).toContain('All roles');
    expect(html).toContain('Filter staff');
    expect(html).toContain('Alpha attendant');
    expect(html).toContain('1 staff matching this station');
  });
  it('excludes staff assigned only to a different station', () => {
    const html = renderToStaticMarkup(
      createElement(StaffPanel, { tenantId: 't', overview, selectedStationId: 'b' }),
    );
    expect(html).not.toContain('Alpha attendant');
    expect(html).toContain('0 staff matching this station');
  });
});

it('renders the styled section disclosure without a native select', () => {
  const html = renderToStaticMarkup(
    createElement(SettingsSectionMenu, {
      items: [
        { value: 'organisation', label: 'Organisation', icon: 'building' },
        { value: 'staff', label: 'Staff', icon: 'users' },
      ],
      active: { value: 'staff', label: 'Staff', icon: 'users' },
      onSelect: () => {},
    }),
  );
  expect(html).toContain('<details');
  expect(html).toContain('<summary');
  expect(html).toContain('aria-current="page"');
  expect(html).not.toContain('<select');
  if (process.env.SETTINGS_MENU_FIXTURE) {
    const normalized = html.replace(/_([A-Za-z]+)_[a-f0-9]+/g, '$1');
    writeFileSync('/private/tmp/shanda-settings-menu.html', normalized);
  }
});

it('lists authorized stations in all-stations mode and narrows selected details', () => {
  const station = { id: 'a', name: 'Alpha', code: 'AL', timezone: 'Africa/Harare' };
  const other = { ...station, id: 'b', name: 'Beta' };
  const context = {
    status: 'ready' as const,
    legalEntities: [],
    selectedStation: null,
    stations: [station, other],
  };
  const all = renderToStaticMarkup(createElement(SettingsStations, { context }));
  expect(all).toContain('Alpha');
  expect(all).toContain('Beta');
  expect(all).not.toContain('Choose a station');
  const selected = renderToStaticMarkup(
    createElement(SettingsStations, { context: { ...context, selectedStation: station } }),
  );
  expect(selected).toContain('Alpha');
  expect(selected).not.toContain('Beta');
  const empty = renderToStaticMarkup(
    createElement(SettingsStations, { context: { ...context, stations: [] } }),
  );
  expect(empty).toContain('No stations are available');
});

it('uses setup capabilities independently of staff invitation access', () => {
  const view = {
    account: { name: 'Finance', email: null },
    context: {
      status: 'ready' as const,
      organisation: { id: 't', name: 'Tenant' },
      legalEntities: [],
      selectedStation: null,
    },
    access: { canViewPayments: true, canViewReadiness: false },
  };
  const html = renderToStaticMarkup(createElement(SettingsWorkspace, { view }));
  expect(html).toContain('<span>Payments</span>');
  expect(html).not.toContain('<span>Readiness</span>');
  expect(html).not.toContain('<span>Staff</span>');
  expect(html).not.toContain('Ask your administrator');
  const denied = renderToStaticMarkup(
    createElement(SettingsWorkspace, {
      view: { ...view, access: { canViewPayments: false, canViewReadiness: true } },
    }),
  );
  expect(denied).not.toContain('<span>Payments</span>');
  expect(denied).toContain('<span>Readiness</span>');
});
