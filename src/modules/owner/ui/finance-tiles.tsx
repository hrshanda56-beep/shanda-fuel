import { MetricCard } from '@/design-system/layout';
import { moneyOrUnavailable } from '@/modules/profitability/ui/profit-model';
import type { FinanceTile } from '@/modules/reporting/finance-tiles';

const isLoss = (value: string | null) => value !== null && /^-(?!0(\.0+)?$)/.test(value.trim());

const capitalised = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * The owner's finance tiles for the dashboard. Each tile is a whole-card link to the screen that
 * explains it; a figure that is not known reads "Not available" with the reason, never zero.
 * Every tile says what it covers: the chosen period for a total, or "As at [time]" for a position
 * such as stock, cash held or what is owed. Server-renderable: it takes the tiles from the
 * dashboard response and does no arithmetic.
 */
export function FinanceTiles({
  tiles,
  periodPhrase,
  asAt,
}: {
  tiles: readonly FinanceTile[];
  /** The chosen period in words, for example "today" or "this month". */
  periodPhrase: string;
  /** "As at 14:05". */
  asAt: string;
}) {
  return (
    <section className="metric-grid" aria-label="Money at a glance">
      {tiles.map((tile) => {
        const covers = tile.basis === 'as-at' ? asAt : capitalised(periodPhrase);
        const note =
          tile.value === null
            ? tile.unavailableReason
            : tile.count !== undefined
              ? `${tile.count} waiting`
              : undefined;
        return (
          <MetricCard
            key={tile.id}
            label={tile.label}
            value={moneyOrUnavailable(tile.value)}
            meta={note ? `${covers} · ${note}` : covers}
            tone={isLoss(tile.value) ? 'critical' : 'default'}
            href={tile.href}
          />
        );
      })}
    </section>
  );
}
