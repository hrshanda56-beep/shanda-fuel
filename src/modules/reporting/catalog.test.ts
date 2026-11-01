import { describe, expect, it } from 'vitest';
import {
  REPORT_CATALOG,
  REPORT_CATEGORIES,
  findReport,
  reportsFor,
  reportsInCategory,
} from './catalog';

describe('report catalog', () => {
  it('has unique slugs and only known categories', () => {
    const slugs = REPORT_CATALOG.map((report) => report.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    const categories = REPORT_CATEGORIES.map((category) => category.id) as string[];
    for (const report of REPORT_CATALOG) expect(categories).toContain(report.category);
  });

  it('finds reports by slug and groups them by category', () => {
    expect(findReport('nope')).toBeUndefined();
    expect(reportsInCategory('inventory').map((report) => report.slug)).toEqual([
      'tank-dip-history',
      'stock-movements',
      'delivery-variance',
      'stock-variance',
    ]);
  });

  it('keeps the overview views reachable but out of the list', () => {
    const overviews = ['sales', 'cash', 'providers', 'commercial', 'inventory'];
    const offered = reportsFor(true).map((report) => report.slug);
    for (const slug of overviews) {
      expect(findReport(slug)).toBeDefined();
      expect(offered).not.toContain(slug);
    }
  });

  it('no longer offers the reports that duplicated others', () => {
    for (const slug of ['purchases', 'supplier-payments', 'station-daily-report']) {
      expect(findReport(slug)).toBeUndefined();
    }
  });
});
