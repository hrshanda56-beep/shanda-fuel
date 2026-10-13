import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/design-system/icons', () => ({ Icon: () => null }));

import { niceMax, PerformanceChart, runs, smoothPath } from './performance-chart';

const render = (series: { label: string; value: number | null }[] | null) =>
  renderToStaticMarkup(
    createElement(PerformanceChart, {
      series,
      xLabels: ['A', 'B', 'C'],
      formatValue: String,
      emptyMessage: 'No data yet.',
      label: 'Sales',
    }),
  );

describe('niceMax', () => {
  it('rounds up to a tidy scale that covers the data', () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(-5)).toBe(1);
    expect(niceMax(100)).toBe(100);
    for (const max of [0.3, 7, 42, 101, 999, 12345])
      expect(niceMax(max)).toBeGreaterThanOrEqual(max);
  });
});

describe('smoothPath', () => {
  it('is empty without points and starts at the first point otherwise', () => {
    expect(smoothPath([])).toBe('');
    expect(smoothPath([{ x: 3, y: 4 }])).toBe('M 3 4');
    expect(
      smoothPath([
        { x: 0, y: 10 },
        { x: 10, y: 0 },
      ]).startsWith('M 0 10 C'),
    ).toBe(true);
  });
});

describe('PerformanceChart', () => {
  it('shows the empty message and draws no line when there is no series', () => {
    for (const html of [render(null), render([])]) {
      expect(html).toContain('No data yet.');
      expect(html).not.toContain('perf-chart-line');
      expect(html).not.toContain('tabindex');
    }
  });

  it('draws the line and becomes focusable when given data', () => {
    const html = render([
      { label: 'A', value: 1 },
      { label: 'B', value: 3 },
    ]);
    expect(html).toContain('perf-chart-line');
    expect(html).toContain('tabindex="0"');
    expect(html).not.toContain('No data yet.');
  });

  it('draws a single point as a visible marker', () => {
    expect(render([{ label: 'A', value: 5 }])).toContain('perf-chart-point');
  });

  it('treats an all-gap series as empty and breaks the line at gaps', () => {
    expect(render([{ label: 'A', value: null }])).toContain('No data yet.');
    const html = render([
      { label: 'A', value: 1 },
      { label: 'B', value: 2 },
      { label: 'C', value: null },
      { label: 'D', value: 4 },
    ]);
    expect(html.match(/perf-chart-line/g)).toHaveLength(1);
    expect(html).toContain('perf-chart-point');
  });
});

describe('runs', () => {
  it('splits on nulls', () => {
    expect(runs([1, 2, null, 3, null, null])).toEqual([[1, 2], [3]]);
    expect(runs([null])).toEqual([]);
  });
});
