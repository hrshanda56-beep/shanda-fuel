import { addDays, subtractMonths } from '@/modules/reporting/period';
import { exact, sumExact } from '@/modules/reporting/domain';
import { formatTileLitres, formatTileMoney } from '@/modules/reporting/format';

/**
 * Presentation helpers for the dashboard. Every figure is summed with exact
 * decimals from posted (approved) report rows; nothing is estimated, and a
 * missing day stays missing instead of becoming zero.
 */

export type DailyRow = Readonly<{
  reportDate: string;
  stationId: string;
  litresSold: string;
  salesValue: string;
  cashVariance: string;
  inventoryVariance: string;
  customerCreditEvidence: string;
  prepaidEvidence: string;
}>;

export type DailyTotals = Readonly<{
  stationCount: number;
  salesValue: string;
  litresSold: string;
  cashVariance: string;
  inventoryVariance: string;
  accountSales: string;
}>;

/** Null when no approved report exists for the day, so tiles show "—". */
export function dailyTotals(rows: readonly DailyRow[]): DailyTotals | null {
  if (rows.length === 0) return null;
  return {
    stationCount: new Set(rows.map((row) => row.stationId)).size,
    salesValue: sumExact(rows.map((row) => row.salesValue)),
    litresSold: sumExact(rows.map((row) => row.litresSold)),
    cashVariance: sumExact(rows.map((row) => row.cashVariance)),
    inventoryVariance: sumExact(rows.map((row) => row.inventoryVariance)),
    accountSales: sumExact(
      rows.flatMap((row) => [row.customerCreditEvidence, row.prepaidEvidence]),
    ),
  };
}

export const CHART_RANGES = ['7D', '30D', '90D', '12M'] as const;
export type ChartRange = (typeof CHART_RANGES)[number];

type Bucket = { key: string; label: string; from: string; to: string };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function dayLabel(date: string): string {
  const [, month, day] = date.split('-');
  return `${Number(day)} ${MONTHS[Number(month) - 1] ?? ''}`;
}

/**
 * Inclusive date range and buckets for a chart range ending on `today`:
 * 7D and 30D by business day, 90D by 7-day week, 12M by calendar month.
 */
export function chartBuckets(
  range: ChartRange,
  today: string,
): {
  fromDate: string;
  toDate: string;
  buckets: Bucket[];
} {
  if (range === '12M') {
    const fromDate = addDays(subtractMonths(today, 12), 1);
    const buckets: Bucket[] = [];
    let cursor = `${fromDate.slice(0, 7)}-01`;
    while (cursor <= today) {
      const next = subtractMonths(cursor, -1);
      const [year, month] = cursor.split('-');
      buckets.push({
        key: cursor.slice(0, 7),
        label: `${MONTHS[Number(month) - 1] ?? ''} ${year?.slice(2)}`,
        from: cursor < fromDate ? fromDate : cursor,
        to: addDays(next, -1) > today ? today : addDays(next, -1),
      });
      cursor = next;
    }
    return { fromDate, toDate: today, buckets };
  }
  const days = range === '7D' ? 7 : range === '30D' ? 30 : 91;
  const step = range === '90D' ? 7 : 1;
  const fromDate = addDays(today, -(days - 1));
  const buckets: Bucket[] = [];
  for (let offset = 0; offset < days; offset += step) {
    const from = addDays(fromDate, offset);
    const to = addDays(from, step - 1);
    buckets.push({
      key: from,
      label: step === 1 ? dayLabel(from) : `w/c ${dayLabel(from)}`,
      from,
      to,
    });
  }
  return { fromDate, toDate: today, buckets };
}

export type SalesRow = Readonly<{
  businessDate: string;
  productName: string;
  litres: string;
}>;

export type LitresPoint = Readonly<{
  label: string;
  /** Exact total litres, or null when no approved report covers the bucket. */
  litres: string | null;
  products: readonly { name: string; litres: string }[];
}>;

/** Litres per bucket, split by product name exactly as configured. */
export function litresSeries(rows: readonly SalesRow[], buckets: readonly Bucket[]): LitresPoint[] {
  return buckets.map((bucket) => {
    const inside = rows.filter(
      (row) => row.businessDate >= bucket.from && row.businessDate <= bucket.to,
    );
    if (inside.length === 0) return { label: bucket.label, litres: null, products: [] };
    const names = [...new Set(inside.map((row) => row.productName))].sort();
    return {
      label: bucket.label,
      litres: sumExact(inside.map((row) => row.litres)),
      products: names.map((name) => ({
        name,
        litres: sumExact(inside.filter((row) => row.productName === name).map((row) => row.litres)),
      })),
    };
  });
}

/** Range total per product, for the line under the chart. */
export function productTotals(rows: readonly SalesRow[]): { name: string; litres: string }[] {
  const names = [...new Set(rows.map((row) => row.productName))].sort();
  return names.map((name) => ({
    name,
    litres: sumExact(rows.filter((row) => row.productName === name).map((row) => row.litres)),
  }));
}

/** Plotting needs a number; the label and tooltip keep the exact string. */
export function plotValue(litres: string | null): number | null {
  return litres === null ? null : exact(litres).value.toNumber();
}

/** Signed tile wording: zero is "no variance", never a coloured warning. */
export function varianceTone(value: string): 'none' | 'over' | 'short' {
  const decimal = exact(value).value;
  if (decimal.isZero()) return 'none';
  return decimal.isNegative() ? 'short' : 'over';
}

/** "−USD 30.85" / "+USD 2.00" / "USD 0.00": the sign leads the currency. */
export function signedMoney(value: string): string {
  const tone = varianceTone(value);
  const amount = formatTileMoney(exact(value).value.abs().toFixed());
  return tone === 'none' ? amount : `${tone === 'short' ? '−' : '+'}${amount}`;
}

/** "−12 L" / "+4 L" / "0 L". */
export function signedLitres(value: string): string {
  const tone = varianceTone(value);
  const amount = formatTileLitres(exact(value).value.abs().toFixed());
  return tone === 'none' ? amount : `${tone === 'short' ? '−' : '+'}${amount}`;
}

/** Evenly spaced axis labels, always including the first and last. */
export function axisLabels(labels: readonly string[], count = 6): string[] {
  if (labels.length <= count) return [...labels];
  return Array.from(
    { length: count },
    (_, i) => labels[Math.round((i * (labels.length - 1)) / (count - 1))] ?? '',
  );
}
