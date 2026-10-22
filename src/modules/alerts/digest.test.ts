import { describe, expect, it } from 'vitest';
import type { ActionItem } from '../approvals/action-center-model';
import { composeDigest, itemsWorthEmailing, shouldSendDigest } from './digest';

const item = (
  id: string,
  tone: ActionItem['tone'] = 'attention',
  title = `Item ${id}`,
): ActionItem => ({
  id,
  area: 'Operations',
  title,
  detail: `Detail ${id}`,
  href: `/stations/s1/${id}`,
  tone,
});

describe('shouldSendDigest', () => {
  it('stays quiet when nothing needs attention, even if there are notes', () => {
    expect(shouldSendDigest([], [])).toBe(false);
    expect(shouldSendDigest([item('a', 'info')], [])).toBe(false);
  });

  it('sends when something needing attention is new', () => {
    expect(shouldSendDigest([item('a')], [])).toBe(true);
    expect(shouldSendDigest([item('a'), item('b')], ['a'])).toBe(true);
  });

  it('does not repeat an email for alerts that were already sent', () => {
    expect(shouldSendDigest([item('a'), item('b')], ['a', 'b', 'c'])).toBe(false);
  });
});

describe('composeDigest', () => {
  const base = {
    recipientName: 'Rudo',
    stationName: 'Main Station',
    unavailable: [],
    appUrl: 'https://fuel.shandahr.com/',
  };

  it('lists only the things that need attention, with working links', () => {
    const digest = composeDigest({ ...base, items: [item('a'), item('b', 'info'), item('c')] });
    expect(digest.subject).toBe('2 things need your attention at Main Station');
    expect(digest.itemIds).toEqual(['a', 'c']);
    expect(digest.text).toContain('Hello Rudo,');
    expect(digest.text).toContain('https://fuel.shandahr.com/stations/s1/a');
    expect(digest.text).not.toContain('Item b');
    expect(digest.html).toContain('href="https://fuel.shandahr.com/stations/s1/c"');
  });

  it('uses the singular for one alert', () => {
    expect(composeDigest({ ...base, items: [item('a')] }).subject).toBe(
      '1 thing needs your attention at Main Station',
    );
  });

  it('never lets a title or name inject markup', () => {
    const digest = composeDigest({
      ...base,
      recipientName: '<b>Rudo</b>',
      stationName: 'A&B <Station>',
      items: [item('a', 'attention', '<script>alert(1)</script>')],
    });
    expect(digest.html).not.toContain('<script>');
    expect(digest.html).not.toContain('<b>Rudo</b>');
    expect(digest.html).toContain('&lt;script&gt;');
    expect(digest.html).toContain('A&amp;B &lt;Station&gt;');
  });

  it('caps a long list and says how many more there are', () => {
    const items = Array.from({ length: 20 }, (_, i) => item(`i${i}`));
    const digest = composeDigest({ ...base, items });
    expect(digest.text).toContain('...and 5 more.');
    expect(digest.itemIds).toHaveLength(20);
  });

  it('says what could not be checked instead of implying all clear', () => {
    const digest = composeDigest({
      ...base,
      items: [item('a')],
      unavailable: ['Supplier payables'],
    });
    expect(digest.text).toContain('Not checked this time: Supplier payables.');
  });

  it('copes without a recipient name', () => {
    expect(composeDigest({ ...base, recipientName: null, items: [item('a')] }).text).toMatch(
      /^Hello,/,
    );
  });

  it('exposes the filter on its own', () => {
    expect(itemsWorthEmailing([item('a'), item('b', 'info')]).map((i) => i.id)).toEqual(['a']);
  });
});
