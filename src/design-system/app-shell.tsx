'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import { WorkInProgressDialog } from './dialogs';
import { ContextSelector } from './context-selector';
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
  readSidebarCollapsed,
  setSidebarCollapsed,
  subscribeShellPreferences,
} from './shell-preferences';
import { ThemeControl } from './theme-control';
import { applyThemePreference, readStoredThemePreference } from './theme';

/* Types -------------------------------------------------------------------- */

export type ShellContext = {
  organisation: string;
  station: string;
  businessDate: string;
  shift?: string;
  timeZone?: string;
};

export type ShellBreadcrumb = { label: string; href?: string };

export type ShellTask = {
  id: string;
  title: string;
  meta: string;
  href?: string;
};

type AppShellProps = {
  children: ReactNode;
  /** Visibility per navigation key, projected by the authorization layer. */
  navigationProjection: readonly NavigationProjection[];
  /** The operating context the page works in, shown quietly above the content. */
  context?: ShellContext;
  role?: string;
  userName?: string;
  breadcrumbs?: readonly ShellBreadcrumb[];
  pageTitle?: string;
  pageSubtitle?: ReactNode;
  /** Synthetic or server-projected tasks assigned to the signed-in user. */
  openTasks?: readonly ShellTask[];
  /**
   * Server-decided items that need attention. When provided, the shell shows
   * a compact "Needs attention" entry. The shell never invents items.
   */
  attention?: { items: readonly AttentionItem[]; viewAll?: ReactNode };
  /** Render the redesign search control beside page content instead of the shell header. */
  searchPlacement?: 'header' | 'page' | 'none';
};

type WipRequest = {
  feature: string;
  message?: string;
  returnFocus?: () => HTMLElement | null | undefined;
};
type ShellContextValue = { openSearch: () => void };
const ShellContext = createContext<ShellContextValue | null>(null);

function closedGroupsForRoute(
  sections: readonly ResolvedNavigationSection[],
  pathname: string | null,
): ReadonlySet<string> {
  return new Set(
    sections
      .filter(
        (section) =>
          !isSingleDestinationSection(section) &&
          !section.items.some((item) => isNavigationItemActive(item, pathname)),
      )
      .map((section) => section.key),
  );
}

function pageTitleForRoute(
  sections: readonly ResolvedNavigationSection[],
  pathname: string | null,
): string | undefined {
  const current = sections
    .flatMap((section) => section.items)
    .find((item) => isNavigationItemActive(item, pathname));
  if (!current) return undefined;
  return current.key === 'today' ? 'Dashboard' : current.label;
}

type ClosedGroupState = {
  pathname: string | null;
  sections: readonly ResolvedNavigationSection[];
  closedGroups: ReadonlySet<string>;
};

/* Shell -------------------------------------------------------------------- */

