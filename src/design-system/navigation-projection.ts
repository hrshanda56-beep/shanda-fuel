import type { AuthorizationActor, PermissionCode } from '../platform/security';
import { isPermissionGranted } from '../platform/security/permissions';
import type { NavigationKey, NavigationProjection } from './navigation';

type NavigationScope = {
  tenantId: string;
  scopeType: 'TENANT' | 'LEGAL_ENTITY' | 'STATION';
  legalEntityId?: string;
  stationId?: string;
};

export type NavigationProjectionInput = Readonly<{
  actor: AuthorizationActor;
  scope: NavigationScope;
}>;

export const E2E_NAVIGATION_FIXTURE_HEADER = 'x-shanda-e2e-navigation-fixture';

export function allowsE2ENavigationFixture(
  appEnv: string | undefined,
  header: string | null,
  nodeEnv: string | undefined = process.env.NODE_ENV,
) {
  return nodeEnv !== 'production' && appEnv === 'test' && header === 'synthetic';
}

const NAVIGATION_PERMISSION_CANDIDATES: Readonly<Record<NavigationKey, readonly PermissionCode[]>> =
  {
    'my-shift': [],
    today: ['business_day.view'],
    'daily-operations': ['business_day.view'],
    reconciliations: ['reconciliation.view'],
    inventory: ['inventory.view'],
    cash: ['cash.collection.view', 'cash.deposit.view'],
    settlements: ['provider.settlement.view'],
    customers: ['customer.view'],
    suppliers: ['supplier.view'],
    reports: ['report.view'],
    settings: ['tenant.view'],
  };

/** Permissions that make up the attendant's own work; none of them is management. */
const ATTENDANT_WORKSPACE_PERMISSIONS: readonly PermissionCode[] = [
  'station.view',
  'shift.view',
  'meter.view',
];

/**
 * An actor whose resolved permissions cover shift/meter work but none of the
 * management destinations lands on My Shift. This is decided from permissions,
 * never from a role name, and it never grants anything: the page and its data
 * route authorise again.
 */
export function isAttendantWorkspaceActor({ actor, scope }: NavigationProjectionInput): boolean {
  const granted = (permissionCode: PermissionCode) =>
    isPermissionGranted({ actor, permissionCode, requestedScope: scope });
  if (!ATTENDANT_WORKSPACE_PERMISSIONS.every(granted)) return false;
  return !MANAGEMENT_NAVIGATION_KEYS.some((key) =>
    NAVIGATION_PERMISSION_CANDIDATES[key].some(granted),
  );
}

const MANAGEMENT_NAVIGATION_KEYS = (
  Object.keys(NAVIGATION_PERMISSION_CANDIDATES) as NavigationKey[]
).filter((key) => key !== 'my-shift');

export function buildNavigationProjection({
  actor,
  scope,
}: NavigationProjectionInput): readonly NavigationProjection[] {
  const attendantWorkspace = isAttendantWorkspaceActor({ actor, scope });
  return (Object.keys(NAVIGATION_PERMISSION_CANDIDATES) as NavigationKey[]).map((key) => {
    if (key === 'my-shift')
      return { key, visible: attendantWorkspace, enabled: attendantWorkspace };
    const visible = NAVIGATION_PERMISSION_CANDIDATES[key].some((permissionCode) =>
      isPermissionGranted({ actor, permissionCode, requestedScope: scope }),
    );
    return { key, visible, enabled: visible };
  });
}

export const emptyNavigationProjection: readonly NavigationProjection[] = (
  Object.keys(NAVIGATION_PERMISSION_CANDIDATES) as NavigationKey[]
).map((key) => ({ key, visible: false, enabled: false }));
