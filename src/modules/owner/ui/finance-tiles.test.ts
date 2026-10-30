import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { FinanceTile } from '@/modules/reporting/finance-tiles';
import { FinanceTiles } from './finance-tiles';

const tiles: FinanceTile[] = [
  {
    id: 'grossProfit',
    label: 'Gross profit',
    value: '12.5000',
    href: '/daily-profit',
    basis: 'period',
  },
  {
    id: 'stockValue',
    label: 'Fuel stock value',
    value: null,
    unavailableReason: 'Some stock has no cost yet.',
    href: '/financial-position',
    basis: 'as-at',
  },
  {
    id: 'expensesAwaitingApproval',
    label: 'Expenses awaiting approval',
    value: '7.0000',
    count: 3,
    href: '/expenses',
    basis: 'as-at',
  },
];

describe('FinanceTiles', () => {
  const html = renderToStaticMarkup(
    createElement(FinanceTiles, { tiles, periodPhrase: 'today', asAt: 'As at 14:05' }),
  );

  it('makes each whole tile a link and shows unknown figures as not available, not zero', () => {
    expect(html).toContain('href="/daily-profit"');
    expect(html).toContain('Not available');
    expect(html).toContain('Some stock has no cost yet.');
    expect(html).not.toContain('USD 0.00');
  });

  it('shows how many expenses are waiting', () => {
    expect(html).toContain('3 waiting');
  });

  it('says what each tile covers: the chosen period, or as at a time (B1)', () => {
    expect(html).toContain('Today');
    expect(html).toContain('As at 14:05 · Some stock has no cost yet.');
    expect(html).toContain('As at 14:05 · 3 waiting');
  });

  it('follows the chosen period in its words', () => {
    const month = renderToStaticMarkup(
      createElement(FinanceTiles, { tiles, periodPhrase: 'this month', asAt: 'As at 14:05' }),
    );
    expect(month).toContain('This month');
  });
});
