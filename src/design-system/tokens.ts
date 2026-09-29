/**
 * Design tokens that JavaScript needs. CSS custom properties in
 * styles/tokens.css are the source of truth for everything visual; this file
 * mirrors only the values CSS cannot express as custom properties (media
 * query breakpoints) or that components need at runtime (motion timings).
 */

/** Min-width breakpoints in rem. Mobile-first: styles apply from this width up. */
export const breakpoints = {
  /** Large phones / small tablets in portrait. */
  sm: 40,
  /** Tablets. Multi-column content begins. */
  md: 48,
  /** Laptops. Persistent sidebar navigation begins. */
  lg: 64,
  /** Desktops. Wide content and dense reporting. */
  xl: 80,
} as const;

export type Breakpoint = keyof typeof breakpoints;

/** `(min-width: …)` query for a breakpoint, for use with matchMedia. */
export function mediaQueryUp(breakpoint: Breakpoint) {
  return `(min-width: ${breakpoints[breakpoint]}rem)`;
}

/** Max content widths in rem (mirrors --content-*). */
export const contentWidths = {
  narrow: 40,
  default: 72,
  wide: 90,
} as const;

/** Motion durations in milliseconds (mirrors --duration-*). */
export const durations = {
  instant: 80,
  fast: 120,
  base: 180,
  slow: 260,
} as const;

export function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** Chart series tokens in the order series must use them. Max five series. */
export const chartSeries = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
] as const;
