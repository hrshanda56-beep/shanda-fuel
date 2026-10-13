/**
 * SAMPLE / DEMO report data for the development-only dashboard preview.
 *
 * Every figure here is invented. Product names carry "(sample)" and the
 * organisation is "Shanda Fuel (preview)". Nothing here is used by real API
 * routes: it is returned only by the preview's client-side fetch stand-in,
 * which refuses to answer outside development or test (see isPreviewRuntime).
 *
 * The values follow the dashboard's approved-report rules:
 * - a daily row counts only when it carries reconciliation IDs (approved);
 * - chart rows exist only for approved days, so other days are gaps;
 * - today's chart rows add up to today's daily litres.
 */

import { addDays } from '@/modules/reporting/period';

export type PreviewReportScenario = 'normal' | 'attention' | 'unapproved';

/** Synthetic data may only be served by `next dev` or unit tests, never a build. */
export function isPreviewRuntime(nodeEnv: string | undefined): boolean {
  return nodeEnv === 'development' || nodeEnv === 'test';
}

export const SAMPLE_PRODUCTS = [
  { id: 'sample-diesel', code: 'D-SAMPLE', name: 'Diesel (sample)' },
  { id: 'sample-petrol', code: 'P-SAMPLE', name: 'Petrol (sample)' },
] as const;

/** Today's approved shift at the sample station, in exact decimal strings. */
const TODAY = {
  dieselLitres: '578.400',
  petrolLitres: '706.000',
  litresSold: '1284.400',
  salesValue: '2096.72', // 578.4 × 1.55 + 706.0 × 1.70 (sample prices)
} as const;

/**
 * What each scenario shows on the four tiles:
 * - normal: genuinely nonzero values, including a cash shortage;
 * - attention: an approved day whose cash variance and account sales are zero;
 * - unapproved: activity exists today but nothing is approved, so "—".
 */
const TILE_VALUES: Record<
  PreviewReportScenario,
  { cashVariance: string; customerCreditEvidence: string; prepaidEvidence: string }
> = {
  normal: { cashVariance: '-30.85', customerCreditEvidence: '100.00', prepaidEvidence: '20.00' },
  attention: { cashVariance: '0.00', customerCreditEvidence: '0.00', prepaidEvidence: '0.00' },
  unapproved: { cashVariance: '0.00', customerCreditEvidence: '0.00', prepaidEvidence: '0.00' },
};

export function previewDailyReport(
  scenario: PreviewReportScenario,
  stationId: string,
  stationCode: string,
  today: string,
) {
  const tiles = TILE_VALUES[scenario];
  const approved = scenario !== 'unapproved';
  return {
    report: 'DAILY_OPERATIONS',
    state: 'POSTED',
    sample: true,
    filters: { tenantId: 'preview', stationIds: [stationId], fromDate: today, toDate: today },
    rows: [
      {
        reportDate: today,
        stationId,
        stationCode,
        // An unapproved day still has a row (e.g. a cash collection), with
        // sales filled as "0" exactly as the real report does.
        litresSold: approved ? TODAY.litresSold : '0',
        salesValue: approved ? TODAY.salesValue : '0',
        cashVariance: approved ? tiles.cashVariance : '0',
        customerCreditEvidence: approved ? tiles.customerCreditEvidence : '0',
        prepaidEvidence: approved ? tiles.prepaidEvidence : '0',
        inventoryVariance: '0',
        reconciliationIds: approved ? ['sample-reconciliation-today'] : [],
        collectionIds: approved ? [] : ['sample-collection-today'],
      },
    ],
  };
}

/** Small deterministic hash so a date always gets the same sample litres. */
function dayNumber(date: string): number {
  let hash = 0;
  for (const char of date) hash = (hash * 31 + char.charCodeAt(0)) % 9973;
  return hash;
}

/** Every sixth day (by date) has no approved report, so the chart shows gaps. */
export function isSampleGapDay(date: string): boolean {
  return dayNumber(date) % 6 === 0;
}

function litres(base: number, spread: number, date: string, salt: number): string {
  const value = base + ((dayNumber(date) * salt) % spread) + (dayNumber(date) % 10) / 10;
  return value.toFixed(3);
}

export function previewManagementSales(
  scenario: PreviewReportScenario,
  stationId: string,
  stationCode: string,
  fromDate: string,
  toDate: string,
) {
  const rows: {
    businessDate: string;
    stationId: string;
    stationCode: string;
    productId: string;
    productCode: string;
    productName: string;
    litres: string;
  }[] = [];
  // Cap the walk at a little over a year so a bad range cannot loop forever.
  for (
    let date = fromDate, step = 0;
    date <= toDate && step < 400;
    date = addDays(date, 1), step += 1
  ) {
    const isToday = date === toDate;
    if (isToday ? scenario === 'unapproved' : isSampleGapDay(date)) continue;
    const [diesel, petrol] = SAMPLE_PRODUCTS;
    const row = { businessDate: date, stationId, stationCode };
    rows.push({
      ...row,
      productId: diesel.id,
      productCode: diesel.code,
      productName: diesel.name,
      litres: isToday ? TODAY.dieselLitres : litres(450, 260, date, 7),
    });
    rows.push({
      ...row,
      productId: petrol.id,
      productCode: petrol.code,
      productName: petrol.name,
      litres: isToday ? TODAY.petrolLitres : litres(560, 300, date, 13),
    });
  }
  return {
    report: 'MANAGEMENT_OVERVIEW',
    state: 'POSTED',
    sample: true,
    filters: { tenantId: 'preview', stationIds: [stationId], fromDate, toDate },
    sales: { rows },
  };
}
