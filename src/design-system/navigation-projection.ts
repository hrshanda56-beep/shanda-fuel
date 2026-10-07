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

export function buildNavigationProjection({
  actor,
  scope,
}: NavigationProjectionInput): readonly NavigationProjection[] {
  return (Object.keys(NAVIGATION_PERMISSION_CANDIDATES) as NavigationKey[]).map((key) => {
    const visible = NAVIGATION_PERMISSION_CANDIDATES[key].some((permissionCode) =>
      isPermissionGranted({ actor, permissionCode, requestedScope: scope }),
    );
    return { key, visible, enabled: visible };
  });
}

export const emptyNavigationProjection: readonly NavigationProjection[] = (
  Object.keys(NAVIGATION_PERMISSION_CANDIDATES) as NavigationKey[]
).map((key) => ({ key, visible: false, enabled: false }));
