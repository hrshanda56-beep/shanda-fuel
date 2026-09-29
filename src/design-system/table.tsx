'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Horizontal scroll container for a wide table. While the table overflows,
 * the wrapper is a named, keyboard-focusable region so keyboard users can
 * reach it and scroll it with the arrow keys. When the table fits, or on
 * narrow screens where rows stack as cards and nothing scrolls, it is a plain
 * wrapper with no extra tab stop. The server renders the focusable form, so
 * the table stays reachable before hydration and without JavaScript.
 */
export function TableScrollRegion({
  label,
  children,
}: {
  /** Names the region for assistive technology; usually the table caption. */
  label: string;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrollable, setScrollable] = useState(true);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const { overflowX } = getComputedStyle(element);
      setScrollable(
        (overflowX === 'auto' || overflowX === 'scroll') &&
          element.scrollWidth > element.clientWidth,
      );
    };
    measure();
    // The wrapper resizes with the viewport; the table resizes with its rows.
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className="responsive-table-wrap"
      role={scrollable ? 'region' : undefined}
      aria-label={scrollable ? label : undefined}
      tabIndex={scrollable ? 0 : undefined}
    >
      {children}
    </div>
  );
}
