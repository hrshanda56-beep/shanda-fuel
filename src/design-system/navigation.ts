export type NavigationKey = 'home' | 'tasks' | 'work' | 'money' | 'reports' | 'more';

export type NavigationProjection = {
  key: NavigationKey;
  visible: boolean;
  enabled: boolean;
};

export type NavigationItem = {
  key: NavigationKey;
  href: string;
  label: string;
  mobileLabel?: string;
  description: string;
};

export type ProjectedNavigationItem = NavigationItem & {
  enabled: boolean;
};

export const primaryNavigation = [
  {
    key: 'home',
    href: '/',
    label: 'Home',
    mobileLabel: 'Home',
    description: 'Business health and next actions',
  },
  {
    key: 'work',
    href: '/operations/daily',
    label: 'Operations',
    mobileLabel: 'Work',
    description: 'Station day, shifts and operations',
  },
  {
    key: 'tasks',
    href: '#actions',
    label: 'Action Center',
    mobileLabel: 'Tasks',
    description: 'Approvals, exceptions and follow-up',
  },
  {
    key: 'money',
    href: '#money',
    label: 'Money',
    mobileLabel: 'Money',
    description: 'Cash, banking and settlements',
  },
  {
    key: 'reports',
    href: '#reports',
    label: 'Reports',
    mobileLabel: 'Reports',
    description: 'Posted reports and explanations',
  },
  {
    key: 'more',
    href: '#settings',
    label: 'Settings',
    mobileLabel: 'More',
    description: 'Controlled configuration and access',
  },
] as const satisfies readonly NavigationItem[];

export const mobileNavigation = [
  primaryNavigation[0],
  primaryNavigation[2],
  primaryNavigation[1],
  primaryNavigation[5],
] as const satisfies readonly NavigationItem[];

/**
 * Presentation contract only. A1/platform authorization maps canonical
 * permissions to these stable UI keys before the projection reaches AppShell.
 */
export const syntheticNavigationProjection: readonly NavigationProjection[] = [
  { key: 'home', visible: true, enabled: true },
  { key: 'tasks', visible: true, enabled: true },
  { key: 'work', visible: true, enabled: true },
  { key: 'money', visible: true, enabled: true },
  { key: 'reports', visible: true, enabled: true },
  { key: 'more', visible: true, enabled: true },
];

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
