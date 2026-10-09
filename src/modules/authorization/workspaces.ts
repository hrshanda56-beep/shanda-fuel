import {
  isPermissionGranted,
  type AccessScope,
  type AuthorizationActor,
  type PermissionCode,
  type RoleCode,
} from '../../platform/security';
import {
  navigationSections,
  type NavigationKey,
  type NavigationProjection,
} from '../../design-system/navigation';

export type WorkspaceScope = AccessScope;

type NavigationRequirement =
  | { kind: 'any'; permissions: readonly PermissionCode[] }
  | { kind: 'all'; permissions: readonly PermissionCode[] };

const navigationRequirements: Readonly<Record<NavigationKey, NavigationRequirement>> = {
  today: { kind: 'any', permissions: ['shift.view', 'meter.view'] },
  'daily-operations': { kind: 'all', permissions: ['business_day.view', 'shift.view'] },
  reconciliations: { kind: 'any', permissions: ['reconciliation.view'] },
  inventory: { kind: 'any', permissions: ['inventory.view'] },
  cash: { kind: 'any', permissions: ['cash.collection.view', 'cash.deposit.view'] },
  settlements: { kind: 'any', permissions: ['provider.view', 'provider.settlement.view'] },
  customers: { kind: 'any', permissions: ['customer.view'] },
  suppliers: { kind: 'any', permissions: ['supplier.view'] },
  reports: { kind: 'any', permissions: ['report.view'] },
  settings: {
    kind: 'any',
    permissions: [
      'tenant.manage',
      'legal_entity.manage',
      'station.manage',
      'membership.manage',
      'role.manage',
    ],
  },
};

const roleLandingPreference: Readonly<Record<RoleCode, readonly NavigationKey[]>> = {
  ATTENDANT: ['today'],
  SUPERVISOR: ['daily-operations', 'today'],
  FINANCE: ['reports', 'suppliers', 'customers', 'today'],
  ADMINISTRATOR: ['today', 'daily-operations', 'reports'],
  OWNER: ['today', 'daily-operations', 'reports'],
};

const rolePriority: readonly RoleCode[] = [
  'OWNER',
  'ADMINISTRATOR',
  'FINANCE',
  'SUPERVISOR',
  'ATTENDANT',
];

function permissionGranted(
  actor: AuthorizationActor,
  permission: PermissionCode,
  scopes: readonly WorkspaceScope[],
  now?: Date,
): boolean {
  return scopes.some((requestedScope) =>
    isPermissionGranted({ actor, permissionCode: permission, requestedScope, now }),
  );
}

function requirementGranted(
  actor: AuthorizationActor,
  requirement: NavigationRequirement,
  scopes: readonly WorkspaceScope[],
  now?: Date,
): boolean {
  return requirement.kind === 'all'
    ? requirement.permissions.every((permission) =>
        permissionGranted(actor, permission, scopes, now),
      )
    : requirement.permissions.some((permission) =>
        permissionGranted(actor, permission, scopes, now),
      );
}

/**
 * Build the serializable presentation projection from live server authority.
 * The projection is never used as an authorization check; destination pages
 * and APIs must still perform their own server-side checks.
 */
export function buildPermissionNavigationProjection(input: {
  actor: AuthorizationActor;
  scopes: readonly WorkspaceScope[];
  now?: Date;
}): readonly NavigationProjection[] {
  return navigationSections.flatMap((section) =>
    section.items.map((item) => ({
      key: item.key,
      visible: requirementGranted(
        input.actor,
        navigationRequirements[item.key],
        input.scopes,
        input.now,
      ),
      enabled: requirementGranted(
        input.actor,
        navigationRequirements[item.key],
        input.scopes,
        input.now,
      ),
    })),
  );
}

export function primaryRole(actor: AuthorizationActor, now = new Date()): RoleCode | undefined {
  const activeRoles = new Set(
    actor.roleAssignments
      .filter((assignment) => !assignment.expiresAt || assignment.expiresAt > now)
      .map((assignment) => assignment.roleCode),
  );
  return rolePriority.find((role) => activeRoles.has(role));
}

function hasNavigationKey(
  actor: AuthorizationActor,
  key: NavigationKey,
  scopes: readonly WorkspaceScope[],
  now?: Date,
) {
  return requirementGranted(actor, navigationRequirements[key], scopes, now);
}

/**
 * Resolve a landing destination using role defaults only as an ordering hint.
 * A role without its effective permissions cannot reach that role's default.
 */
export function resolveLandingPath(input: {
  actor: AuthorizationActor;
  scopes: readonly WorkspaceScope[];
  now?: Date;
}): string {
  const role = primaryRole(input.actor, input.now);
  const preferredKeys = role ? roleLandingPreference[role] : [];
  const fallbackKeys: readonly NavigationKey[] = [
    'daily-operations',
    'reports',
    'today',
    'suppliers',
  ];
  const keys = [...preferredKeys, ...fallbackKeys];

  for (const key of keys) {
    if (!hasNavigationKey(input.actor, key, input.scopes, input.now)) continue;
    if (key === 'today') return role === 'ATTENDANT' ? '/today' : '/';
    if (key === 'daily-operations') return '/operations/daily';
    if (key === 'reports') return '/reports';
    if (key === 'suppliers') return '/suppliers';
  }

  // A station-view-only actor still has a legitimate, context-first home.
  if (permissionGranted(input.actor, 'station.view', input.scopes, input.now)) return '/today';
  return '/login';
}

export function navigationRequirementFor(key: NavigationKey): NavigationRequirement {
  return navigationRequirements[key];
}
