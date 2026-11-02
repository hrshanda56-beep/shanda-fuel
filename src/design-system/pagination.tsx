'use client';

import { useRef, useState } from 'react';

/** Rows a long list shows on each page. */
export const PAGE_SIZE = 15;

/** Page numbers to show: first, last and the neighbours of the current page. A gap of one page
 * shows that page; longer gaps are null and render as an ellipsis. */
export function pageNumbers(current: number, last: number): (number | null)[] {
  const wanted = new Set([1, last, current - 1, current, current + 1]);
  const pages = [...wanted].filter((n) => n >= 1 && n <= last).sort((a, b) => a - b);
  const out: (number | null)[] = [];
  pages.forEach((n, i) => {
    const gap = i > 0 ? n - pages[i - 1]! : 0;
    if (gap === 2) out.push(n - 1);
    else if (gap > 2) out.push(null);
    out.push(n);
  });
  return out;
}

export type PageSlice<T> = Readonly<{
  /** The page being shown, kept inside the real range when the list shrinks. */
  page: number;
  pages: number;
  rows: T[];
  /** 1-based position of the first and last row on this page. */
  from: number;
  to: number;
  total: number;
  /**
   * True when the list is loaded in batches and more rows exist than `total` counts. The range
   * then reads "of 40+", and Next stays available on the last loaded page so the caller can fetch.
   */
  more?: boolean;
  setPage: (page: number) => void;
}>;

export type PageState = Readonly<{ requested: number; setRequested: (page: number) => void }>;

/**
 * Which page was asked for, going back to page 1 whenever `resetKey` (a filter, a search, the
 * figures themselves) changes. Split from {@link pageOf} for components that only know their rows
 * after an early return, where a hook cannot be called.
 */
export function usePageState(resetKey?: unknown): PageState {
  const [state, setState] = useState({ requested: 1, key: resetKey });
  const stale = !Object.is(state.key, resetKey);
  if (stale) setState({ requested: 1, key: resetKey });
  return {
    requested: stale ? 1 : state.requested,
    setRequested: (page) => setState({ requested: page, key: resetKey }),
  };
}

/** One page of a list, kept inside the real range when the list shrinks. */
export function pageOf<T>(
  items: readonly T[],
  { requested, setRequested }: PageState,
  pageSize: number = PAGE_SIZE,
): PageSlice<T> {
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, requested), pages);
  const start = (page - 1) * pageSize;
  return {
    page,
    pages,
    rows: items.slice(start, start + pageSize),
    from: total === 0 ? 0 : start + 1,
    to: Math.min(start + pageSize, total),
    total,
    setPage: setRequested,
  };
}

/** Splits a list into pages. Pair it with {@link Pagination} under the list. */
export function usePagination<T>(
  items: readonly T[],
  { pageSize = PAGE_SIZE, resetKey }: Readonly<{ pageSize?: number; resetKey?: unknown }> = {},
): PageSlice<T> {
  return pageOf(items, usePageState(resetKey), pageSize);
}

/**
 * The footer of a long list: which rows are showing, Previous and Next, and page numbers. It
 * renders nothing while the whole list fits on one page.
 */
export function Pagination({
  slice,
  label,
  noun = 'items',
  className,
}: Readonly<{
  slice: PageSlice<unknown>;
  /** Names the controls for assistive technology, such as "Day by day pages". */
  label: string;
  /** What the rows are, for the range text: "days", "payouts". */
  noun?: string;
  className?: string;
}>) {
  const { page, pages, from, to, total, more = false } = slice;
  const root = useRef<HTMLDivElement>(null);
  if (pages <= 1 && !more) return null;
  const shownTotal = more ? `${total}+` : `${total}`;
  /** Changes the page, then brings the top of the list back into view so the new rows start there. */
  const go = (next: number) => {
    slice.setPage(next);
    requestAnimationFrame(() => {
      const top = root.current?.closest('section, article, .panel') ?? root.current?.parentElement;
      const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      top?.scrollIntoView({ block: 'start', behavior: still ? 'auto' : 'smooth' });
    });
  };
  return (
    <div ref={root} className={className ? `pager ${className}` : 'pager'}>
      <p className="pager-range" aria-live="polite">
        {from === to
          ? `Showing ${from} of ${shownTotal} ${noun}`
          : `Showing ${from}–${to} of ${shownTotal} ${noun}`}
      </p>
      <nav className="pager-nav" aria-label={label}>
        <button
          type="button"
          className="button button-secondary"
          disabled={page === 1}
          onClick={() => go(page - 1)}
        >
          Previous
        </button>
        <ol className="pager-pages">
          {pageNumbers(page, pages).map((n, i) => (
            <li key={n ?? `gap-${i}`}>
              {n === null ? (
                <span className="pager-gap" aria-hidden="true">
                  &hellip;
                </span>
              ) : (
                <button
                  type="button"
                  className="pager-page"
                  aria-current={n === page ? 'page' : undefined}
                  aria-label={`Page ${n}`}
                  onClick={() => go(n)}
                >
                  {n}
                </button>
              )}
            </li>
          ))}
        </ol>
        <button
          type="button"
          className="button button-secondary"
          disabled={page === pages && !more}
          onClick={() => go(page + 1)}
        >
          Next
        </button>
      </nav>
    </div>
  );
}
