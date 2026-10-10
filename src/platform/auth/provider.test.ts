import { describe, expect, it } from 'vitest';

import { assertAuthProviderName } from './provider';

describe('provider selection', () => {
  it('accepts only the two explicit providers', () => {
    expect(assertAuthProviderName('BETTER_AUTH')).toBe('BETTER_AUTH');
    expect(assertAuthProviderName('CLERK')).toBe('CLERK');
    expect(() => assertAuthProviderName(undefined)).toThrow('provider configuration is invalid');
    expect(() => assertAuthProviderName('fallback')).toThrow('provider configuration is invalid');
  });
});
