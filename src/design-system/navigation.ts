import type { IconName } from './icons';

/**
 * Stable UI navigation keys. The authorization layer maps canonical
 * permissions to these keys before the projection reaches AppShell.
 */
export type NavigationKey =
  | 'home'
  | 'tasks'
  | 'work'
  | 'deliveries'
  | 'stock'
  | 'pricing'
  | 'money'
  | 'settlements'
  | 'reconciliations'
  | 'expenses'
  | 'customers'
  | 'suppliers'
  | 'reports'
  | 'more';

export type NavigationProjection = {
  key: NavigationKey;
  visible: boolean;
  enabled: boolean;
};

export type NavigationItem = {
  key: NavigationKey;
  label: string;
  icon: IconName;
  /** Destination. Omitted while the area is still being built: the shell opens the WIP dialog. */
  href?: string;
  /** Path prefixes that also mark this item active. */
  matches?: readonly string[];
  mobileLabel?: string;
};

export type NavigationGroup = {
  id: string;
  label: string;
  items: readonly NavigationItem[];
};

export type ProjectedNavigationItem = NavigationItem & {
  enabled: boolean;
};

export type ProjectedNavigationGroup = Omit<NavigationGroup, 'items'> & {
  items: ProjectedNavigationItem[];
};

export const dashboardItem: NavigationItem = {
  key: 'home',
  label: 'Dashboard',
  icon: 'dashboard',
  href: '/',
  mobileLabel: 'Home',
};

export const settingsItem: NavigationItem = {
  key: 'more',
  label: 'Settings',
  icon: 'settings',
  mobileLabel: 'More',
};

/** ADR-015 grouping. Business language, not module names. */
export const navigationGroups: readonly NavigationGroup[] = [
  {
    id: 'operations',
    label: 'Operations',
    items: [
      {
        key: 'tasks',
        label: 'Needs attention',
        icon: 'alert',
        href: '/#needs-attention',
        mobileLabel: 'Tasks',
      },
      {
        key: 'work',
        label: 'Shifts & readings',
        icon: 'clock',
        href: '/operations/daily',
        matches: ['/operations'],
        mobileLabel: 'Work',
      },
      { key: 'deliveries', label: 'Deliveries', icon: 'truck' },
      {
        key: 'stock',
        label: 'Tanks & stock',
        icon: 'drop',
        href: '/inventory/valuation',
        matches: ['/inventory'],
      },
      { key: 'pricing', label: 'Pricing', icon: 'tag' },
    ],
  },
  {
    id: 'finance',
    label: 'Finance',
    items: [
      { key: 'money', label: 'Cash & banking', icon: 'wallet' },
      { key: 'settlements', label: 'Settlements', icon: 'card' },
      { key: 'reconciliations', label: 'Reconciliations', icon: 'scale' },
      { key: 'expenses', label: 'Expenses', icon: 'receipt' },
    ],
  },
  {
    id: 'partners',
    label: 'Partners',
    items: [
      { key: 'customers', label: 'Customers', icon: 'users' },
      { key: 'suppliers', label: 'Suppliers', icon: 'building', href: '/suppliers' },
    ],
  },
  {
    id: 'insights',
    label: 'Insights',
    items: [{ key: 'reports', label: 'Reports', icon: 'chart', href: '/reports' }],
  },
];

/** Every destination in sidebar order, for projection and search. */
export const primaryNavigation: readonly NavigationItem[] = [
  dashboardItem,
  ...navigationGroups.flatMap((group) => group.items),
  settingsItem,
];

function itemByKey(key: NavigationKey) {
  const item = primaryNavigation.find((candidate) => candidate.key === key);
  if (!item) throw new Error(`Unknown navigation key ${key}`);
  return item;
}

/** Phones get four quick destinations; "More" opens the full grouped list. */
export const mobileNavigation: readonly NavigationItem[] = [
  itemByKey('home'),
  itemByKey('tasks'),
  itemByKey('work'),
  itemByKey('more'),
];

/**
 * Presentation contract only. A1/platform authorization maps canonical
 * permissions to these stable UI keys before the projection reaches AppShell.
 */
export const syntheticNavigationProjection: readonly NavigationProjection[] = primaryNavigation.map(
  (item) => ({ key: item.key, visible: true, enabled: true }),
);

export function projectNavigationItems(
  items: readonly NavigationItem[],
  projection: readonly NavigationProjection[],
): ProjectedNavigationItem[] {
  const byKey = new Map(projection.map((item) => [item.key, item]));

  return items.flatMap((item) => {
    const state = byKey.get(item.key);
    if (!state?.visible) return [];
    return [{ ...item, enabled: state.enabled }];
  });
}

/** Projects each group and drops groups left empty. */
export function projectNavigationGroups(
  groups: readonly NavigationGroup[],
  projection: readonly NavigationProjection[],
): ProjectedNavigationGroup[] {
  return groups.flatMap((group) => {
    const items = projectNavigationItems(group.items, projection);
    return items.length > 0 ? [{ ...group, items }] : [];
  });
}

/** Whether a navigation item represents the current route. In-page anchors never do. */
export function isNavigationItemActive(item: NavigationItem, pathname: string | null) {
  if (!item.href || !pathname || item.href.includes('#')) return false;
  if (item.href === '/') return pathname === '/';
  if (pathname === item.href) return true;
  return (item.matches ?? []).some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
