import { describe, expect, it } from 'vitest';

import { isOwnerDemoBuildEnabled } from './owner-demo-guard';

describe('owner-demo build guard', () => {
  it('allows only the explicit demo environment', () => {
    expect(isOwnerDemoBuildEnabled('demo')).toBe(true);
    expect(isOwnerDemoBuildEnabled('local')).toBe(false);
    expect(isOwnerDemoBuildEnabled('test')).toBe(false);
    expect(isOwnerDemoBuildEnabled('staging')).toBe(false);
    expect(isOwnerDemoBuildEnabled('production')).toBe(false);
    expect(isOwnerDemoBuildEnabled(undefined)).toBe(false);
  });
});
