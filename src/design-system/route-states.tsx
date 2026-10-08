'use client';

import Link from 'next/link';

import { AppShell } from './app-shell';
import { emptyNavigationProjection } from './navigation-projection';
import { SkeletonCard, SkeletonTiles } from './page-kit';
import { Button, EmptyState, ErrorState } from './primitives';

/**
 * Whole-page states rendered inside the Product Shell, so navigation stays
 * put while a route loads or fails. Used by the app's `loading`, `error` and
 * `not-found` files. They carry no page context and invent no data.
 *
 * Navigation uses the same projection as the pages; when a real
 * authorization projection is wired, pass it here too.
 */

export function RouteLoading() {
  return (
    <AppShell navigationProjection={emptyNavigationProjection}>
      <div className="route-loading" role="status" aria-live="polite">
        <span className="visually-hidden">Loading page…</span>
        <SkeletonTiles count={4} label="Loading figures" />
        <SkeletonCard label="Loading content" lines={4} />
      </div>
    </AppShell>
  );
}

export function RouteError({ digest, retry }: { digest?: string; retry: () => void }) {
  return (
    <AppShell navigationProjection={emptyNavigationProjection}>
      <div className="route-state">
        <ErrorState
          layout="block"
          headingLevel={1}
          title="This page could not be loaded"
          message="Try again, or go back to Today and reopen the page."
          action={
            <div className="route-state-actions">
              <Button variant="primary" onClick={retry}>
                Try again
              </Button>
              <Link className="button button-secondary" href="/">
                Go to Today
              </Link>
            </div>
          }
        />
        {digest ? (
          <p className="route-state-reference">
            Reference for support: <code>{digest}</code>
          </p>
        ) : null}
      </div>
    </AppShell>
  );
}

export function RouteNotFound() {
  return (
    <AppShell navigationProjection={emptyNavigationProjection}>
      <div className="route-state">
        <EmptyState
          layout="block"
          headingLevel={1}
          icon="info"
          title="Page not found"
          message="This page does not exist or may have moved. Nothing was changed."
          action={
            <Link className="button button-secondary" href="/">
              Go to Today
            </Link>
          }
        />
      </div>
    </AppShell>
  );
}
