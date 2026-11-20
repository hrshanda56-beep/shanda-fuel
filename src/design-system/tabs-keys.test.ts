import { describe, expect, it } from 'vitest';

import { nextTabIndex } from './tabs-keys';

describe('nextTabIndex', () => {
  it('steps right and left, wrapping round the ends', () => {
    expect(nextTabIndex('ArrowRight', 0, 3)).toBe(1);
    expect(nextTabIndex('ArrowRight', 2, 3)).toBe(0);
    expect(nextTabIndex('ArrowLeft', 1, 3)).toBe(0);
    expect(nextTabIndex('ArrowLeft', 0, 3)).toBe(2);
  });

  it('jumps to the first and last with Home and End', () => {
    expect(nextTabIndex('Home', 2, 4)).toBe(0);
    expect(nextTabIndex('End', 0, 4)).toBe(3);
  });

  it('skips tabs that are hidden', () => {
    const hidden = new Set([1, 2]);
    const visible = (index: number) => !hidden.has(index);
    expect(nextTabIndex('ArrowRight', 0, 4, visible)).toBe(3);
    expect(nextTabIndex('ArrowLeft', 3, 4, visible)).toBe(0);
    expect(nextTabIndex('Home', 1, 4, visible)).toBe(0);
    expect(nextTabIndex('End', 0, 4, visible)).toBe(3);
    expect(nextTabIndex('ArrowRight', 0, 2, () => false)).toBeNull();
  });

  it('leaves every other key alone, and does nothing with no tabs', () => {
    expect(nextTabIndex('Enter', 0, 3)).toBeNull();
    expect(nextTabIndex('a', 0, 3)).toBeNull();
    expect(nextTabIndex('ArrowRight', 0, 0)).toBeNull();
  });
});
