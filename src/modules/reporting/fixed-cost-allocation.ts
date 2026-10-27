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

export function fixedCostIsActiveOnDate(
  date: string,
  startDate: string,
  endDate: string | null,
): boolean {
  return date >= startDate && (endDate === null || date <= endDate);
}
