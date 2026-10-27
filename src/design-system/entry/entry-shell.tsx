import type { ReactNode } from 'react';

import { BrandMark } from '../brand-mark';

/**
 * Frame for every signed-out / pre-workplace screen. No navigation, no context
 * selector, no product data: a restrained brand panel (desktop only) beside one
 * quiet task area. `wide` suits longer forms. On phones the panel collapses to a compact brand header.
 */
export function EntryShell({
  children,
  wide = false,
}: Readonly<{ children: ReactNode; wide?: boolean }>) {
  return (
    <div className="entry">
      <aside className="entry-brand" aria-label="Shanda Fuel">
        <svg className="entry-brand-art" viewBox="0 0 400 600" aria-hidden="true" focusable="false">
          <g fill="none" stroke="currentColor" strokeWidth="1">
            <circle cx="360" cy="560" r="120" />
            <circle cx="360" cy="560" r="200" />
            <circle cx="360" cy="560" r="280" />
            <circle cx="360" cy="560" r="360" />
          </g>
          <path
            d="M 80 600 A 280 280 0 0 1 360 280"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            className="entry-brand-art-accent"
          />
        </svg>
        <div className="entry-wordmark">
          <BrandMark />
          <span>Shanda Fuel</span>
        </div>
        <div className="entry-brand-copy">
          <p className="entry-tagline">Run every shift with confidence.</p>
          <p className="entry-tagline-sub">Shifts, stock, cash and operations in one place.</p>
        </div>
      </aside>
      <main className="entry-main" id="main">
        <div className={wide ? 'entry-column entry-column-wide' : 'entry-column'}>
          <div className="entry-wordmark entry-wordmark-compact">
            <BrandMark />
            <span>Shanda Fuel</span>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
