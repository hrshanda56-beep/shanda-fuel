'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import { WorkInProgressDialog } from './dialogs';
import { NeedsAttention, WipBadge, type AttentionItem } from './feedback';
import { Icon } from './icons';
import { Modal } from './modal';
import {
  isNavigationItemActive,
  isSingleDestinationSection,
  readWorkContext,
  resolveNavigation,
  type NavigationProjection,
  type ResolvedNavigationItem,
  type ResolvedNavigationSection,
} from './navigation';
import { IconButton } from './primitives';
import {
  parseClosedGroups,
  readClosedGroupsRaw,
  readSidebarCollapsed,
  setClosedGroupsRaw,
  setSidebarCollapsed,
  subscribeShellPreferences,
  toggleClosedGroup,
} from './shell-preferences';
import { ThemeControl } from './theme-control';

/* Types -------------------------------------------------------------------- */

export type ShellContext = {
  organisation: string;
  station: string;
  businessDate: string;
  shift?: string;
};

export type ShellBreadcrumb = { label: string; href?: string };

type AppShellProps = {
  children: ReactNode;
  /** Visibility per navigation key, projected by the authorization layer. */
  navigationProjection: readonly NavigationProjection[];
  /** The operating context the page works in, shown quietly above the content. */
  context?: ShellContext;
  role?: string;
  userName?: string;
  breadcrumbs?: readonly ShellBreadcrumb[];
  /**
   * Server-decided items that need attention. When provided, the shell shows
   * a compact "Needs attention" entry. The shell never invents items.
   */
  attention?: { items: readonly AttentionItem[]; viewAll?: ReactNode };
};

type WipRequest = { feature: string; message?: string };

/* Shell -------------------------------------------------------------------- */

/**
 * The permanent Shanda Fuel application shell.
 *
 * - Desktop (≥ 64rem): persistent grouped sidebar; can collapse to an icon
 *   rail (remembered per device and applied before first paint).
 * - Tablet and phone: a slim top bar whose menu opens the same grouped
 *   navigation in a drawer. Content keeps the full width.
 *
 * Navigation is presentation: visibility comes from `navigationProjection`
 * and every destination re-validates access on the server.
 */
export function AppShell({
  children,
  navigationProjection,
  context,
  role,
  userName,
  breadcrumbs = [],
  attention,
}: AppShellProps) {
  const pathname = usePathname();
  const search = useLocationSearch();
  const workContext = useMemo(
    () => readWorkContext(pathname, new URLSearchParams(search)),
    [pathname, search],
  );
  const sections = useMemo(
    () => resolveNavigation(navigationProjection, workContext),
    [navigationProjection, workContext],
  );
  const todayHref = findHref(sections, 'today') ?? '/';

  const collapsed = useSyncExternalStore(
    subscribeShellPreferences,
    readSidebarCollapsed,
    () => false,
  );
  const closedGroupsRaw = useSyncExternalStore(
    subscribeShellPreferences,
    readClosedGroupsRaw,
    () => '',
  );
  const closedGroups = useMemo(() => parseClosedGroups(closedGroupsRaw), [closedGroupsRaw]);

  // False during server render and hydration, true once client handlers are live.
  const hydrated = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [attentionOpen, setAttentionOpen] = useState(false);
  const [wip, setWip] = useState<WipRequest | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  const toggleGroup = useCallback(
    (key: string) => setClosedGroupsRaw(toggleClosedGroup(readClosedGroupsRaw(), key)),
    [],
  );

  // From the rail, a group opens the full sidebar with that group expanded.
  const expandRailGroup = useCallback(
    (key: string) => {
      if (closedGroups.has(key)) toggleGroup(key);
      setSidebarCollapsed(false);
    },
    [closedGroups, toggleGroup],
  );

  const openWip = useCallback((request: WipRequest) => {
    // Close the drawer first so only one modal owns focus and Escape.
    setMenuOpen(false);
    setWip(request);
  }, []);

  const navigationProps = {
    sections,
    pathname,
    closedGroups,
    onToggleGroup: toggleGroup,
    onWip: openWip,
  };

  return (
    <div className="app-shell" data-hydrated={hydrated || undefined}>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>

      <header className="shell-topbar">
        <button
          ref={menuButtonRef}
          type="button"
          className="shell-menu-button"
          aria-haspopup="dialog"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(true)}
        >
          <Icon name="menu" size="md" />
          <span className="visually-hidden">Open menu</span>
        </button>
        <BrandLink href={todayHref} />
      </header>

      <aside className="shell-sidebar" aria-label="Sidebar">
        <BrandLink href={todayHref} />
        <nav className="shell-nav" aria-label="Primary navigation">
          <NavigationTree {...navigationProps} rail={collapsed} onExpandRail={expandRailGroup} />
        </nav>
        <div className="shell-sidebar-footer">
          <div className="shell-sidebar-controls">
            <ThemeControl />
            <IconButton
              icon="panel-left"
              size="sm"
              className="shell-collapse-button"
              label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              onClick={() => setSidebarCollapsed(!collapsed)}
            />
          </div>
          <AccountSummary userName={userName} role={role} />
        </div>
      </aside>

      <div className="shell-body">
        <main className="shell-main" id="main-content" tabIndex={-1}>
          {breadcrumbs.length > 0 || context || attention ? (
            <div className="shell-header">
              <div className="shell-header-trail">
                {breadcrumbs.length > 0 ? <Breadcrumbs items={breadcrumbs} /> : null}
                {context ? <WorkContextLine context={context} /> : null}
              </div>
              {attention ? (
                <AttentionTrigger
                  count={attention.items.length}
                  onOpen={() => setAttentionOpen(true)}
                />
              ) : null}
            </div>
          ) : null}
          {children}
        </main>
      </div>

      <Modal open={menuOpen} onClose={() => setMenuOpen(false)} title="Menu" presentation="drawer">
        <nav className="shell-nav shell-nav-drawer" aria-label="Primary navigation">
          <NavigationTree {...navigationProps} rail={false} onNavigate={() => setMenuOpen(false)} />
        </nav>
        <div className="shell-drawer-footer">
          <AccountSummary userName={userName} role={role} />
          <ThemeControl />
        </div>
      </Modal>

      {attention ? (
        <Modal
          open={attentionOpen}
          onClose={() => setAttentionOpen(false)}
          title="Needs attention"
          description="Most urgent first. Items clear when the underlying work is done."
        >
          <NeedsAttention
            items={attention.items}
            viewAll={attention.viewAll}
            title="Open items"
            headingLevel={3}
          />
        </Modal>
      ) : null}

      <WorkInProgressDialog
        open={wip !== null}
        onClose={() => setWip(null)}
        feature={wip?.feature ?? ''}
        message={wip?.message}
        returnFocus={() => menuButtonRef.current}
      />
    </div>
  );
}

