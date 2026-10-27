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

/**
 * The synthetic navigation/My Shift fixture bypasses session and authorization to
 * render a screen against mocked data routes. It is for local and CI browser tests
 * only, so every condition must hold (fail closed on anything else):
 *   - the request carries the explicit `synthetic` header,
 *   - APP_ENV is exactly `test`,
 *   - NODE_ENV is exactly `development` (`next dev`; never a built or started app,
 *     and not an unset, `test` or mistyped value),
 *   - the app is not running on Vercel, and
 *   - APP_URL is a plain-HTTP loopback address (deployed environments must be
 *     HTTPS and non-loopback), or unset (the local default).
 */
export function allowsE2ENavigationFixture(
  appEnv: string | undefined,
  header: string | null,
  nodeEnv: string | undefined = process.env.NODE_ENV,
  appUrl: string | undefined = process.env.APP_URL,
  vercel: string | undefined = process.env.VERCEL,
) {
  return (
    header === 'synthetic' &&
    appEnv === 'test' &&
    nodeEnv === 'development' &&
    !vercel &&
    isLoopbackAppUrl(appUrl)
  );
}

function isLoopbackAppUrl(appUrl: string | undefined) {
  if (appUrl === undefined) return true;
  try {
    const url = new URL(appUrl);
    return url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

/** Sign-off work that makes up a finance person's day. */
const FINANCE_SIGN_OFF_PERMISSIONS: readonly PermissionCode[] = [
  'reconciliation.approve',
  'cash.deposit.confirm',
  'provider.settlement.post',
];

/** Running the forecourt day; someone who does this keeps the operations Today as their home. */
const DAY_RUNNING_PERMISSIONS: readonly PermissionCode[] = [
  'business_day.open',
  'reconciliation.submit',
];

const NAVIGATION_PERMISSION_CANDIDATES: Readonly<Record<NavigationKey, readonly PermissionCode[]>> =
  {
    'my-shift': [],
    // A supervisor approves closes too, but that does not make the Finance overview theirs.
    'finance-home': FINANCE_SIGN_OFF_PERMISSIONS.filter(
      (permissionCode) => permissionCode !== 'reconciliation.approve',
    ),
    today: ['business_day.view'],
    'daily-operations': ['business_day.view'],
    reconciliations: ['reconciliation.view'],
    inventory: ['inventory.view'],
    cash: ['cash.collection.view', 'cash.deposit.view'],
    settlements: ['provider.settlement.view'],
    // Customer accounts are read across the organisation, so a station supervisor does not get them.
    customers: ['customer.payment.record'],
    suppliers: ['supplier.view'],
    purchasing: ['purchase_order.view'],
    expenses: ['expense.view'],
    profitability: ['report.finance.view'],
    'daily-profit': ['report.finance.view'],
    'financial-position': ['report.finance.view'],
    'fuel-deliveries': ['inventory.view'],
    'staff-benefit': ['customer.payment.record'],
    'payments-due': ['supplier.view'],
    reports: ['report.view'],
    // A supervisor reaches Settings only for their station's staff list and activity log.
    settings: ['tenant.view', 'membership.view.station', 'audit.view.station'],
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

/**
 * Finance sign-off work without running the forecourt day lands on the Finance overview.
 * Decided from permissions, never a role name; it grants nothing.
 */
export function isFinanceWorkspaceActor({ actor, scope }: NavigationProjectionInput): boolean {
  const granted = (permissionCode: PermissionCode) =>
    isPermissionGranted({ actor, permissionCode, requestedScope: scope });
  return FINANCE_SIGN_OFF_PERMISSIONS.some(granted) && !DAY_RUNNING_PERMISSIONS.some(granted);
}

export function buildNavigationProjection({
  actor,
  scope,
}: NavigationProjectionInput): readonly NavigationProjection[] {
  const attendantWorkspace = isAttendantWorkspaceActor({ actor, scope });
  const financeWorkspace = isFinanceWorkspaceActor({ actor, scope });
  return (Object.keys(NAVIGATION_PERMISSION_CANDIDATES) as NavigationKey[]).map((key) => {
    if (key === 'my-shift')
      return { key, visible: attendantWorkspace, enabled: attendantWorkspace };
    // The Finance overview replaces Today as that person's home, so Today would only bounce back.
    const visible =
      !(key === 'today' && financeWorkspace) &&
      NAVIGATION_PERMISSION_CANDIDATES[key].some((permissionCode) =>
        isPermissionGranted({ actor, permissionCode, requestedScope: scope }),
      );
    return key === 'finance-home' && financeWorkspace
      ? { key, visible, enabled: visible, home: true }
      : { key, visible, enabled: visible };
  });
}

export const emptyNavigationProjection: readonly NavigationProjection[] = (
  Object.keys(NAVIGATION_PERMISSION_CANDIDATES) as NavigationKey[]
).map((key) => ({ key, visible: false, enabled: false }));
