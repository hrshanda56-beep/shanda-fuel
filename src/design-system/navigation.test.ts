import { describe, expect, it } from 'vitest';

import {
  mobileNavigation,
  primaryNavigation,
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
});
