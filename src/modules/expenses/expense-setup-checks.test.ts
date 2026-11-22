import { describe, expect, it } from 'vitest';
import {
  NONE,
  OTHER,
  checkCategoryName,
  checkLimit,
  currentLimitChoice,
  limitChoices,
  limitFieldId,
  limitToSend,
} from './expense-setup-checks';

describe('category name check', () => {
  it('needs a name that is not already used', () => {
    expect(checkCategoryName('', [])).toHaveProperty('new-category');
    expect(checkCategoryName('???', [])).toHaveProperty('new-category');
    expect(checkCategoryName('Repairs', [])).toEqual({});
    expect(checkCategoryName(' repairs ', ['Repairs'])).toHaveProperty('new-category');
    expect(checkCategoryName('Staff meals', ['Repairs'])).toEqual({});
  });
});

describe('approval limit answers', () => {
  it('offers "none", the usual amounts and "another amount"', () => {
    const values = limitChoices('supervisor').map((choice) => choice.value);
    expect(values[0]).toBe(NONE);
    expect(values).toContain('100');
    expect(values.at(-1)).toBe(OTHER);
  });

  it('maps a stored limit to an answer', () => {
    expect(currentLimitChoice('stepUp', null)).toBe(NONE);
    expect(currentLimitChoice('stepUp', '')).toBe(NONE);
    expect(currentLimitChoice('stepUp', '500')).toBe('500');
    expect(currentLimitChoice('stepUp', '500.0000')).toBe('500');
    expect(currentLimitChoice('stepUp', '750')).toBe(OTHER);
    expect(currentLimitChoice('supervisor', '100.00')).toBe('100');
  });

  it('accepts no limit, or an amount with at most two decimals', () => {
    expect(checkLimit('stepUp', '')).toEqual({});
    expect(checkLimit('stepUp', '500')).toEqual({});
    expect(checkLimit('second', 'abc')).toHaveProperty('limit-second');
    expect(checkLimit('supervisor', '0')).toHaveProperty('limit-supervisor');
    expect(checkLimit('supervisor', '10.555')).toHaveProperty('limit-supervisor');
    expect(limitFieldId('stepUp')).toBe('limit-first');
  });

  it('sends null for "no limit" and the exact amount otherwise', () => {
    expect(limitToSend('')).toBeNull();
    expect(limitToSend(' 1,000 ')).toBe('1000');
    expect(limitToSend('abc')).toBeNull();
  });
});
