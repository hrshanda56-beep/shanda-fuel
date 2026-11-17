import { describe, expect, it } from 'vitest';
import {
  dipSentence,
  fillPercent,
  placeholderTankCount,
  runningBalances,
  tankTabFrom,
} from './tank-detail-model';

describe('dipSentence', () => {
  it('says what to do for each result', () => {
    expect(dipSentence('-24', 'ok')).toBe('24 L under the books, within the limit.');
    expect(dipSentence('60', 'watch')).toBe('60 L over the books. Please explain the difference.');
    expect(dipSentence('-150', 'alert')).toBe('150 L under the books. Check this tank now.');
    expect(dipSentence('5', 'unjudged')).toContain('No limit is set yet');
  });

  it('handles a perfect match and unusable numbers', () => {
    expect(dipSentence('0', 'ok')).toBe('Exactly what the books expected.');
    expect(dipSentence('abc', 'ok')).toBe('This dip could not be compared with the books.');
  });
});

describe('fillPercent', () => {
  it('rounds and clamps', () => {
    expect(fillPercent('20000', '50000')).toBe(40);
    expect(fillPercent('-5', '50000')).toBe(0);
    expect(fillPercent('60000', '50000')).toBe(100);
  });
  it('is null without a usable capacity', () => {
    expect(fillPercent('10', '0')).toBeNull();
  });
});

describe('runningBalances', () => {
  it('walks back from the current stock', () => {
    expect(
      runningBalances([{ quantityLitres: '-500' }, { quantityLitres: '20000' }], '19500'),
    ).toEqual(['19500', '20000']);
  });
});

describe('placeholderTankCount', () => {
  it('offers a single "Add a tank" slot, never several identical ones (C8)', () => {
    expect(placeholderTankCount(0)).toBe(1);
    expect(placeholderTankCount(1)).toBe(1);
    expect(placeholderTankCount(2)).toBe(1);
    expect(placeholderTankCount(3)).toBe(1);
    expect(placeholderTankCount(4)).toBe(0);
    expect(placeholderTankCount(5)).toBe(1);
  });
});

describe('tankTabFrom', () => {
  it('only offers Settings to people who can change it', () => {
    expect(tankTabFrom('settings', true)).toBe('settings');
    expect(tankTabFrom('settings', false)).toBe('dips');
    expect(tankTabFrom('movements', false)).toBe('movements');
    expect(tankTabFrom('nonsense', true)).toBe('dips');
  });
});
