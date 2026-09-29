import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ConfirmDialog, WorkInProgressDialog } from './dialogs';
import { NeedsAttention, Notice, type AttentionItem } from './feedback';

const items: AttentionItem[] = [
  { id: 'info', priority: 'info', title: 'Delivery note uploaded' },
  { id: 'crit', priority: 'critical', title: 'Business day not closed' },
  { id: 'warn', priority: 'warning', title: 'Meter variance' },
];

describe('NeedsAttention', () => {
  it('orders items by priority', () => {
    const markup = renderToStaticMarkup(createElement(NeedsAttention, { items }));

    const order = ['Business day not closed', 'Meter variance', 'Delivery note uploaded'].map(
      (title) => markup.indexOf(title),
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('caps visible items and only then shows view all', () => {
    const capped = renderToStaticMarkup(
      createElement(NeedsAttention, { items, limit: 2, viewAll: 'View all' }),
    );
    const uncapped = renderToStaticMarkup(
      createElement(NeedsAttention, { items, limit: 5, viewAll: 'View all' }),
    );

    expect(capped).not.toContain('Delivery note uploaded');
    expect(capped).toContain('View all');
    expect(uncapped).not.toContain('View all');
  });

  it('gives priority a text equivalent, not colour alone', () => {
    const markup = renderToStaticMarkup(createElement(NeedsAttention, { items }));

    expect(markup).toContain('Critical: </span>Business day not closed');
  });

  it('gives each instance a unique heading id', () => {
    const markup = renderToStaticMarkup(
      createElement(
        Fragment,
        null,
        createElement(NeedsAttention, { items }),
        createElement(NeedsAttention, { items: [] }),
      ),
    );
    const ids = [...markup.matchAll(/<h2[^>]*id="([^"]+)"/g)].map((match) => match[1]);

    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) expect(markup).toContain(`aria-labelledby="${id}"`);
  });

  it('gives the count a text equivalent instead of aria-label on a generic span', () => {
    const many = renderToStaticMarkup(createElement(NeedsAttention, { items }));
    const one = renderToStaticMarkup(createElement(NeedsAttention, { items: items.slice(0, 1) }));

    expect(many).toContain(
      '<span class="attention-count">3<span class="visually-hidden"> items</span></span>',
    );
    expect(one).toContain('1<span class="visually-hidden"> item</span>');
    expect(many).not.toContain('aria-label="');
  });

  it('renders a calm empty state', () => {
    const markup = renderToStaticMarkup(createElement(NeedsAttention, { items: [] }));

    expect(markup).toContain('Nothing needs your attention right now.');
    expect(markup).not.toContain('attention-count');
  });
});

describe('Notice', () => {
  it('announces critical notices assertively and keeps info passive', () => {
    expect(
      renderToStaticMarkup(createElement(Notice, { tone: 'critical', title: 'Failed' })),
    ).toContain('role="alert"');
    expect(
      renderToStaticMarkup(createElement(Notice, { tone: 'info', title: 'FYI' })),
    ).not.toContain('role=');
  });
});

describe('dialogs', () => {
  it('render nothing while closed', () => {
    const confirm = renderToStaticMarkup(
      createElement(ConfirmDialog, {
        open: false,
        onClose: () => {},
        onConfirm: () => {},
        title: 'Approve?',
        consequence: 'Posts the reconciliation.',
        confirmLabel: 'Approve',
      }),
    );
    const wip = renderToStaticMarkup(
      createElement(WorkInProgressDialog, { open: false, onClose: () => {}, feature: 'Reports' }),
    );

    expect(confirm).toBe('');
    expect(wip).toBe('');
  });
});
