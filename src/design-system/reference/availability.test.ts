import { describe, expect, it } from 'vitest';

import { isDesignSystemReferenceAvailable } from './availability';

describe('design-system reference availability', () => {
  it('is unavailable in production builds', () => {
    expect(isDesignSystemReferenceAvailable('production')).toBe(false);
  });

  it('is available in development and test', () => {
    expect(isDesignSystemReferenceAvailable('development')).toBe(true);
    expect(isDesignSystemReferenceAvailable('test')).toBe(true);
  });
});
