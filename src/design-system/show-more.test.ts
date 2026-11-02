import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ShowMore } from './show-more';

const render = (shown: number, total: number) =>
  renderToStaticMarkup(createElement(ShowMore, { shown, total, onChange: () => undefined }));

describe('ShowMore', () => {
  it('shows nothing when the whole list already fits', () => {
    expect(render(5, 5)).toBe('');
    expect(render(5, 3)).toBe('');
  });

  it('says how many are showing and offers more, but not fewer, at the start', () => {
    const html = render(5, 12);
    expect(html).toContain('Showing 5 of 12');
    expect(html).toContain('Show more');
    expect(html).not.toContain('Show less');
  });

  it('offers fewer once more are showing, and no more once everything is', () => {
    const middle = render(15, 30);
    expect(middle).toContain('Showing 15 of 30');
    expect(middle).toContain('Show more');
    expect(middle).toContain('Show less');
    const all = render(25, 12);
    expect(all).toContain('Showing 12 of 12');
    expect(all).not.toContain('Show more');
    expect(all).toContain('Show less');
  });
});
