import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Pagination, pageNumbers, type PageSlice } from './pagination';

const slice = (page: number, pages: number, total: number): PageSlice<unknown> => ({
  page,
  pages,
  rows: [],
  from: (page - 1) * 10 + 1,
  to: Math.min(page * 10, total),
  total,
  setPage: () => undefined,
});
const render = (s: PageSlice<unknown>) =>
  renderToStaticMarkup(createElement(Pagination, { slice: s, label: 'Test pages', noun: 'days' }));

describe('pageNumbers', () => {
  it('lists every page of a short run', () => {
    expect(pageNumbers(1, 4)).toEqual([1, 2, 3, 4]);
  });
  it('shows a single hidden page instead of an ellipsis', () => {
    expect(pageNumbers(1, 4)).not.toContain(null);
    expect(pageNumbers(5, 9)).toEqual([1, null, 4, 5, 6, null, 9]);
  });
  it('collapses longer gaps', () => {
    expect(pageNumbers(1, 10)).toEqual([1, 2, null, 10]);
    expect(pageNumbers(10, 10)).toEqual([1, null, 9, 10]);
  });
});

describe('Pagination', () => {
  it('renders nothing when everything fits on one page', () => {
    expect(render(slice(1, 1, 7))).toBe('');
  });
  it('says which rows are showing and marks the current page', () => {
    const html = render(slice(2, 4, 31));
    expect(html).toContain('Showing 11–20 of 31 days');
    expect(html).toContain('aria-current="page"');
  });
  it('disables Previous on the first page and Next on the last', () => {
    expect(render(slice(1, 4, 31))).toMatch(/disabled=""[^>]*>Previous/);
    expect(render(slice(4, 4, 31))).toMatch(/disabled=""[^>]*>Next/);
  });
  it('words a single-row page without a range', () => {
    expect(render(slice(4, 4, 31))).toContain('Showing 31 of 31 days');
  });
  it('keeps Next on the last loaded page while more rows are still to come', () => {
    const html = render({ ...slice(4, 4, 40), more: true });
    expect(html).toContain('Showing 31–40 of 40+ days');
    expect(html).not.toMatch(/disabled=""[^>]*>Next/);
  });
  it('still shows the pager for one loaded page when more rows are to come', () => {
    expect(render({ ...slice(1, 1, 5), more: true })).toContain('of 5+ days');
  });
});
