export type PermissionCode = string;

export type NavigationItem = {
  href: string;
  label: string;
  mobileLabel?: string;
  description: string;
  requiredPermission?: PermissionCode;
};

export const primaryNavigation = [
  {
    href: '/',
    label: 'Home',
    mobileLabel: 'Home',
    description: 'Business health and next actions',
  },
  {
    href: '#operations',
    label: 'Operations',
    mobileLabel: 'Work',
    description: 'Station day, shifts and operations',
    requiredPermission: 'operations:view',
  },
  {
    href: '#actions',
    label: 'Action Center',
    mobileLabel: 'Tasks',
    description: 'Approvals, exceptions and follow-up',
    requiredPermission: 'actions:view',
  },
  {
    href: '#money',
    label: 'Money',
    mobileLabel: 'Money',
    description: 'Cash, banking and settlements',
    requiredPermission: 'money:view',
  },
  {
    href: '#reports',
    label: 'Reports',
    mobileLabel: 'Reports',
    description: 'Posted reports and explanations',
    requiredPermission: 'reports:view',
  },
  {
    href: '#settings',
    label: 'Settings',
    mobileLabel: 'More',
    description: 'Controlled configuration and access',
    requiredPermission: 'settings:view',
  },
] as const satisfies readonly NavigationItem[];

export const mobileNavigation = [
  primaryNavigation[0],
  primaryNavigation[2],
  primaryNavigation[1],
  primaryNavigation[5],
] as const satisfies readonly NavigationItem[];

/**
 * The browser receives an already-authorized permission projection. It never
 * decides whether a command is allowed; server-side authorization remains the
 * source of truth for every authoritative action.
 */
export function filterNavigationItems(
  items: readonly NavigationItem[],
  grantedPermissions: ReadonlySet<PermissionCode>,
): NavigationItem[] {
  return items.filter(
    (item) => !item.requiredPermission || grantedPermissions.has(item.requiredPermission),
  );
}
