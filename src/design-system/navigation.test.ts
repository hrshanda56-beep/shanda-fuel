import { describe, expect, it } from 'vitest';

import {
  isNavigationItemActive,
  mobileNavigation,
  navigationGroups,
  primaryNavigation,
  projectNavigationGroups,
  projectNavigationItems,
  syntheticNavigationProjection,
} from './navigation';

describe('typed navigation projection', () => {
  it('renders only visible projected keys and preserves enabled state', () => {
    const items = projectNavigationItems(primaryNavigation, [
      { key: 'home', visible: true, enabled: true },
      { key: 'tasks', visible: false, enabled: false },
      { key: 'work', visible: true, enabled: false },
    ]);

    expect(items.map((item) => item.key)).toEqual(['home', 'work']);
    expect(items[1]?.enabled).toBe(false);
  });

  it('does not interpret raw permission identifiers in the design system', () => {
    expect(
      syntheticNavigationProjection.every((item) => 'key' in item && !('permission' in item)),
    ).toBe(true);
  });

  it('keeps the mobile model limited to Home, Tasks, Work and More', () => {
    expect(mobileNavigation.map((item) => item.mobileLabel)).toEqual([
      'Home',
      'Tasks',
      'Work',
      'More',
    ]);
  });

  it('drops groups whose items are all hidden', () => {
    const groups = projectNavigationGroups(navigationGroups, [
      { key: 'reports', visible: true, enabled: true },
    ]);
    expect(groups.map((group) => group.id)).toEqual(['insights']);
  });

  it('uses business groupings without a sidebar search entry', () => {
    expect(navigationGroups.map((group) => group.label)).toEqual([
      'Operations',
      'Finance',
      'Partners',
      'Insights',
    ]);
    expect(primaryNavigation.some((item) => /search/i.test(item.label))).toBe(false);
  });

  it('matches the active item by exact path or declared prefix', () => {
    const work = primaryNavigation.find((item) => item.key === 'work')!;
    const home = primaryNavigation.find((item) => item.key === 'home')!;
    const tasks = primaryNavigation.find((item) => item.key === 'tasks')!;
    expect(isNavigationItemActive(work, '/operations/reconciliations/abc')).toBe(true);
    expect(isNavigationItemActive(work, '/operationsx')).toBe(false);
    expect(isNavigationItemActive(home, '/')).toBe(true);
    expect(isNavigationItemActive(home, '/reports')).toBe(false);
    expect(isNavigationItemActive(tasks, '/')).toBe(false);
  });
});
