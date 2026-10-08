import type { IconName } from './icons';

/**
 * Product Shell navigation model.
 *
 * This is the one product-destination registry. Sidebar entries, the command
 * palette, and future breadcrumb integration all consume the same typed
 * labels, routes, icons, groups, and availability semantics.
 *
 * Everything here is presentation. Visibility comes from a projection the
 * authorization layer supplies; the server remains authoritative for access.
 */

export type NavigationKey =
  | 'today'
  | 'daily-operations'
  | 'reconciliations'
  | 'inventory'
  | 'cash'
  | 'settlements'
  | 'customers'
  | 'suppliers'
  | 'reports'
  | 'settings';

export type NavigationSectionKey =
  'today' | 'operations' | 'finance' | 'suppliers' | 'reports' | 'settings';

export type NavigationProjection = {
  key: NavigationKey;
  visible: boolean;
  enabled: boolean;
};

type NavigationDestination =
  /** A route that works without a station in the path. */
  | { kind: 'route'; path: string }
  /** A route under /stations/[stationId]/…; needs a station in context. */
  | { kind: 'station-route'; segment: string }
  /** A planned area without a screen yet. */
  | { kind: 'wip'; message?: string };

export type NavigationItem = {
  key: NavigationKey;
  label: string;
  searchLabel: string;
  icon: IconName;
  destination: NavigationDestination;
  availability: 'active' | 'station-context' | 'planned';
  /** Pathnames that count as "inside" this item, for current-route indication. */
  match: readonly RegExp[];
};

export type NavigationSection = {
  key: NavigationSectionKey;
  label: string;
  icon: IconName;
  items: readonly NavigationItem[];
  /** Settings sits apart at the foot of the navigation. */
  placement?: 'end';
};

export const navigationSections: readonly NavigationSection[] = [
  {
    key: 'today',
    label: 'Today',
    icon: 'today',
    items: [
      {
        key: 'today',
        label: 'Today',
        searchLabel: 'Today',
        icon: 'today',
        destination: { kind: 'route', path: '/' },
        availability: 'active',
        match: [/^\/$/],
      },
    ],
  },
  {
    key: 'operations',
    label: 'Operations',
    icon: 'fuel',
    items: [
      {
        key: 'daily-operations',
        label: 'Daily operations',
        searchLabel: 'Daily operations',
        icon: 'fuel',
        destination: { kind: 'route', path: '/operations/daily' },
        availability: 'active',
        match: [/^\/operations\/daily(\/|$)/],
      },
      {
        key: 'reconciliations',
        label: 'Reconciliations',
        searchLabel: 'Reconciliations',
        icon: 'check-circle',
        destination: { kind: 'station-route', segment: 'reconciliations' },
        availability: 'station-context',
        match: [
          /^\/operations\/reconciliations(\/|$)/,
          /^\/stations\/[^/]+\/reconciliations(\/|$)/,
        ],
      },
      {
        key: 'inventory',
        label: 'Inventory',
        searchLabel: 'Inventory',
        icon: 'inbox',
        destination: { kind: 'route', path: '/inventory/valuation' },
        availability: 'active',
        match: [/^\/inventory(\/|$)/],
      },
    ],
  },
  {
    key: 'finance',
    label: 'Finance',
    icon: 'wallet',
    items: [
      {
        key: 'cash',
        label: 'Cash and banking',
        searchLabel: 'Cash and banking',
        icon: 'wallet',
        destination: { kind: 'station-route', segment: 'cash' },
        availability: 'station-context',
        match: [/^\/stations\/[^/]+\/cash(\/|$)/],
      },
      {
        key: 'settlements',
        label: 'Provider settlements',
        searchLabel: 'Provider settlements',
        icon: 'wallet',
        destination: { kind: 'station-route', segment: 'settlements' },
        availability: 'station-context',
        match: [/^\/stations\/[^/]+\/settlements(\/|$)/],
      },
      {
        key: 'customers',
        label: 'Customers',
        searchLabel: 'Customers',
        icon: 'users',
        destination: { kind: 'route', path: '/customers' },
        availability: 'active',
        match: [/^\/customers(\/|$)/],
      },
    ],
  },
  {
    key: 'suppliers',
    label: 'Suppliers',
    icon: 'truck',
    items: [
      {
        key: 'suppliers',
        label: 'Suppliers',
        searchLabel: 'Suppliers',
        icon: 'truck',
        destination: { kind: 'route', path: '/suppliers' },
        availability: 'active',
        match: [/^\/suppliers(\/|$)/],
      },
    ],
  },
  {
    key: 'reports',
    label: 'Reports',
    icon: 'chart',
    items: [
      {
        key: 'reports',
        label: 'Reports',
        searchLabel: 'Reports',
        icon: 'chart',
        destination: { kind: 'route', path: '/reports' },
        availability: 'active',
        match: [/^\/reports(\/|$)/],
      },
    ],
  },
  {
    key: 'settings',
    label: 'Settings',
    icon: 'settings',
    placement: 'end',
    items: [
      {
        key: 'settings',
        label: 'Settings',
        searchLabel: 'Settings',
        icon: 'settings',
        destination: { kind: 'route', path: '/settings' },
        availability: 'active',
        match: [/^\/settings(\/|$)/],
      },
    ],
  },
];

/**
 * Presentation contract only. A1/platform authorization maps canonical
 * permissions to these stable UI keys before the projection reaches AppShell.
 */
export const syntheticNavigationProjection: readonly NavigationProjection[] = navigationSections
  .flatMap((section) => section.items)
  .map((item) => ({ key: item.key, visible: true, enabled: true }));

