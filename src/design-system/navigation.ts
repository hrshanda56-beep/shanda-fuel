import type { IconName } from './icons';

/**
 * Product Shell navigation model.
 *
 * Sections follow the locked business grouping in docs/release-readiness.md:
 * Today, Operations, Finance, Customers, Suppliers, Reports, Settings. Only
 * routes that exist are linked. Planned areas without a screen stay visible
 * and open the standard work-in-progress dialog; nothing is a dead link.
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
  'today' | 'operations' | 'finance' | 'customers' | 'suppliers' | 'reports' | 'settings';

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
  icon: IconName;
  destination: NavigationDestination;
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
        icon: 'today',
        destination: { kind: 'route', path: '/' },
        match: [/^\/$/, /^\/today(\/|$)/],
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
        icon: 'fuel',
        destination: { kind: 'route', path: '/operations/daily' },
        match: [/^\/operations\/daily(\/|$)/],
      },
      {
        key: 'reconciliations',
        label: 'Reconciliations',
        icon: 'check-circle',
        destination: { kind: 'station-route', segment: 'reconciliations' },
        match: [
          /^\/operations\/reconciliations(\/|$)/,
          /^\/stations\/[^/]+\/reconciliations(\/|$)/,
        ],
      },
      {
        key: 'inventory',
        label: 'Inventory',
        icon: 'inbox',
        destination: { kind: 'route', path: '/inventory/valuation' },
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
        icon: 'wallet',
        destination: { kind: 'station-route', segment: 'cash' },
        match: [/^\/stations\/[^/]+\/cash(\/|$)/],
      },
      {
        key: 'settlements',
        label: 'Provider settlements',
        icon: 'wallet',
        destination: { kind: 'station-route', segment: 'settlements' },
        match: [/^\/stations\/[^/]+\/settlements(\/|$)/],
      },
    ],
  },
  {
    key: 'customers',
    label: 'Customers',
    icon: 'users',
    items: [
      {
        key: 'customers',
        label: 'Customers',
        icon: 'users',
        destination: {
          kind: 'wip',
          message:
            'Customer accounts, statements and credit are still being completed. This is where they will live. Nothing has been changed.',
        },
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
        icon: 'truck',
        destination: { kind: 'route', path: '/suppliers' },
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
        icon: 'chart',
        destination: { kind: 'route', path: '/reports' },
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
        icon: 'settings',
        destination: {
          kind: 'wip',
          message:
            'Organisation, station and user settings are still being completed. This is where they will live. Nothing has been changed.',
        },
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
  return `${label} opens for one station at a time. Choosing a station from the menu is still being completed, so open it from a station link for now. Nothing has been changed.`;
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
