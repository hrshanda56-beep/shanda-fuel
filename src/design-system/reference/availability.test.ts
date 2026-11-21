import { describe, expect, it } from 'vitest';

import {
  isDesignSystemReferenceAvailable,
  isDevOnlyPath,
  isDevOnlySurfaceAvailable,
} from './availability';

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

describe('development-only paths', () => {
  it('recognises every development-only surface and its sub-paths', () => {
    for (const path of [
      '/dev-preview',
      '/dev-preview/valuation/revaluations/x',
      '/design-system',
      '/design-system/entry',
      '/foundation',
    ]) {
      expect(isDevOnlyPath(path), path).toBe(true);
    }
  });

  it('leaves real pages alone, including names that only start the same way', () => {
    for (const path of ['/', '/settings', '/dev-previews', '/design-systems', '/foundations/x']) {
      expect(isDevOnlyPath(path), path).toBe(false);
    }
  });
});
