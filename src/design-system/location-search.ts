'use client';

import { useSyncExternalStore } from 'react';

/**
 * The current query string, read from the browser. It avoids `useSearchParams`, which
 * would force every statically rendered page behind a Suspense boundary.
 *
 * Back/forward fires `popstate`, but a client navigation (`router.push`, a `<Link>`, the
 * station switcher) calls `history.pushState`, which fires nothing. Next updates the
 * address after it renders, so a component that merely re-renders can still read the old
 * query. Without this, the navigation links kept the previous station after a station
 * switch until something else forced a render, and the next tap opened the wrong station.
 * History writes are therefore announced with an event, once, after the address has changed.
 */
const LOCATION_EVENT = 'shanda:locationchange';
let historyAnnounced = false;

function announceHistoryWrites() {
  if (historyAnnounced || typeof window === 'undefined') return;
  historyAnnounced = true;
  for (const method of ['pushState', 'replaceState'] as const) {
    const original = window.history[method];
    window.history[method] = function (this: History, ...args: Parameters<History['pushState']>) {
      const result = original.apply(this, args);
      window.dispatchEvent(new Event(LOCATION_EVENT));
      return result;
    } as History['pushState'];
  }
}

function subscribe(onChange: () => void) {
  announceHistoryWrites();
  window.addEventListener('popstate', onChange);
  window.addEventListener(LOCATION_EVENT, onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(LOCATION_EVENT, onChange);
  };
}

function readLocationSearch() {
  return window.location.search;
}

export function useLocationSearch(): string {
  return useSyncExternalStore(subscribe, readLocationSearch, () => '');
}
