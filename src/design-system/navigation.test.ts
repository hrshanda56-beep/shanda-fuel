import { describe, expect, it } from 'vitest';

import {
  isNavigationItemActive,
  isSingleDestinationSection,
  navigationSections,
  readWorkContext,
  resolveNavigation,
  syntheticNavigationProjection,
  type NavigationProjection,
} from './navigation';

const allItems = navigationSections.flatMap((section) => section.items);
const item = (key: string) => allItems.find((entry) => entry.key === key)!;

describe('grouped navigation model', () => {
  it('follows the locked business grouping', () => {
    expect(navigationSections.map((section) => section.label)).toEqual([
      'Today',
      'Operations',
      'Finance',
      'Customers',
      'Suppliers',
      'Reports',
      'Settings',
    ]);
  });

  it('renders single-destination sections as links and multi-item sections as groups', () => {
    expect(
      navigationSections.filter((s) => !isSingleDestinationSection(s)).map((s) => s.key),
    ).toEqual(['operations', 'finance']);
  });

  it('uses unique keys so projections are unambiguous', () => {
    const keys = allItems.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('navigation projection', () => {
  it('hides items that are not visible and drops empty sections', () => {
    const projection: NavigationProjection[] = syntheticNavigationProjection.map((entry) =>
      entry.key === 'cash' || entry.key === 'settlements' ? { ...entry, visible: false } : entry,
    );
    const sections = resolveNavigation(projection, {});
    expect(sections.map((section) => section.key)).not.toContain('finance');
  });

  it('keeps permitted-but-disabled items visible as restricted, never as links', () => {
    const projection = syntheticNavigationProjection.map((entry) =>
      entry.key === 'reports' ? { ...entry, enabled: false } : entry,
    );
    const reports = resolveNavigation(projection, {}).find((s) => s.key === 'reports')!.items[0]!;
    expect(reports.state).toBe('restricted');
    expect('href' in reports).toBe(false);
  });

  it('does not interpret raw permission identifiers in the design system', () => {
    expect(
      syntheticNavigationProjection.every((entry) => 'key' in entry && !('permission' in entry)),
    ).toBe(true);
  });
});

describe('navigation destinations', () => {
  const resolved = (context = {}) =>
    resolveNavigation(syntheticNavigationProjection, context).flatMap((section) => section.items);
  const find = (key: string, context = {}) => resolved(context).find((entry) => entry.key === key)!;

  it('routes planned areas to the work-in-progress dialog instead of dead links', () => {
    expect(find('customers')).toMatchObject({
      state: 'wip',
      reason: 'planned',
      feature: 'Customers',
    });
    expect(find('settings')).toMatchObject({ state: 'wip', feature: 'Settings' });
  });

  it('explains station selection when a station-scoped area has no station', () => {
    expect(find('cash')).toMatchObject({
      state: 'wip',
      reason: 'station',
      feature: 'Station selection',
    });
  });

  it('links station-scoped areas once a station is in context', () => {
    expect(find('cash', { stationId: 'st 1', tenantId: 't-1' })).toMatchObject({
      state: 'link',
      href: '/stations/st%201/cash?tenantId=t-1',
    });
  });

  it('forwards the current tenant, legal entity and station scope', () => {
    expect(
      find('reports', { tenantId: 't-1', legalEntityId: 'le-1', stationId: 's-1' }),
    ).toMatchObject({
      state: 'link',
      href: '/reports?tenantId=t-1&legalEntityId=le-1&stationId=s-1',
    });
    expect(find('today')).toMatchObject({ state: 'link', href: '/' });
  });
});

describe('work context', () => {
  it('reads forwarded identifiers from the URL and the station from the path first', () => {
    const params = new URLSearchParams('tenantId=t-1&stationId=query-station&other=x');
    expect(readWorkContext('/stations/path%20station/cash', params)).toEqual({
      tenantId: 't-1',
      stationId: 'path station',
    });
    expect(readWorkContext('/operations/daily', params)).toEqual({
      tenantId: 't-1',
      stationId: 'query-station',
    });
    expect(readWorkContext('/', null)).toEqual({});
  });
});

describe('current-route indication', () => {
  it.each([
    ['/', 'today'],
    ['/operations/daily', 'daily-operations'],
    ['/operations/reconciliations/abc/review', 'reconciliations'],
    ['/stations/demo/reconciliations/new', 'reconciliations'],
    ['/inventory/valuation/streams/t/p', 'inventory'],
    ['/stations/demo/cash', 'cash'],
    ['/stations/demo/settlements', 'settlements'],
    ['/suppliers', 'suppliers'],
    ['/reports', 'reports'],
  ])('%s marks %s as current', (pathname, key) => {
    const active = allItems.filter((entry) => isNavigationItemActive(entry, pathname));
    expect(active.map((entry) => entry.key)).toEqual([key]);
  });

  it('does not mark Today for nested routes', () => {
    expect(isNavigationItemActive(item('today'), '/reports')).toBe(false);
    expect(isNavigationItemActive(item('today'), null)).toBe(false);
  });
});