/* Work context ------------------------------------------------------------ */

/**
 * Identifiers the current URL already carries. Navigation forwards them so
 * moving between areas keeps the same tenant/station scope. They are not
 * grants: every page and API re-validates them server-side.
 */
export type WorkContext = {
  tenantId?: string;
  legalEntityId?: string;
  stationId?: string;
};

const FORWARDED_PARAMS = ['tenantId', 'legalEntityId'] as const;

export function readWorkContext(
  pathname: string | null,
  searchParams: Pick<URLSearchParams, 'get'> | null,
): WorkContext {
  const context: WorkContext = {};
  for (const name of FORWARDED_PARAMS) {
    const value = searchParams?.get(name);
    if (value) context[name] = value;
  }
  const stationInPath = pathname?.match(/^\/stations\/([^/]+)/)?.[1];
  const stationId = stationInPath ? safeDecode(stationInPath) : searchParams?.get('stationId');
  if (stationId) context.stationId = stationId;
  return context;
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/* Resolution -------------------------------------------------------------- */

type ResolvedItemBase = Omit<NavigationItem, 'destination'>;

export type ResolvedNavigationItem =
  | (ResolvedItemBase & { state: 'link'; href: string })
  /** Opens the standard work-in-progress dialog; never navigates. */
  | (ResolvedItemBase & {
      state: 'wip';
      /** `planned`: no screen yet. `station`: the screen needs a station in context. */
      reason: 'planned' | 'station';
      feature: string;
      message?: string;
    })
  /** Projected as visible but not permitted: shown, not interactive. */
  | (ResolvedItemBase & { state: 'restricted' });

export type ResolvedNavigationSection = Omit<NavigationSection, 'items'> & {
  items: ResolvedNavigationItem[];
};

export function stationSelectionMessage(label: string) {
  return `${label} requires an authorised station. Use the shared context selector to choose one. Nothing has been changed.`;
}

export function resolveNavigationItem(
  item: NavigationItem,
  context: WorkContext,
  enabled = true,
): ResolvedNavigationItem {
  const { destination, ...rest } = item;
  if (!enabled) return { ...rest, state: 'restricted' };

  switch (destination.kind) {
    case 'wip':
      return {
        ...rest,
        state: 'wip',
        reason: 'planned',
        feature: item.label,
        message: destination.message,
      };
    case 'station-route': {
      if (!context.stationId) {
        return {
          ...rest,
          state: 'wip',
          reason: 'station',
          feature: 'Station selection',
          message: stationSelectionMessage(item.label),
        };
      }
      const path = `/stations/${encodeURIComponent(context.stationId)}/${destination.segment}`;
      return { ...rest, state: 'link', href: withQuery(path, context, false) };
    }
    case 'route':
      return { ...rest, state: 'link', href: withQuery(destination.path, context, true) };
  }
}

function withQuery(path: string, context: WorkContext, includeStation: boolean) {
  const query = new URLSearchParams();
  for (const name of FORWARDED_PARAMS) {
    const value = context[name];
    if (value) query.set(name, value);
  }
  if (includeStation && context.stationId) query.set('stationId', context.stationId);
  const search = query.toString();
  return search ? `${path}?${search}` : path;
}

export function resolveNavigation(
  projection: readonly NavigationProjection[],
  context: WorkContext,
  sections: readonly NavigationSection[] = navigationSections,
): ResolvedNavigationSection[] {
  const byKey = new Map(projection.map((entry) => [entry.key, entry]));
  return sections.flatMap((section) => {
    const items = section.items.flatMap((item) => {
      const state = byKey.get(item.key);
      if (!state?.visible) return [];
      return [resolveNavigationItem(item, context, state.enabled)];
    });
    return items.length > 0 ? [{ ...section, items }] : [];
  });
}

/**
 * The phone bottom bar holds the three everyday destinations; everything else
 * lives behind "More". Short labels keep each tab on a single line.
 */
const MOBILE_NAVIGATION_ITEMS: readonly { key: NavigationKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'daily-operations', label: 'Daily ops' },
  { key: 'customers', label: 'Customers' },
];

export type MobileNavigationItem = Extract<ResolvedNavigationItem, { state: 'link' }> & {
  mobileLabel: string;
};

/**
 * Selects the compact phone navigation from the already-authorized links.
 *
 * The bottom bar is a presentation of the resolved navigation projection: it
 * never turns a work-in-progress, restricted, or station-less destination
 * into a link, and it never promotes other destinations to fill a gap. Every
 * destination stays reachable from the More menu.
 */
export function selectMobileNavigationItems(
  sections: readonly ResolvedNavigationSection[],
): MobileNavigationItem[] {
  const links = new Map(
    sections
      .flatMap((section) => section.items)
      .flatMap((item) => (item.state === 'link' ? [[item.key, item] as const] : [])),
  );
  return MOBILE_NAVIGATION_ITEMS.flatMap(({ key, label }) => {
    const item = links.get(key);
    return item ? [{ ...item, mobileLabel: label }] : [];
  });
}

export function isNavigationItemActive(
  item: Pick<NavigationItem, 'match'>,
  pathname: string | null,
): boolean {
  if (!pathname) return false;
  return item.match.some((pattern) => pattern.test(pathname));
}

/** A section with one destination of the same name renders as a single link, not a group. */
export function isSingleDestinationSection(section: {
  label: string;
  items: readonly { label: string }[];
}) {
  return section.items.length === 1 && section.items[0]!.label === section.label;
}
