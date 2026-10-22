import { describe, expect, it } from 'vitest';
import { REPORT_CATALOG, REPORT_CATEGORIES, findReport, reportsInCategory } from './catalog';

describe('report catalog', () => {
  it('has unique slugs and only known categories', () => {
    const slugs = REPORT_CATALOG.map((report) => report.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    const categories = REPORT_CATEGORIES.map((category) => category.id) as string[];
    for (const report of REPORT_CATALOG) expect(categories).toContain(report.category);
  });

  it('finds reports by slug and groups them by category', () => {
    expect(findReport('cash')?.title).toBe('Cash Evidence to Bank');
    expect(findReport('nope')).toBeUndefined();
    expect(reportsInCategory('inventory').map((report) => report.slug)).toEqual([
      'inventory',
      'tank-dip-history',
      'stock-movements',
      'delivery-variance',
    ]);
  });
});
