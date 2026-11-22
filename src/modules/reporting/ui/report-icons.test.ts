import { describe, expect, it } from 'vitest';

import { iconNames } from '../../../design-system/icons';
import { REPORT_CATALOG } from '../catalog';
import { CATEGORY_ICONS, REPORT_ICONS, reportIcon } from './report-icons';

describe('report icons', () => {
  const listed = REPORT_CATALOG.filter((report) => report.listed !== false);

  it('gives every listed report an icon of its own', () => {
    const missing = listed.filter((report) => !(report.slug in REPORT_ICONS));
    expect(missing.map((report) => report.slug)).toEqual([]);
  });

  it('never shows two reports with the same icon', () => {
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const report of listed) {
      const icon = reportIcon(report);
      const other = seen.get(icon);
      if (other) clashes.push(`${report.slug} and ${other} share "${icon}"`);
      seen.set(icon, report.slug);
    }
    expect(clashes).toEqual([]);
  });

  it('only uses icons that exist', () => {
    for (const icon of [...Object.values(REPORT_ICONS), ...Object.values(CATEGORY_ICONS)]) {
      expect(iconNames).toContain(icon);
    }
  });

  it('falls back to the category icon for a report with no entry', () => {
    expect(reportIcon({ slug: 'a-new-report', category: 'cash' })).toBe(CATEGORY_ICONS.cash);
  });
});
