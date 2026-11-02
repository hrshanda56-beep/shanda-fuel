import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { FinanceTile } from '@/modules/reporting/finance-tiles';
import { FinanceTiles } from './finance-tiles';

const tiles: FinanceTile[] = [
  {
    id: 'profit',
    label: 'Profit',
    value: '12.5000',
    href: '/profitability?view=daily',
    basis: 'period',
  },
  {
    id: 'stockValue',
    label: 'Fuel stock value',
    value: null,
    unavailableReason: 'Some stock has no cost yet.',
    href: '/profitability?view=position',
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
    expect(html).toContain('href="/profitability?view=daily"');
    expect(html).toContain('Not available');
    expect(html).toContain('Some stock has no cost yet.');
    expect(html).not.toContain('USD 0.00');
  });

  it('shows how many expenses are waiting', () => {
    expect(html).toContain('3 waiting');
  });

  it('says what each tile covers: the chosen period, or as at a time (B1)', () => {
    expect(html).toContain('Today');
    expect(html).toContain('As at 14:05 · 3 waiting');
  });

  it('keeps the reason a figure is missing behind the "?", not on the card line', () => {
    expect(html).toContain('About Fuel stock value');
    expect(html).not.toContain('As at 14:05 · Some stock has no cost yet.');
  });

  it('follows the chosen period in its words', () => {
    const month = renderToStaticMarkup(
      createElement(FinanceTiles, { tiles, periodPhrase: 'this month', asAt: 'As at 14:05' }),
    );
    expect(month).toContain('This month');
  });
});