/* Navigation ---------------------------------------------------------------- */

type NavigationTreeProps = {
  sections: readonly ResolvedNavigationSection[];
  pathname: string | null;
  closedGroups: ReadonlySet<string>;
  rail: boolean;
  onToggleGroup: (key: string) => void;
  onWip: (request: WipRequest) => void;
  onExpandRail?: (key: string) => void;
  onNavigate?: () => void;
};

function NavigationTree(props: NavigationTreeProps) {
  const main = props.sections.filter((section) => section.placement !== 'end');
  const end = props.sections.filter((section) => section.placement === 'end');
  return (
    <>
      <ul className="nav-sections">
        {main.map((section) => (
          <NavigationSectionEntry key={section.key} section={section} {...props} />
        ))}
      </ul>
      {end.length > 0 ? (
        <ul className="nav-sections nav-sections-end">
          {end.map((section) => (
            <NavigationSectionEntry key={section.key} section={section} {...props} />
          ))}
        </ul>
      ) : null}
    </>
  );
}

function NavigationSectionEntry({
  section,
  pathname,
  closedGroups,
  rail,
  onToggleGroup,
  onWip,
  onExpandRail,
  onNavigate,
}: NavigationTreeProps & { section: ResolvedNavigationSection }) {
  const listId = `nav-group-${useId().replace(/:/g, '')}`;

  if (isSingleDestinationSection(section)) {
    return (
      <li>
        <NavigationEntry
          item={section.items[0]!}
          pathname={pathname}
          onWip={onWip}
          onNavigate={onNavigate}
          withIcon
        />
      </li>
    );
  }

  const open = !rail && !closedGroups.has(section.key);
  const containsCurrent = section.items.some((item) => isNavigationItemActive(item, pathname));

  return (
    <li className="nav-group">
      <button
        type="button"
        className="nav-row nav-group-toggle"
        aria-expanded={open}
        aria-controls={listId}
        data-contains-current={containsCurrent || undefined}
        onClick={() => (rail ? onExpandRail?.(section.key) : onToggleGroup(section.key))}
      >
        <Icon name={section.icon} className="nav-icon" />
        <span className="nav-label">{section.label}</span>
        {containsCurrent && !open ? (
          <span className="visually-hidden">, contains the current page</span>
        ) : null}
        <Icon name="chevron-down" className="nav-chevron" />
      </button>
      <ul className="nav-group-items" id={listId} hidden={!open}>
        {section.items.map((item) => (
          <li key={item.key}>
            <NavigationEntry
              item={item}
              pathname={pathname}
              onWip={onWip}
              onNavigate={onNavigate}
            />
          </li>
        ))}
      </ul>
    </li>
  );
}

