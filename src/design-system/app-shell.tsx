'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { authClient } from '@/platform/auth/client';

import { WorkInProgressDialog } from './dialogs';
import { Icon } from './icons';
import { Modal } from './modal';
import {
  dashboardItem,
  isNavigationItemActive,
  mobileNavigation,
  navigationGroups,
  primaryNavigation,
  projectNavigationGroups,
  projectNavigationItems,
  settingsItem,
  type NavigationProjection,
  type ProjectedNavigationItem,
} from './navigation';
import { useThemePreference } from './theme-runtime';

/**
 * Product Shell (ADR-015): grouped collapsible sidebar with no search box,
 * a header with the work context and a floating account pill, one global
 * ⌘K search, and one rounded content sheet. Phones get a compact app bar,
 * a four-item bottom bar and a "More" sheet instead of the sidebar.
 */

export type ShellTask = {
  id: string;
  title: string;
  meta: string;
  href?: string;
};

type AppShellProps = {
  children: ReactNode;
  navigationProjection: readonly NavigationProjection[];
  context: {
    organisation: string;
    station: string;
    businessDate: string;
    shift?: string;
    /** Business time zone label, e.g. "CAT". */
    timeZone?: string;
  };
  role: string;
  userName: string;
  breadcrumbs?: readonly { label: string; href?: string }[];
  /** Tenant logo from tenant configuration. Falls back to a monogram. */
  organisationLogoSrc?: string;
  /** The signed-in user's open tasks, from the server. */
  openTasks?: readonly ShellTask[];
  /** Count shown beside "Needs attention", from the server. */
  attentionCount?: number;
  /** `page` when the page renders <GlobalSearchButton /> beside its title. */
  searchPlacement?: 'header' | 'page';
};

type ShellContextValue = { openSearch: () => void };

const ShellContext = createContext<ShellContextValue | null>(null);

const SIDEBAR_STORAGE_KEY = 'shanda-fuel:sidebar';

