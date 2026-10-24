import { MetricCard } from '@/design-system/layout';
import { moneyOrUnavailable } from '@/modules/profitability/ui/profit-model';
import type { FinanceTile } from '@/modules/reporting/finance-tiles';

const isLoss = (value: string | null) => value !== null && /^-(?!0(\.0+)?$)/.test(value.trim());

/**
 * The owner's finance tiles for the dashboard. Each tile is a whole-card link to the screen that
 * explains it; a figure that is not known reads "Not available" with the reason, never zero.
 * Server-renderable: it takes the tiles from the dashboard response and does no arithmetic.
 */
export function FinanceTiles({ tiles }: { tiles: readonly FinanceTile[] }) {
  return (
    <section className="metric-grid" aria-label="Money at a glance">
      {tiles.map((tile) => (
        <MetricCard
          key={tile.id}
          label={tile.label}
          value={moneyOrUnavailable(tile.value)}
          meta={
            tile.value === null
              ? tile.unavailableReason
              : tile.count !== undefined
                ? `${tile.count} waiting`
                : undefined
          }
          tone={isLoss(tile.value) ? 'critical' : 'default'}
          href={tile.href}
        />
      ))}
    </section>
  );
}