function NavigationEntry({
  item,
  pathname,
  onWip,
  onNavigate,
  withIcon = false,
}: {
  item: ResolvedNavigationItem;
  pathname: string | null;
  onWip: (request: WipRequest) => void;
  onNavigate?: () => void;
  withIcon?: boolean;
}) {
  const icon = withIcon ? <Icon name={item.icon} className="nav-icon" /> : null;

  if (item.state === 'link') {
    const active = isNavigationItemActive(item, pathname);
    return (
      <Link
        className="nav-row nav-link"
        href={item.href}
        aria-current={active ? 'page' : undefined}
        onClick={onNavigate}
      >
        {icon}
        <span className="nav-label">{item.label}</span>
      </Link>
    );
  }

  if (item.state === 'wip') {
    return (
      <button
        type="button"
        className="nav-row nav-link"
        aria-haspopup="dialog"
        onClick={() => onWip({ feature: item.feature, message: item.message })}
      >
        {icon}
        <span className="nav-label">{item.label}</span>
        {item.reason === 'planned' ? <WipBadge /> : null}
      </button>
    );
  }

  return (
    <span className="nav-row nav-row-restricted">
      {icon}
      <span className="nav-label">
        {item.label}
        <span className="visually-hidden"> (no access)</span>
      </span>
      <Icon name="lock" className="nav-trailing-icon" />
    </span>
  );
}

function findHref(sections: readonly ResolvedNavigationSection[], key: string) {
  for (const section of sections) {
    for (const item of section.items) {
      if (item.key === key && item.state === 'link') return item.href;
    }
  }
  return undefined;
}

/* Shell parts --------------------------------------------------------------- */

function BrandLink({ href }: { href: string }) {
  return (
    <Link className="shell-brand" href={href}>
      <span className="brand-mark" aria-hidden="true">
        SF
      </span>
      <span className="shell-brand-text">
        <span className="brand-name">Shanda Fuel</span>
        <span className="brand-byline">by ShandaHR</span>
      </span>
      <span className="visually-hidden">, go to Today</span>
    </Link>
  );
}

function AccountSummary({ userName, role }: { userName?: string; role?: string }) {
  if (!userName) return null;
  return (
    <div className="shell-account">
      <span className="shell-avatar" aria-hidden="true">
        {initials(userName)}
      </span>
      <span className="shell-account-text">
        <span className="shell-account-name">{userName}</span>
        {role ? <span className="shell-account-role">{role}</span> : null}
      </span>
    </div>
  );
}

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join('') || '?'
  );
}

function WorkContextLine({ context }: { context: ShellContext }) {
  const parts = [context.organisation, context.station, context.businessDate, context.shift].filter(
    (part): part is string => Boolean(part),
  );
  return (
    <p className="shell-context" role="group" aria-label="Work context">
      {parts.map((part, index) => (
        <span key={`${part}-${index}`} className="shell-context-part">
          {part}
        </span>
      ))}
    </p>
  );
}

function AttentionTrigger({ count, onOpen }: { count: number; onOpen: () => void }) {
  return (
    <button type="button" className="shell-attention" aria-haspopup="dialog" onClick={onOpen}>
      <Icon name="bell" />
      <span className="shell-attention-label">Needs attention</span>
      {count > 0 ? (
        <span className="shell-attention-count">
          {count}
          <span className="visually-hidden">{count === 1 ? ' item' : ' items'}</span>
        </span>
      ) : (
        <span className="visually-hidden">, nothing open</span>
      )}
    </button>
  );
}

export function Breadcrumbs({ items }: { items: readonly ShellBreadcrumb[] }) {
  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      <ol>
        {items.map((item, index) => (
          <li key={`${item.label}-${index}`}>
            {item.href && index < items.length - 1 ? (
              <Link href={item.href}>{item.label}</Link>
            ) : (
              <span aria-current={index === items.length - 1 ? 'page' : undefined}>
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/* Location search ------------------------------------------------------------ */

/**
 * The current query string, read from the browser. Avoids `useSearchParams`,
 * which would force every statically rendered page behind a Suspense
 * boundary. The shell re-renders on every navigation (new page children), and
 * back/forward fires `popstate`, so the snapshot stays current.
 */
function useLocationSearch() {
  return useSyncExternalStore(subscribeToHistory, readLocationSearch, () => '');
}

function subscribeToNothing() {
  return () => {};
}

function subscribeToHistory(onChange: () => void) {
  window.addEventListener('popstate', onChange);
  return () => window.removeEventListener('popstate', onChange);
}

function readLocationSearch() {
  return window.location.search;
}
