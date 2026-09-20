'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import {
  filterNavigationItems,
  primaryNavigation,
  type NavigationItem,
  type PermissionCode,
} from './navigation';

type AppShellProps = {
  children: ReactNode;
  grantedPermissions: readonly PermissionCode[];
  context: {
    organisation: string;
    station: string;
    businessDate: string;
  };
  role: string;
  userName: string;
};

export function AppShell({ children, grantedPermissions, context, role, userName }: AppShellProps) {
  const pathname = usePathname();
  const items = filterNavigationItems(primaryNavigation, new Set(grantedPermissions));
  const mobileItems = items.slice(0, 4);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            SF
          </span>
          <span>
            <span className="brand-name">Shanda Fuel</span>
            <span className="brand-byline">by ShandaHR</span>
          </span>
        </div>
        <div className="topbar-context" aria-label="Active work context">
          <span>{context.organisation}</span>
          <span className="context-separator" aria-hidden="true">
            /
          </span>
          <span>{context.station}</span>
          <span className="context-date">{context.businessDate}</span>
        </div>
        <div className="user-context">
          <span className="user-name">{userName}</span>
          <span className="user-role">{role}</span>
        </div>
      </header>

      <div className="app-body">
        <aside className="sidebar">
          <nav aria-label="Primary navigation">
            <p className="nav-heading">Workspace</p>
            <ul className="nav-list">
              {items.map((item) => (
                <NavigationLink key={item.href} item={item} active={isActive(item, pathname)} />
              ))}
            </ul>
          </nav>
          <div className="sidebar-footnote">
            <span className="eyebrow">Foundation preview</span>
            <p>Navigation is permission-aware. Server authorization remains authoritative.</p>
          </div>
        </aside>

        <main className="main-content" id="main-content">
          {children}
        </main>
      </div>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        {mobileItems.map((item) => (
          <NavigationLink key={item.href} item={item} active={isActive(item, pathname)} mobile />
        ))}
      </nav>
    </div>
  );
}

function NavigationLink({
  item,
  active,
  mobile = false,
}: {
  item: NavigationItem;
  active: boolean;
  mobile?: boolean;
}) {
  return (
    <li className={mobile ? 'mobile-nav-item' : undefined}>
      <a
        className={`nav-link ${active ? 'nav-link-active' : ''}`.trim()}
        href={item.href}
        aria-current={active ? 'page' : undefined}
      >
        <span className="nav-link-label">
          {mobile ? (item.mobileLabel ?? item.label) : item.label}
        </span>
        {!mobile ? <span className="nav-link-description">{item.description}</span> : null}
      </a>
    </li>
  );
}

function isActive(item: NavigationItem, pathname: string | null) {
  if (item.href === '/') return pathname === '/';
  return pathname === item.href;
}
