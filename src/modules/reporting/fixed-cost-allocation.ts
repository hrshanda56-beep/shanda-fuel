import { dailyRecognitionSchedule } from '../expenses/domain';

function daysInMonth(date: string): number {
  const [year, month] = date.slice(0, 7).split('-').map(Number) as [number, number];
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The exact fixed-cost amount for one calendar day, with the month's remainder on its last day. */
export function fixedCostAmountForDate(monthlyAmount: string, date: string): string {
  const schedule = dailyRecognitionSchedule(monthlyAmount, daysInMonth(date));
  return schedule[Number(date.slice(8, 10)) - 1] ?? '0.0000';
}

export type RecurringCostForAllocation = Readonly<{
  id: string;
  stationId: string;
  /** The monthly amount. */
  amount: string;
  startDate: string;
  endDate: string | null;
}>;

export type FixedCostDay = Readonly<{
  templateId: string;
  stationId: string;
  businessDate: string;
  amount: string;
}>;

function nextDay(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

/**
 * The one rule for a recurring cost, used by every screen and report: it is active from its start
 * date (to its end date, if any) and each active day carries its monthly amount divided by the
 * days in that month, with the month's remainder on its last day. A day that already has a
 * recorded recognition for the same cost (`station:date:template`) is left to that record, so
 * nothing is counted twice. Nobody has to add a month for the cost to count.
 */
export function allocateFixedCosts(
  templates: readonly RecurringCostForAllocation[],
  recognised: ReadonlySet<string>,
  fromDate: string,
  toDate: string,
): FixedCostDay[] {
  const rows: FixedCostDay[] = [];
  for (const template of templates) {
    const first = template.startDate > fromDate ? template.startDate : fromDate;
    const last = template.endDate && template.endDate < toDate ? template.endDate : toDate;
    for (let date = first; date <= last; date = nextDay(date)) {
      if (recognised.has(`${template.stationId}:${date}:${template.id}`)) continue;
      if (!fixedCostIsActiveOnDate(date, template.startDate, template.endDate)) continue;
      rows.push({
        templateId: template.id,
        stationId: template.stationId,
        businessDate: date,
        amount: fixedCostAmountForDate(template.amount, date),
      });
    }
  }
  return rows;
}

export function fixedCostIsActiveOnDate(
  date: string,
  startDate: string,
  endDate: string | null,
): boolean {
  return date >= startDate && (endDate === null || date <= endDate);
}
