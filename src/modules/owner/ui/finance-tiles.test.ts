import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { FinanceTile } from '@/modules/reporting/finance-tiles';
import { FinanceTiles } from './finance-tiles';

const tiles: FinanceTile[] = [
  { id: 'grossProfit', label: 'Gross profit', value: '12.5000', href: '/daily-profit' },
  {
    id: 'stockValue',
    label: 'Fuel stock value',
    value: null,
    unavailableReason: 'Some stock has no cost yet.',
    href: '/financial-position',
  },
  {
    id: 'expensesAwaitingApproval',
    label: 'Expenses awaiting approval',
    value: '7.0000',
    count: 3,
    href: '/expenses',
  },
];

describe('FinanceTiles', () => {
  const html = renderToStaticMarkup(createElement(FinanceTiles, { tiles }));

  it('makes each whole tile a link and shows unknown figures as not available, not zero', () => {
    expect(html).toContain('href="/daily-profit"');
    expect(html).toContain('Not available');
    expect(html).toContain('Some stock has no cost yet.');
    expect(html).not.toContain('USD 0.00');
  });

  it('shows how many expenses are waiting', () => {
    expect(html).toContain('3 waiting');
  });
});
