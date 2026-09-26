'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import {
  mobileNavigation,
  primaryNavigation,
  projectNavigationItems,
  type NavigationProjection,
  type ProjectedNavigationItem,
} from './navigation';

type AppShellProps = {
  children: ReactNode;
  navigationProjection: readonly NavigationProjection[];
  context: {
    organisation: string;
    station: string;
    businessDate: string;
    shift?: string;
  };
  role: string;
  userName: string;
  breadcrumbs?: readonly { label: string; href?: string }[];
};

export function AppShell({
  children,
  navigationProjection,
  context,
  role,
  userName,
  breadcrumbs = [],
}: AppShellProps) {
  const pathname = usePathname();
  const items = projectNavigationItems(primaryNavigation, navigationProjection);
  const mobileItems = projectNavigationItems(mobileNavigation, navigationProjection);

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
        <div className="topbar-context" role="group" aria-label="Active work context">
          <span>{context.organisation}</span>
          <span className="context-separator" aria-hidden="true">
            /
          </span>
          <span>{context.station}</span>
          <span className="context-date">{context.businessDate}</span>
          {context.shift ? <span className="context-shift">{context.shift}</span> : null}
        </div>
        <div className="user-context">
          <span className="user-name">{userName}</span>
          <span className="user-role">{role}</span>
        </div>
      </header>

      <div className="mobile-context" role="region" aria-label="Active mobile work context">
        <div>
          <span>Organisation</span>
          <strong>{context.organisation}</strong>
        </div>
        <div>
          <span>Station</span>
          <strong>{context.station}</strong>
        </div>
        <div>
          <span>Business date</span>
          <strong>{context.businessDate}</strong>
        </div>
        {context.shift ? (
          <div>
            <span>Shift</span>
            <strong>{context.shift}</strong>
          </div>
        ) : null}
      </div>

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
          {breadcrumbs.length > 0 ? <Breadcrumbs items={breadcrumbs} /> : null}
          {children}
        </main>
      </div>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        <ul>
          {mobileItems.map((item) => (
            <NavigationLink key={item.href} item={item} active={isActive(item, pathname)} mobile />
          ))}
        </ul>
      </nav>
    </div>
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

function NavigationLink({
  item,
  active,
  mobile = false,
}: {
  item: ProjectedNavigationItem;
  active: boolean;
  mobile?: boolean;
}) {
  return (
    <li className={mobile ? 'mobile-nav-item' : undefined}>
      <a
        className={`nav-link ${active ? 'nav-link-active' : ''} ${!item.enabled ? 'nav-link-disabled' : ''}`.trim()}
        href={item.enabled ? item.href : undefined}
        aria-current={active ? 'page' : undefined}
        aria-disabled={!item.enabled || undefined}
        tabIndex={item.enabled ? undefined : -1}
      >
        <span className="nav-link-label">
          {mobile ? (item.mobileLabel ?? item.label) : item.label}
        </span>
        {!mobile ? <span className="nav-link-description">{item.description}</span> : null}
      </a>
    </li>
  );
}

function isActive(item: ProjectedNavigationItem, pathname: string | null) {
  if (item.href === '/') return pathname === '/';
  if (item.href === '/operations/daily') return pathname?.startsWith('/operations') ?? false;
  return pathname === item.href;
}