export function AppShell({
  children,
  navigationProjection,
  context,
  role,
  userName,
  breadcrumbs = [],
  organisationLogoSrc,
  openTasks = [],
  attentionCount,
  searchPlacement = 'header',
}: AppShellProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [closedGroups, setClosedGroups] = useState<Record<string, boolean>>({});
  const [tasksOpen, setTasksOpen] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [wipFeature, setWipFeature] = useState<string>();
  const wipReturnFocus = useRef<HTMLElement | null>(null);

  const groups = projectNavigationGroups(navigationGroups, navigationProjection);
  const [home] = projectNavigationItems([dashboardItem], navigationProjection);
  const [settings] = projectNavigationItems([settingsItem], navigationProjection);
  const mobileItems = projectNavigationItems(mobileNavigation, navigationProjection);
  const searchable = projectNavigationItems(primaryNavigation, navigationProjection);

  useEffect(() => {
    // Read after mount so server and first client render agree.
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCollapsed(window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'collapsed');
    } catch {
      // Storage unavailable: the sidebar stays expanded.
    }
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? 'collapsed' : 'expanded');
      } catch {
        // Presentation preference only.
      }
      return next;
    });
  };

  const openWip = useCallback((feature: string) => {
    wipReturnFocus.current = document.activeElement as HTMLElement | null;
    setMoreOpen(false);
    setSearchOpen(false);
    setWipFeature(feature);
  }, []);

  const shellContext = useMemo(() => ({ openSearch: () => setSearchOpen(true) }), []);
  const contextParts = [context.station, context.businessDate, context.shift, context.timeZone];

  return (
    <ShellContext.Provider value={shellContext}>
      <div className="app-shell" data-sidebar={collapsed ? 'collapsed' : 'expanded'}>
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>

        <aside className="shell-sidebar" aria-label="Sidebar">
          <OrganisationSwitcher
            name={context.organisation}
            logoSrc={organisationLogoSrc}
            collapsed={collapsed}
            onOpen={() => openWip('Organisation switching')}
          />

          <nav className="shell-nav" aria-label="Primary navigation">
            {home ? (
              <NavEntry
                item={home}
                active={isNavigationItemActive(home, pathname)}
                collapsed={collapsed}
                onWip={openWip}
              />
            ) : null}

            {!collapsed ? (
              <div className="shell-tasks">
                <button
                  type="button"
                  className="shell-group-toggle shell-tasks-toggle"
                  aria-expanded={tasksOpen}
                  aria-controls="shell-open-tasks"
                  onClick={() => setTasksOpen((open) => !open)}
                >
                  <span>My open tasks</span>
                  <span className="shell-count numeric">{openTasks.length}</span>
                  <Icon name={tasksOpen ? 'chevron-down' : 'chevron-right'} />
                </button>
                <ul id="shell-open-tasks" className="shell-task-list" hidden={!tasksOpen}>
                  {openTasks.length === 0 ? (
                    <li className="shell-task-empty">Nothing assigned to you</li>
                  ) : (
                    openTasks.map((task) => (
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
                            onClick={() => openWip(task.title)}
                          >
                            <TaskText task={task} />
                          </button>
                        )}
                      </li>
                    ))
                  )}
                </ul>
              </div>
            ) : null}

            {groups.map((group) => {
              const open = collapsed || !closedGroups[group.id];
              const listId = `shell-group-${group.id}`;
              return (
                <div className="shell-group" key={group.id}>
                  {!collapsed ? (
                    <button
                      type="button"
                      className="shell-group-toggle"
                      aria-expanded={open}
                      aria-controls={listId}
                      onClick={() =>
                        setClosedGroups((closed) => ({ ...closed, [group.id]: !closed[group.id] }))
                      }
                    >
                      <span>{group.label}</span>
                      <Icon name={open ? 'chevron-down' : 'chevron-right'} />
                    </button>
                  ) : (
                    <span className="visually-hidden">{group.label}</span>
                  )}
                  <ul id={listId} className="shell-nav-list" hidden={!open}>
                    {group.items.map((item) => (
                      <li key={item.key}>
                        <NavEntry
                          item={item}
                          active={isNavigationItemActive(item, pathname)}
                          collapsed={collapsed}
                          onWip={openWip}
                          count={item.key === 'tasks' ? attentionCount : undefined}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </nav>

          <div className="shell-sidebar-footer">
            {settings ? (
              <NavEntry
                item={settings}
                active={isNavigationItemActive(settings, pathname)}
                collapsed={collapsed}
                onWip={openWip}
              />
            ) : null}
            <SignOutButton collapsed={collapsed} />
            <div className="shell-sidebar-base">
              {!collapsed ? <span className="shell-wordmark">Shanda Fuel</span> : null}
              <button
                type="button"
                className="shell-icon-button"
                aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                aria-pressed={collapsed}
                title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                onClick={toggleCollapsed}
              >
                <Icon name={collapsed ? 'sidebar-expand' : 'sidebar-collapse'} size="md" />
              </button>
            </div>
          </div>
        </aside>

        <div className="shell-main">
          <header className="shell-header">
            <div className="shell-mobile-brand">
              <OrganisationMark name={context.organisation} logoSrc={organisationLogoSrc} />
              <span className="shell-wordmark">Shanda Fuel</span>
            </div>
            <p className="shell-context" role="group" aria-label="Active work context">
              {contextParts.filter(Boolean).map((part, index) => (
                <span key={`${part}-${index}`}>
                  {index > 0 ? (
                    <span className="shell-context-dot" aria-hidden="true">
                      ·
                    </span>
                  ) : null}
                  {part}
                </span>
              ))}
            </p>
            {searchPlacement === 'header' ? <GlobalSearchButton compact /> : null}
            <AccountPill
              userName={userName}
              role={role}
              onHelp={() => openWip('Help centre')}
              onNotifications={() => openWip('Notifications')}
            />
          </header>

          <main className="shell-sheet" id="main-content" tabIndex={-1}>
            <div
              className="shell-mobile-context"
              role="region"
              aria-label="Active mobile work context"
            >
              {[context.organisation, ...contextParts].filter(Boolean).join(' · ')}
            </div>
            {breadcrumbs.length > 0 ? <Breadcrumbs items={breadcrumbs} /> : null}
            {children}
          </main>
        </div>

        <nav className="mobile-nav" aria-label="Mobile navigation">
          <ul>
            {mobileItems.map((item) => (
              <li className="mobile-nav-item" key={item.key}>
                {item.key === 'more' ? (
                  <button
                    type="button"
                    className="nav-link"
                    aria-haspopup="dialog"
                    onClick={() => setMoreOpen(true)}
                  >
                    <Icon name="more" size="md" />
                    <span className="nav-link-label">{item.mobileLabel ?? item.label}</span>
                  </button>
                ) : (
                  <MobileNavLink item={item} active={isNavigationItemActive(item, pathname)} />
                )}
              </li>
            ))}
          </ul>
        </nav>
      </div>

      <SearchPalette
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        items={searchable}
        onWip={openWip}
      />

      <Modal
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        title="All areas"
        presentation="sheet"
      >
        <nav className="shell-more" aria-label="All areas">
          {groups.map((group) => (
            <section key={group.id} aria-label={group.label}>
              <h3>{group.label}</h3>
              <ul>
                {group.items.map((item) => (
                  <li key={item.key}>
                    <NavEntry
                      item={item}
                      active={isNavigationItemActive(item, pathname)}
                      collapsed={false}
                      onWip={openWip}
                      onNavigate={() => setMoreOpen(false)}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {settings ? (
            <NavEntry item={settings} active={false} collapsed={false} onWip={openWip} />
          ) : null}
          <SignOutButton collapsed={false} />
        </nav>
      </Modal>

      <WorkInProgressDialog
        open={wipFeature !== undefined}
        onClose={() => setWipFeature(undefined)}
        feature={wipFeature ?? ''}
        returnFocus={() => wipReturnFocus.current}
      />
    </ShellContext.Provider>
  );
}

/** Opens the global search. Render beside the page title with `searchPlacement="page"`. */
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

export function Breadcrumbs({ items }: { items: readonly { label: string; href?: string }[] }) {
  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      <ol>
        {items.map((item, index) => (
          <li key={`${item.label}-${index}`}>
            {item.href && index < items.length - 1 ? (
              <a href={item.href}>{item.label}</a>
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

function TaskText({ task }: { task: ShellTask }) {
  return (
    <>
      <span className="shell-task-title">{task.title}</span>
      <span className="shell-task-meta">{task.meta}</span>
    </>
  );
}

function NavEntry({
  item,
  active,
  collapsed,
  onWip,
  onNavigate,
  count,
}: {
  item: ProjectedNavigationItem;
  active: boolean;
  collapsed: boolean;
  onWip: (feature: string) => void;
  onNavigate?: () => void;
  count?: number;
}) {
  const className = `shell-nav-link ${active ? 'shell-nav-link-active' : ''}`.trim();
  const content = (
    <>
      <Icon name={item.icon} size="md" />
      <span className={collapsed ? 'visually-hidden' : 'shell-nav-label'}>{item.label}</span>
      {count !== undefined && !collapsed ? (
        <span className="shell-count numeric">{count}</span>
      ) : null}
    </>
  );
  const title = collapsed ? item.label : undefined;

  if (!item.enabled) {
    return (
      <span className={`${className} shell-nav-link-disabled`} aria-disabled="true" title={title}>
        {content}
      </span>
    );
  }
  if (!item.href) {
    return (
      <button
        type="button"
        className={className}
        aria-haspopup="dialog"
        title={title}
        onClick={() => onWip(item.label)}
      >
        {content}
      </button>
    );
  }
  return (
    <Link
      className={className}
      href={item.href}
      aria-current={active ? 'page' : undefined}
      title={title}
      onClick={onNavigate}
    >
      {content}
    </Link>
  );
}

function MobileNavLink({ item, active }: { item: ProjectedNavigationItem; active: boolean }) {
  const label = item.mobileLabel ?? item.label;
  if (!item.enabled || !item.href) {
    return (
      <span className="nav-link nav-link-disabled" aria-disabled="true">
        <Icon name={item.icon} size="md" />
        <span className="nav-link-label">{label}</span>
      </span>
    );
  }
  return (
    <Link
      className={`nav-link ${active ? 'nav-link-active' : ''}`.trim()}
      href={item.href}
      aria-current={active ? 'page' : undefined}
    >
      <Icon name={item.icon} size="md" />
      <span className="nav-link-label">{label}</span>
    </Link>
  );
}

function OrganisationMark({ name, logoSrc }: { name: string; logoSrc?: string }) {
  if (logoSrc) {
    // Tenant logos are small, already-optimised assets from tenant configuration.
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="shell-org-logo" src={logoSrc} alt="" width={40} height={40} />;
  }
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('');
  return (
    <span className="shell-org-logo shell-org-monogram" aria-hidden="true">
      {initials}
    </span>
  );
}

function OrganisationSwitcher({
  name,
  logoSrc,
  collapsed,
  onOpen,
}: {
  name: string;
  logoSrc?: string;
  collapsed: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className="shell-org"
      aria-haspopup="dialog"
      aria-label={`Organisation: ${name}. Switch organisation`}
      onClick={onOpen}
    >
      <OrganisationMark name={name} logoSrc={logoSrc} />
      {!collapsed ? (
        <>
          <span className="shell-org-name">{name}</span>
          <Icon name="chevron-down" />
        </>
      ) : null}
    </button>
  );
}

function AccountPill({
  userName,
  role,
  onHelp,
  onNotifications,
}: {
  userName: string;
  role: string;
  onHelp: () => void;
  onNotifications: () => void;
}) {
  const { resolvedTheme, setPreference } = useThemePreference();
  const nextTheme = resolvedTheme === 'dark' ? 'light' : 'dark';
  const initials = userName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('');

  return (
    <div className="shell-account" role="group" aria-label="Account">
      <button
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
        aria-haspopup="dialog"
        title="Help"
        onClick={onHelp}
      >
        <Icon name="help" size="md" />
      </button>
      <button
        type="button"
        className="shell-icon-button"
        aria-label="Notifications"
        aria-haspopup="dialog"
        title="Notifications"
        onClick={onNotifications}
      >
        <Icon name="bell" size="md" />
      </button>
      <span className="shell-avatar" aria-hidden="true">
        {initials}
      </span>
      <span className="shell-user shell-hide-mobile">
        <span className="shell-user-name">{userName}</span>
        <span className="shell-user-role">{role}</span>
      </span>
    </div>
  );
}

function SignOutButton({ collapsed }: { collapsed: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <button
      type="button"
      className="shell-nav-link"
      title={collapsed ? 'Log out' : undefined}
      disabled={pending}
      onClick={async () => {
        setPending(true);
        try {
          await authClient.signOut();
        } finally {
          router.push('/login');
        }
      }}
    >
      <Icon name="logout" size="md" />
      <span className={collapsed ? 'visually-hidden' : 'shell-nav-label'}>
        {pending ? 'Logging out…' : 'Log out'}
      </span>
    </button>
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
  items: readonly ProjectedNavigationItem[];
  onWip: (feature: string) => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const results = items.filter(
    (item) => item.enabled && item.label.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const safeIndex = Math.min(activeIndex, Math.max(results.length - 1, 0));

  const close = () => {
    setQuery('');
    setActiveIndex(0);
    onClose();
  };

  const choose = (item: ProjectedNavigationItem) => {
    close();
    if (item.href) router.push(item.href);
    else onWip(item.label);
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Search"
      description="Pages and areas you can open. Records search arrives with each module."
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
              choose(results[safeIndex]);
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
              {!item.href ? <span className="search-palette-meta">In progress</span> : null}
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
