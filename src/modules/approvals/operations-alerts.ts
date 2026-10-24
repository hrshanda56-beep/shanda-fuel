import { formatLitres, formatUsd } from '../../design-system/formatters';
import { ExactDecimal } from '../../platform/domain/primitives';

/**
 * Daily-operations alerts for one station: late reports, cash shortages, stock that does not match
 * the dip, low stock and card or mobile payments that have not been settled. Pure and exact; the
 * server code that reads the facts lives next to the Action Center loader.
 */

/**
 * Reminder thresholds. These are the working defaults until the client sets their own; each one
 * can be overridden per organisation (see alert settings) and none of them blocks any work.
 */
export type AlertSettings = Readonly<{
  /** Supplier invoices due within this many days (after today) are "due soon". */
  dueSoonDays: number;
  /** Card and mobile payments unsettled after this many days are overdue. */
  posSettlementLagDays: number;
  /** A day's report is late once it is this many days old and still not submitted. */
  reportGraceDays: number;
  /** Cash shortages smaller than this are not worth an alert. */
  cashShortageMinimum: string;
}>;

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  dueSoonDays: 7,
  posSettlementLagDays: 3,
  reportGraceDays: 1,
  cashShortageMinimum: '0.01',
};

export type AlertSettingsRow = Readonly<{
  due_soon_days: number | string;
  pos_settlement_lag_days: number | string;
  report_grace_days: number | string;
  cash_shortage_minimum: string;
}>;

/** The settings in force: the organisation's own row when it has one, otherwise the defaults. */
export function alertSettingsFromRow(row: AlertSettingsRow | null | undefined): AlertSettings {
  if (!row) return DEFAULT_ALERT_SETTINGS;
  return {
    dueSoonDays: Number(row.due_soon_days),
    posSettlementLagDays: Number(row.pos_settlement_lag_days),
    reportGraceDays: Number(row.report_grace_days),
    cashShortageMinimum: new ExactDecimal(row.cash_shortage_minimum).toString(),
  };
}

export type StockSignal = 'ok' | 'watch' | 'alert' | 'unjudged';

/**
 * Green, yellow or red for a tank. Within the tolerance is fine; up to twice the tolerance is a
 * warning; beyond that is an alert. Without a dip or a tolerance nothing is judged, which is shown
 * as "not checked" and never as green.
 */
export function classifyStockVariance(
  variance: string | null,
  tolerance: string | null,
): StockSignal {
  if (variance === null || tolerance === null) return 'unjudged';
  const limit = new ExactDecimal(tolerance).value;
  if (limit.isNegative()) return 'unjudged';
  const size = new ExactDecimal(variance).value.abs();
  if (size.lte(limit)) return 'ok';
  return size.lte(limit.mul(2)) ? 'watch' : 'alert';
}

export type TankAlertFacts = Readonly<{
  tankId: string;
  tankCode: string;
  productName: string;
  expectedLitres: string;
  /** The latest dip, and the book stock at the moment it was taken. */
  physicalLitres: string | null;
  varianceAtDipLitres: string | null;
  toleranceLitres: string | null;
  reorderLevelLitres: string | null;
}>;

export type OperationsFacts = Readonly<{
  /** Today's date at the station, from the station's own timezone. */
  today: string;
  /** Business dates with an operated shift but no submitted reconciliation. */
  unsubmittedDates: readonly string[];
  /** Days (newest first) where counted cash was less than expected. Amount is the shortage. */
  cashShortages: readonly { businessDate: string; amount: string }[];
  tanks: readonly TankAlertFacts[];
  /** Business dates of card or mobile payments not yet matched to a provider settlement. */
  unsettledPaymentDates: readonly string[];
}>;

export type OperationsAlert = Readonly<{
  id: string;
  title: string;
  detail: string;
  href: string;
  tone: 'attention' | 'info';
}>;

const DAY_MS = 86_400_000;

function dayNumber(isoDate: string): number {
  const [year, month, day] = isoDate.split('-').map(Number);
  return Date.UTC(year!, month! - 1, day!) / DAY_MS;
}

