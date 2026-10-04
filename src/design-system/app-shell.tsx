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
  parseClosedGroups,
  readClosedGroupsRaw,
  readSidebarCollapsed,
  setClosedGroupsRaw,
  setSidebarCollapsed,
  subscribeShellPreferences,
  toggleClosedGroup,
} from './shell-preferences';
import { ThemeControl } from './theme-control';
import { useThemePreference } from './theme-runtime';

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
  const [tasksOpen, setTasksOpen] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [contextSelectorOpen, setContextSelectorOpen] = useState(false);
  const [wip, setWip] = useState<WipRequest | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

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
      >
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>

        <div className="shell-topbar" role="navigation" aria-label="Mobile app bar">
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
        </div>

        <aside className="shell-sidebar" aria-label="Sidebar">
          <BrandLink href={todayHref} />
          <nav className="shell-nav" aria-label="Primary navigation">
            {openTasks ? (
              <OpenTasks
                tasks={openTasks}
                open={tasksOpen}
                onToggle={() => setTasksOpen((current) => !current)}
                onWip={openWip}
                collapsed={collapsed}
              />
            ) : null}
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
          <div className="shell-main">
            <header className="shell-header">
              <div className="shell-mobile-brand">
                <BrandLink href={todayHref} />
              </div>
              <ContextSelector
                fallback={context}
                open={contextSelectorOpen}
                onOpen={() => setContextSelectorOpen(true)}
                onClose={() => setContextSelectorOpen(false)}
              />
              {searchPlacement === 'header' ? <GlobalSearchButton compact /> : null}
              <AccountPill userName={userName} role={role} onWip={openWip} />
            </header>
            <main className="shell-sheet" id="main-content" tabIndex={-1}>
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
}: {
  item: ResolvedNavigationItem;
  pathname: string | null;
  onWip: (request: WipRequest) => void;
  onContextRequired: () => void;
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
    if (item.reason === 'station') {
      return (
        <button
          type="button"
          className="nav-row nav-link"
          aria-haspopup="dialog"
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

function AccountPill({
  userName,
  role,
  onWip,
}: {
  userName?: string;
  role?: string;
  onWip: (request: WipRequest) => void;
}) {
  const { resolvedTheme, setPreference } = useThemePreference();
  const nextTheme = resolvedTheme === 'dark' ? 'light' : 'dark';
  const helpButtonRef = useRef<HTMLButtonElement>(null);
  const notificationsButtonRef = useRef<HTMLButtonElement>(null);
  if (!userName) return null;

  return (
    <div
      className="shell-account shell-account-pill"
      role="group"
      aria-label={`Account: ${userName}${role ? `, ${role}` : ''}`}
    >
      <button
        ref={helpButtonRef}
        type="button"
        className="shell-icon-button"
        aria-label={`Switch to ${nextTheme} theme`}
        title={`Switch to ${nextTheme} theme`}
        onClick={() => setPreference(nextTheme)}
      >
        <Icon name={resolvedTheme === 'dark' ? 'sun' : 'moon'} size="md" />
      </button>
      <button
        type="button"
        className="shell-icon-button shell-hide-mobile"
        aria-label="Help"
        title="Help"
        aria-haspopup="dialog"
        onClick={() =>
          onWip({
            feature: 'Help',
            message:
              'Help content is not available yet. Nothing has been changed; contact your administrator for assistance.',
            returnFocus: () => helpButtonRef.current,
          })
        }
      >
        <Icon name="help" size="md" />
      </button>
      <button
        ref={notificationsButtonRef}
        type="button"
        className="shell-icon-button"
        aria-label="Notifications"
        title="Notifications"
        aria-haspopup="dialog"
        onClick={() =>
          onWip({
            feature: 'Notifications',
            message:
              'Notifications are not available yet. Nothing has been changed; no notification data is being shown.',
            returnFocus: () => notificationsButtonRef.current,
          })
        }
      >
        <Icon name="bell" size="md" />
      </button>
      <span className="shell-avatar" aria-hidden="true">
        {initials(userName)}
      </span>
      <span className="shell-account-text shell-hide-mobile">
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
  return (
    <button
      type="button"
      className={`global-search ${compact ? 'global-search-compact' : ''}`.trim()}
      aria-haspopup="dialog"
      aria-label="Search anything"
      aria-keyshortcuts="Meta+K Control+K"
      onClick={() => shell?.openSearch()}
    >
      <span>Search anything…</span>
      <kbd>⌘K</kbd>
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
      item.state !== 'restricted' && item.label.toLowerCase().includes(query.trim().toLowerCase()),
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
              <span>{item.label}</span>
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
