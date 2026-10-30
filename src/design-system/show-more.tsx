'use client';

import { useState } from 'react';
import { Button } from './primitives';

/** Rows a long list shows to start with, and how many each press of "Show more" adds. */
export const SHOW_FIRST = 5;
export const SHOW_STEP = 10;

/**
 * How many rows of a long list are showing. Pair it with {@link ShowMore} under the list:
 * `rows.slice(0, shown)`, then `<ShowMore shown={shown} total={rows.length} onChange={setShown} />`.
 */
export function useShowMore(first: number = SHOW_FIRST) {
  return useState(first);
}

/**
 * The footer of a long list: how many are showing, and buttons to show more or fewer. It renders
 * nothing while everything already fits in the first rows.
 */
export function ShowMore({
  shown,
  total,
  onChange,
  first = SHOW_FIRST,
  step = SHOW_STEP,
}: Readonly<{
  shown: number;
  total: number;
  onChange: (next: number) => void;
  first?: number;
  step?: number;
}>) {
  if (total <= first) return null;
  return (
    <div className="show-more">
      <span className="show-more-count">
        Showing {Math.min(shown, total)} of {total}
      </span>
      <span className="show-more-buttons">
        {shown > first ? (
          <Button type="button" variant="quiet" onClick={() => onChange(first)}>
            Show less
          </Button>
        ) : null}
        {shown < total ? (
          <Button type="button" variant="secondary" onClick={() => onChange(shown + step)}>
            Show more
          </Button>
        ) : null}
      </span>
    </div>
  );
}
