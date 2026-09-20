import { describe, expect, it } from 'vitest';

import { filterNavigationItems, mobileNavigation, primaryNavigation } from './navigation';

describe('permission-aware navigation', () => {
  it('keeps public navigation and removes items without the required permission', () => {
    const items = filterNavigationItems(primaryNavigation, new Set(['operations:view']));

    expect(items.map((item) => item.label)).toEqual(['Home', 'Operations']);
  });

  it('does not treat role names as navigation authority', () => {
    const items = filterNavigationItems(primaryNavigation, new Set());

    expect(items).toHaveLength(1);
    expect(items[0]?.label).toBe('Home');
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
