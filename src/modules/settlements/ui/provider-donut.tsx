import { formatTileMoney } from '@/modules/reporting/format';

import type { ProviderShare } from './settlement-summary';

const COLOURS = ['#2f7d62', '#ecd57a', '#8fb7d9', '#d9a38f', '#b5a8d9', '#c3d9b8'];
const RADIUS = 15.915; // circumference ≈ 100, so shares map straight to dash lengths

/**
 * Share of gross settled per provider. The legend carries the same figures as
 * text, so the colours are never the only way to read it.
 */
export function ProviderDonut({ shares }: { shares: readonly ProviderShare[] }) {
  const currencies = new Set(shares.map((share) => share.currency));
  const drawable = currencies.size === 1 && shares.some((share) => share.share > 0);
  const starts = shares.map((_, index) =>
    shares.slice(0, index).reduce((sum, share) => sum + share.share * 100, 0),
  );
  return (
    <figure className="provider-donut">
      {drawable ? (
        <svg viewBox="0 0 42 42" aria-hidden="true" className="provider-donut-chart">
          <circle cx="21" cy="21" r={RADIUS} className="provider-donut-track" />
          {shares.map((share, index) => {
            const length = share.share * 100;
            return (
              <circle
                key={share.key}
                cx="21"
                cy="21"
                r={RADIUS}
                fill="none"
                stroke={COLOURS[index % COLOURS.length]}
                strokeWidth="6"
                strokeDasharray={`${length} ${100 - length}`}
                strokeDashoffset={25 - (starts[index] ?? 0)}
              />
            );
          })}
        </svg>
      ) : null}
      <figcaption>
        <ul className="provider-donut-legend">
          {shares.map((share, index) => (
            <li key={share.key}>
              <span
                className="provider-donut-swatch"
                style={{ background: drawable ? COLOURS[index % COLOURS.length] : undefined }}
                aria-hidden="true"
              />
              <span className="provider-donut-name">{share.name}</span>
              <span className="provider-donut-value">
                {formatTileMoney(share.gross, share.currency)}
                {drawable ? ` · ${Math.round(share.share * 100)}%` : ''}
              </span>
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}
