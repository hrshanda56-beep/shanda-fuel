import type { CSSProperties } from 'react';

import type { RememberedBrand } from './brand-memory';
import styles from './loading-truck.module.css';

/**
 * A small tanker drives from left to right while a page loads. Everyone gets the same truck; a
 * company with a logo sees it on the tank, and its colour on the swoosh. With no brand (the first
 * load, or a company without a logo) it is a plain truck in the app's colours.
 *
 * It is decoration: the page's own "Loading page…" text stays for screen readers, so this is hidden
 * from them. It appears only after a short delay so quick loads never flash it, and for people who
 * ask for less motion it stands still.
 */
export function LoadingTruck({ brand }: { brand?: RememberedBrand | null }) {
  const style = brand?.colour ? ({ '--truck-accent': brand.colour } as CSSProperties) : undefined;
  return (
    <div
      className={styles.road}
      style={style}
      data-tank={brand?.logo ? brand.tank : 'light'}
      aria-hidden="true"
      data-testid="loading-truck"
    >
      <div className={styles.lane}>
        <svg
          className={styles.truck}
          viewBox="0 0 132 56"
          width="132"
          height="56"
          focusable="false"
        >
          <g className={styles.speed}>
            <path d="M0 18h14M4 26h12M0 34h14" />
          </g>
          <g className={styles.body}>
            {/* The tank. */}
            <rect className={styles.tank} x="20" y="8" width="66" height="26" rx="13" />
            <path className={styles.swoosh} d="M26 29c14-9 34-9 54-17" />
            <path className={styles.swooshSoft} d="M26 33c18-9 40-10 58-19" />
            {brand?.logo ? (
              <image
                className={styles.logo}
                href={brand.logo}
                x="34"
                y="13"
                width="40"
                height="16"
                preserveAspectRatio="xMidYMid meet"
              />
            ) : null}
            {/* The frame, the cab and its window. */}
            <rect className={styles.frame} x="14" y="34" width="96" height="4" rx="1.5" />
            <path
              className={styles.cab}
              d="M88 14h14c3 0 5 1.6 6.5 4.4l5 9.6c.6 1 .5 2 .5 3.2V38H88z"
            />
            <path className={styles.window} d="M93 18h7.5c1.6 0 2.6.8 3.4 2.3l2.4 4.7H93z" />
          </g>
          {[28, 42, 98].map((x) => (
            <g key={x} className={styles.wheel} transform={`translate(${x} 41)`}>
              <circle className={styles.tyre} r="7" />
              <g className={styles.spin}>
                <circle className={styles.hub} r="3" />
                <path className={styles.spokes} d="M-3 0h6M0-3v6" />
              </g>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}
