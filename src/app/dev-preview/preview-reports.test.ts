import { describe, expect, it } from 'vitest';

import { dailyTotals, litresSeries, chartBuckets } from '../_overview/dashboard-figures';
import { fixtureAnswer, SCENARIOS } from './fixtures';
import {
  isPreviewRuntime,
  isSampleGapDay,
  previewDailyReport,
  previewManagementSales,
  SAMPLE_PRODUCTS,
} from './preview-reports';

const TODAY = '2026-10-11';
const STATION = '00000000-0000-4000-8000-000000000003';
const url = (path: string) => new URL(`http://127.0.0.1:3100${path}`);
const DECIMAL = /^-?\d+(?:\.\d+)?$/;

describe('preview sample data stays out of real builds', () => {
  it('only runs under next dev or unit tests', () => {
    expect(isPreviewRuntime('development')).toBe(true);
    expect(isPreviewRuntime('test')).toBe(true);
    expect(isPreviewRuntime('production')).toBe(false);
    expect(isPreviewRuntime(undefined)).toBe(false);
    expect(isPreviewRuntime('')).toBe(false);
  });

  it('answers nothing outside development or test, for every path and scenario', () => {
    const paths = [
      '/api/context',
      '/api/forecourt/operations/overview',
      '/api/customers/summary',
      '/api/reports/daily?tenantId=t&stationIds=s',
      '/api/reports/management?tenantId=t&fromDate=2026-10-05&toDate=2026-10-11',
    ];
    for (const nodeEnv of ['production', undefined, 'staging']) {
      for (const scenario of SCENARIOS) {
        for (const path of paths) {
          expect(fixtureAnswer(url(path), scenario, nodeEnv, TODAY)).toBeNull();
        }
      }
    }
  });

  it('never answers paths it does not own, even in development', () => {
    for (const path of ['/api/reports/export', '/api/cash/summary', '/api/forecourt/commands']) {
      expect(fixtureAnswer(url(path), 'normal', 'development', TODAY)).toBeNull();
    }
  });

  it('keeps the loading and error scenarios for the report requests', () => {
    expect(fixtureAnswer(url('/api/reports/daily'), 'loading', 'development', TODAY)).toBe('hang');
    expect(fixtureAnswer(url('/api/reports/management'), 'error', 'development', TODAY)).toEqual({
      status: 500,
      body: { message: 'Preview: simulated server error.' },
    });
  });
});

describe('sample figures follow the approved-report rules', () => {
  const daily = (scenario: 'normal' | 'attention' | 'unapproved') =>
    dailyTotals(previewDailyReport(scenario, STATION, 'HRE', TODAY).rows);

  it('normal shows genuinely nonzero values, including a cash shortage', () => {
    expect(daily('normal')).toMatchObject({
      salesValue: '2096.72',
      litresSold: '1284.4',
      cashVariance: '-30.85',
      accountSales: '120',
    });
  });

  it('attention shows an approved day whose cash variance and account sales are zero', () => {
    const totals = daily('attention');
    expect(totals).not.toBeNull();
    expect(totals).toMatchObject({ cashVariance: '0', accountSales: '0' });
    expect(totals?.salesValue).toBe('2096.72');
  });

  it('unapproved has a row for the day but nothing approved, so the tiles show "—"', () => {
    const report = previewDailyReport('unapproved', STATION, 'HRE', TODAY);
    expect(report.rows).toHaveLength(1);
    expect(daily('unapproved')).toBeNull();
  });

  it("today's chart litres add up to today's tile litres", () => {
    const sales = previewManagementSales('normal', STATION, 'HRE', '2026-10-05', TODAY).sales.rows;
    const series = litresSeries(sales, chartBuckets('7D', TODAY).buckets);
    expect(series.at(-1)?.litres).toBe(daily('normal')?.litresSold);
  });

  it('leaves gap days and an unapproved today out of the chart', () => {
    const range = previewManagementSales('normal', STATION, 'HRE', '2026-09-12', TODAY).sales.rows;
    const dates = new Set(range.map((row) => row.businessDate));
    for (const date of dates) expect(date === TODAY || !isSampleGapDay(date)).toBe(true);
    expect([...dates].length).toBeLessThan(30);
    const unapproved = previewManagementSales('unapproved', STATION, 'HRE', '2026-10-05', TODAY);
    expect(unapproved.sales.rows.some((row) => row.businessDate === TODAY)).toBe(false);
  });

  it('labels every product as sample data and uses exact decimal strings in range', () => {
    const report = previewManagementSales('normal', STATION, 'HRE', '2025-10-12', TODAY);
    expect(report.sample).toBe(true);
    for (const row of report.sales.rows) {
      expect(row.productName).toMatch(/\(sample\)$/);
      expect(row.litres).toMatch(DECIMAL);
      expect(row.businessDate >= '2025-10-12' && row.businessDate <= TODAY).toBe(true);
    }
    expect(SAMPLE_PRODUCTS.every((product) => product.name.includes('(sample)'))).toBe(true);
  });

  it('is deterministic for the same range', () => {
    const a = previewManagementSales('normal', STATION, 'HRE', '2026-07-01', TODAY);
    const b = previewManagementSales('normal', STATION, 'HRE', '2026-07-01', TODAY);
    expect(a).toEqual(b);
  });

  it('answers the dashboard requests through the fixture in development', () => {
    const answer = fixtureAnswer(
      url(
        `/api/reports/management?tenantId=t&stationIds=${STATION}&fromDate=2026-10-05&toDate=${TODAY}`,
      ),
      'normal',
      'development',
      TODAY,
    );
    expect(answer).not.toBeNull();
    expect(answer).not.toBe('hang');
    if (answer && answer !== 'hang') {
      expect(answer.status).toBe(200);
      expect((answer.body as { sample: boolean }).sample).toBe(true);
    }
  });
});
