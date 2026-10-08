import { describe, expect, it } from 'vitest';
import { QUICK_ACTIONS, categoryHref, parseCategoryParam, quickActionHref } from './rail';
import { findReport } from './catalog';

const A = '11111111-1111-4111-8111-111111111111';

describe('reports rail links', () => {
  it('points every quick action at a real report', () => {
    for (const action of QUICK_ACTIONS) expect(findReport(action.slug)).toBeDefined();
  });

  it('keeps the stations and sets the action period', () => {
    const href = quickActionHref(QUICK_ACTIONS[0]!, 't1', [A]);
    expect(href).toBe(`/reports/sales?tenantId=t1&stations=${A}&period=last-month`);
  });

  it('omits the default period and stations', () => {
    expect(quickActionHref(QUICK_ACTIONS[1]!, 't1', [])).toBe('/reports/cash?tenantId=t1');
  });

  it('sets and clears the category while keeping other filters', () => {
    const current = new URLSearchParams(`tenantId=t1&period=3m`);
    expect(categoryHref('/reports', current, 'cash')).toBe(
      '/reports?tenantId=t1&period=3m&category=cash',
    );
    const withCategory = new URLSearchParams('tenantId=t1&category=cash');
    expect(categoryHref('/reports', withCategory, null)).toBe('/reports?tenantId=t1');
  });

  it('ignores unknown categories', () => {
    expect(parseCategoryParam('cash')).toBe('cash');
    expect(parseCategoryParam('nope')).toBeNull();
    expect(parseCategoryParam(null)).toBeNull();
  });
});
