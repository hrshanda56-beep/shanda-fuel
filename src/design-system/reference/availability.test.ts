import { describe, expect, it } from 'vitest';

import { isDesignSystemReferenceAvailable, isDevOnlySurfaceAvailable } from './availability';

describe('development-only surface availability', () => {
  it('is available only under next dev', () => {
    expect(isDevOnlySurfaceAvailable('development')).toBe(true);
    expect(isDesignSystemReferenceAvailable('development')).toBe(true);
  });

  it('fails closed for production, test and anything unexpected', () => {
    for (const nodeEnv of ['production', 'test', 'staging', 'Development', '', undefined]) {
      expect(isDevOnlySurfaceAvailable(nodeEnv)).toBe(false);
      expect(isDesignSystemReferenceAvailable(nodeEnv)).toBe(false);
    }
  });
});