export function daysBetween(earlier: string, later: string): number {
  return dayNumber(later) - dayNumber(earlier);
}

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

export function buildOperationsAlerts(
  facts: OperationsFacts,
  settings: AlertSettings,
  station: { id: string },
): OperationsAlert[] {
  const out: OperationsAlert[] = [];
  const stationPath = `/stations/${encodeURIComponent(station.id)}`;

  const late = facts.unsubmittedDates.filter(
    (date) => daysBetween(date, facts.today) >= settings.reportGraceDays,
  );
  if (late.length > 0) {
    const oldest = [...late].sort()[0]!;
    out.push({
      id: 'reports-late',
      title:
        late.length === 1
          ? `The report for ${late[0]} has not been submitted`
          : `${late.length} daily reports have not been submitted`,
      detail:
        late.length === 1
          ? 'The day has been worked but its reconciliation is still not in.'
          : `The oldest is ${oldest}. Each worked day needs its reconciliation submitted.`,
      href: `${stationPath}/reconciliations`,
      tone: 'attention',
    });
  }

  const minimum = new ExactDecimal(settings.cashShortageMinimum).value;
  const shortages = facts.cashShortages.filter((row) =>
    new ExactDecimal(row.amount).value.gte(minimum),
  );
  for (const row of shortages.slice(0, 3)) {
    out.push({
      id: `cash-short-${row.businessDate}`,
      title: `Cash was ${formatUsd(row.amount)} short on ${row.businessDate}`,
      detail: 'The cash counted was less than the cash expected from sales.',
      href: `${stationPath}/reconciliations`,
      tone: 'attention',
    });
  }
  if (shortages.length > 3) {
    out.push({
      id: 'cash-short-more',
      title: `${shortages.length - 3} more ${plural(shortages.length - 3, 'day', 'days')} with a cash shortage`,
      detail: 'See the reconciliations for the other days.',
      href: `${stationPath}/reconciliations`,
      tone: 'info',
    });
  }

  for (const tank of facts.tanks) {
    const signal = classifyStockVariance(tank.varianceAtDipLitres, tank.toleranceLitres);
    if (signal === 'watch' || signal === 'alert') {
      const variance = new ExactDecimal(tank.varianceAtDipLitres!);
      const direction = variance.value.isNegative() ? 'under' : 'over';
      out.push({
        id: `stock-variance-${tank.tankId}`,
        title: `${tank.tankCode} (${tank.productName}) is ${formatLitres(variance.value.abs().toString())} ${direction} book stock`,
        detail:
          signal === 'alert'
            ? 'The dip is well outside the acceptable difference. Check for a leak, a missed delivery or a meter fault.'
            : 'The dip is outside the acceptable difference for this tank.',
        href: '/inventory',
        tone: signal === 'alert' ? 'attention' : 'info',
      });
    }
    if (
      tank.reorderLevelLitres !== null &&
      new ExactDecimal(tank.expectedLitres).value.lte(
        new ExactDecimal(tank.reorderLevelLitres).value,
      )
    ) {
      out.push({
        id: `stock-low-${tank.tankId}`,
        title: `${tank.tankCode} (${tank.productName}) is at or below its reorder level`,
        detail: `${formatLitres(tank.expectedLitres)} left by the books. Time to order fuel.`,
        href: '/inventory',
        tone: 'attention',
      });
    }
  }

  const overdueSettlements = facts.unsettledPaymentDates.filter(
    (date) => daysBetween(date, facts.today) > settings.posSettlementLagDays,
  );
  if (overdueSettlements.length > 0) {
    out.push({
      id: 'settlements-overdue',
      title: `${overdueSettlements.length} card or mobile ${plural(overdueSettlements.length, 'payment is', 'payments are')} overdue for settlement`,
      detail: `Not matched to a provider settlement after ${settings.posSettlementLagDays} days.`,
      href: `${stationPath}/settlements`,
      tone: 'attention',
    });
  }
  return out;
}