/**
 * The permanent Shanda Fuel application shell.
 *
 * - Desktop (≥ 64rem): persistent grouped sidebar; can collapse to an icon
 *   rail (remembered per device and applied before first paint).
 * - Tablet (768–1199px): a persistent icon rail keeps every destination
 *   reachable without taking content width from the workspace.
 * - Phone (<768px): a slim top bar opens the same grouped navigation in a
 *   drawer. Content keeps the full width.
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
  pageTitle: pageTitleOverride,
  pageSubtitle,
  openTasks,
  attention,
  searchPlacement = 'header',
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
  const shellMode = useShellMode();

  const collapsed = useSyncExternalStore(
    subscribeShellPreferences,
    readSidebarCollapsed,
    () => false,
  );
  const [closedGroupState, setClosedGroupState] = useState<ClosedGroupState>(() => ({
    pathname,
    sections,
    closedGroups: closedGroupsForRoute(sections, pathname),
  }));
  const closedGroups =
    closedGroupState.pathname === pathname && closedGroupState.sections === sections
      ? closedGroupState.closedGroups
      : closedGroupsForRoute(sections, pathname);
  const rail = shellMode === 'tablet' || (shellMode === 'desktop' && collapsed);
  const resolvedPageTitle = pageTitleOverride ?? pageTitleForRoute(sections, pathname);

  // False during server render and hydration, true once client handlers are live.
  const hydrated = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [attentionOpen, setAttentionOpen] = useState(false);
  const [tasksOpen, setTasksOpen] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [contextSelectorOpen, setContextSelectorOpen] = useState(false);
  const [wip, setWip] = useState<WipRequest | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // AppShell can survive a soft route transition while the document head
    // init script does not run again. Re-apply the device preference whenever
    // the active route changes so the shell never falls back to system mode.
    applyThemePreference(readStoredThemePreference());
  }, [pathname]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const toggleGroup = useCallback(
    (key: string) =>
      setClosedGroupState((current) => {
        const base =
          current.pathname === pathname && current.sections === sections
            ? current.closedGroups
            : closedGroupsForRoute(sections, pathname);
        const next = new Set(base);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return { pathname, sections, closedGroups: next };
      }),
    [pathname, sections],
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

  const openContextSelector = useCallback(() => {
    setMenuOpen(false);
    setContextSelectorOpen(true);
  }, []);

  const navigationProps = {
    sections,
    pathname,
    closedGroups,
    onToggleGroup: toggleGroup,
    onWip: openWip,
    onContextRequired: openContextSelector,
  };

  const shellContext = useMemo(() => ({ openSearch: () => setSearchOpen(true) }), []);

  return (
    <ShellContext.Provider value={shellContext}>
      <div
        className="app-shell"
        data-hydrated={hydrated || undefined}
        data-sidebar={collapsed ? 'collapsed' : 'expanded'}
        data-shell-mode={shellMode}
      >
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>

        <header className="shell-topbar" aria-label="Application header">
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
          {searchPlacement !== 'none' ? <GlobalSearchButton compact /> : null}
          <AccountMenu userName={userName} role={role} placement="mobile" />
        </header>

        <aside className="shell-sidebar" aria-label="Sidebar">
          <BrandLink href={todayHref} />
          <div className="shell-sidebar-nav-region">
            <nav className="shell-nav" aria-label="Primary navigation">
              {openTasks ? (
                <OpenTasks
                  tasks={openTasks}
                  open={tasksOpen}
                  onToggle={() => setTasksOpen((current) => !current)}
                  onWip={openWip}
                  collapsed={rail}
                />
              ) : null}
              <NavigationTree {...navigationProps} rail={rail} onExpandRail={expandRailGroup} />
            </nav>
          </div>
          <div className="shell-sidebar-footer">
            <div className="shell-sidebar-controls">
              <IconButton
                icon="panel-left"
                size="sm"
                className="shell-collapse-button"
                label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                onClick={() => setSidebarCollapsed(!collapsed)}
              />
            </div>
          </div>
        </aside>

        <div className="shell-body">
          <div className="shell-main">
            <div className="shell-header" role="region" aria-label="Page header and work context">
              {resolvedPageTitle ? (
                <div className="shell-page-heading">
                  <h1 id="page-title">{resolvedPageTitle}</h1>
                  {pageSubtitle ? <p className="shell-page-subtitle">{pageSubtitle}</p> : null}
                </div>
              ) : null}
              <div className="shell-header-controls">
                <ContextSelector
                  fallback={context}
                  open={contextSelectorOpen}
                  onOpen={() => setContextSelectorOpen(true)}
                  onClose={() => setContextSelectorOpen(false)}
                />
                {searchPlacement === 'header' ? <GlobalSearchButton compact /> : null}
                <AccountMenu userName={userName} role={role} placement="desktop" />
              </div>
            </div>
            <main
              className="shell-sheet"
              id="main-content"
              aria-labelledby={resolvedPageTitle ? 'page-title' : undefined}
              tabIndex={-1}
            >
              {breadcrumbs.length > 0 || attention ? (
                <div className="shell-sheet-header">
                  {breadcrumbs.length > 0 ? <Breadcrumbs items={breadcrumbs} /> : <span />}
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
        </div>

        <Modal
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          title="Menu"
          presentation="drawer"
        >
          <nav className="shell-nav shell-nav-drawer" aria-label="Primary navigation">
            <NavigationTree
              {...navigationProps}
              rail={false}
              onNavigate={() => setMenuOpen(false)}
            />
          </nav>
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

        <SearchPalette
          open={searchOpen}
          onClose={() => setSearchOpen(false)}
          items={sections.flatMap((section) => section.items)}
          onWip={openWip}
        />

        <WorkInProgressDialog
          open={wip !== null}
          onClose={() => setWip(null)}
          feature={wip?.feature ?? ''}
          message={wip?.message}
          returnFocus={wip?.returnFocus ?? (() => menuButtonRef.current)}
        />
      </div>
    </ShellContext.Provider>
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
  onContextRequired: () => void;
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
  onContextRequired,
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
          onContextRequired={onContextRequired}
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
              tabIndex={open ? undefined : -1}
              onWip={onWip}
              onContextRequired={onContextRequired}
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
  onContextRequired,
  onNavigate,
  withIcon = false,
  tabIndex,
}: {
  item: ResolvedNavigationItem;
  pathname: string | null;
  onWip: (request: WipRequest) => void;
  onContextRequired: () => void;
  onNavigate?: () => void;
  withIcon?: boolean;
  tabIndex?: number;
}) {
  const icon = withIcon ? <Icon name={item.icon} className="nav-icon" /> : null;

  if (item.state === 'link') {
    const active = isNavigationItemActive(item, pathname);
    return (
      <Link
        className="nav-row nav-link"
        href={item.href}
        aria-current={active ? 'page' : undefined}
        tabIndex={tabIndex}
        onClick={onNavigate}
      >
        {icon}
        <span className="nav-label">{item.label}</span>
      </Link>
    );
  }

  if (item.state === 'wip') {
    if (item.reason === 'station') {
      return (
        <button
          type="button"
          className="nav-row nav-link"
          aria-haspopup="dialog"
          tabIndex={tabIndex}
          onClick={onContextRequired}
        >
          {icon}
          <span className="nav-label">{item.label}</span>
        </button>
      );
    }
    return (
      <button
        type="button"
        className="nav-row nav-link"
        aria-haspopup="dialog"
        tabIndex={tabIndex}
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

function OpenTasks({
  tasks,
  open,
  onToggle,
  onWip,
  collapsed,
}: {
  tasks: readonly ShellTask[];
  open: boolean;
  onToggle: () => void;
  onWip: (request: WipRequest) => void;
  collapsed: boolean;
}) {
  if (collapsed) return null;
  return (
    <div className="shell-tasks">
      <button
        type="button"
        className="shell-group-toggle shell-tasks-toggle"
        aria-expanded={open}
        aria-controls="shell-open-tasks"
        onClick={onToggle}
      >
        <span>My open tasks</span>
        <span className="shell-count numeric">{tasks.length}</span>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} />
      </button>
      <ul id="shell-open-tasks" className="shell-task-list" hidden={!open}>
        {tasks.length === 0 ? (
          <li className="shell-task-empty">Nothing assigned to you</li>
        ) : (
          tasks.map((task) => (
            <li key={task.id}>
              {task.href ? (
                <Link className="shell-task" href={task.href}>
                  <TaskText task={task} />
                </Link>
              ) : (
                <button
                  type="button"
                  className="shell-task"
                  aria-haspopup="dialog"
                  onClick={() => onWip({ feature: task.title })}
                >
                  <TaskText task={task} />
                </button>
              )}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

function TaskText({ task }: { task: ShellTask }) {
  return (
    <>
      <span className="shell-task-title">{task.title}</span>
      <span className="shell-task-meta">{task.meta}</span>
    </>
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

function AccountMenu({
  userName,
  role,
  placement,
}: {
  userName?: string;
  role?: string;
  placement: 'desktop' | 'mobile';
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const displayName = displayableIdentity(userName);
  const displayRole = displayName ? displayableRole(role) : undefined;
  const label = displayName ? `Account: ${displayName}` : 'Account';

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!panelRef.current?.parentElement?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        window.requestAnimationFrame(() => triggerRef.current?.focus());
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.requestAnimationFrame(() => panelRef.current?.focus());
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className={`shell-account-menu shell-account-menu-${placement}`}>
      <button
        ref={triggerRef}
        type="button"
        className="shell-account-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="shell-avatar" aria-hidden="true">
          {displayName ? initials(displayName) : <Icon name="users" />}
        </span>
        <span className="shell-account-text shell-account-trigger-text">
          <span className="shell-account-name">{displayName ?? 'Account'}</span>
          {displayRole ? <span className="shell-account-role">{displayRole}</span> : null}
        </span>
        <Icon name="chevron-down" className="shell-account-chevron" />
      </button>
      {open ? (
        <div
          ref={panelRef}
          className="account-menu-panel"
          role="menu"
          aria-label="Account menu"
          tabIndex={-1}
        >
          <div className="account-menu-identity">
            <strong>{displayName ?? 'Account preferences'}</strong>
            {displayRole ? <span>{displayRole}</span> : null}
          </div>
          <div role="group" aria-label="Theme" className="account-menu-theme">
            <span className="account-menu-label">Theme</span>
            <ThemeControl />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function displayableIdentity(value?: string) {
  const candidate = value?.trim();
  if (
    !candidate ||
    /^(?:current user|cu|demo(?: owner| user)?|finance operator)$/i.test(candidate)
  ) {
    return undefined;
  }
  return candidate;
}

function displayableRole(value?: string) {
  const candidate = value?.trim();
  if (!candidate || /^(?:current user|cu)$/i.test(candidate)) return undefined;
  return candidate;
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

/** Opens the global page search without exposing records or private data. */
export function GlobalSearchButton({ compact = false }: { compact?: boolean }) {
  const shell = useContext(ShellContext);
  const shortcut = useSyncExternalStore(subscribeToNothing, readKeyboardShortcut, () => '⌘K');
  return (
    <button
      type="button"
      className={`global-search ${compact ? 'global-search-compact' : ''}`.trim()}
      aria-haspopup="dialog"
      aria-label="Search pages"
      aria-keyshortcuts="Meta+K Control+K"
      onClick={() => shell?.openSearch()}
    >
      <span>Search pages…</span>
      <kbd>{shortcut}</kbd>
      <Icon name="search" size="md" />
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

function SearchPalette({
  open,
  onClose,
  items,
  onWip,
}: {
  open: boolean;
  onClose: () => void;
  items: readonly ResolvedNavigationItem[];
  onWip: (request: WipRequest) => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const results = items.filter(
    (item) =>
      item.state !== 'restricted' &&
      item.searchLabel.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const safeIndex = Math.min(activeIndex, Math.max(results.length - 1, 0));

  const close = () => {
    setQuery('');
    setActiveIndex(0);
    onClose();
  };

  const choose = (item: ResolvedNavigationItem) => {
    close();
    if (item.state === 'link') router.push(item.href);
    else if (item.state === 'wip') onWip({ feature: item.feature, message: item.message });
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Search"
      description="Pages and areas you can open. Record search arrives with each module."
      size="md"
      className="modal-command-palette"
      initialFocusRef={inputRef}
    >
      <div className="search-palette">
        <input
          ref={inputRef}
          className="search-palette-input"
          type="search"
          role="combobox"
          aria-label="Search pages"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={results[safeIndex] ? `${listId}-${safeIndex}` : undefined}
          aria-autocomplete="list"
          placeholder="Search pages…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActiveIndex((index) => Math.min(index + 1, results.length - 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActiveIndex((index) => Math.max(index - 1, 0));
            } else if (event.key === 'Enter' && results[safeIndex]) {
              event.preventDefault();
              choose(results[safeIndex]!);
            }
          }}
        />
        <ul id={listId} role="listbox" aria-label="Pages" className="search-palette-results">
          {results.map((item, index) => (
            <li
              key={item.key}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === safeIndex}
              className="search-palette-option"
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(item)}
            >
              <Icon name={item.icon} size="md" />
              <span>{item.searchLabel}</span>
              {item.state === 'wip' ? (
                <span className="search-palette-meta">In progress</span>
              ) : null}
            </li>
          ))}
        </ul>
        {results.length === 0 ? (
          <p className="search-palette-empty" role="status">
            No pages match “{query}”.
          </p>
        ) : null}
      </div>
    </Modal>
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

function readKeyboardShortcut() {
  if (typeof navigator === 'undefined') return '⌘K';
  return /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent) ? '⌘K' : 'Ctrl K';
}

function useShellMode(): 'mobile' | 'tablet' | 'desktop' {
  return useSyncExternalStore(subscribeToViewport, readShellMode, () => 'desktop');
}

function subscribeToViewport(onChange: () => void) {
  window.addEventListener('resize', onChange);
  return () => window.removeEventListener('resize', onChange);
}

function readShellMode(): 'mobile' | 'tablet' | 'desktop' {
  if (typeof window === 'undefined') return 'desktop';
  if (window.innerWidth < 768) return 'mobile';
  if (window.innerWidth < 1200) return 'tablet';
  return 'desktop';
}
