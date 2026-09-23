import { describe, expect, it } from 'vitest';
import { assertStagingSmokeAllowed } from './staging-smoke';

describe('staging smoke guard', () => {
  it('refuses production', () => {
    expect(() => assertStagingSmokeAllowed('production')).toThrow(
      'Refusing staging smoke in production',
    );
  });

  it('only allows the staging environment', () => {
    expect(() => assertStagingSmokeAllowed('local')).toThrow('requires APP_ENV=staging');
    expect(() => assertStagingSmokeAllowed(undefined)).toThrow('requires APP_ENV=staging');
    expect(() => assertStagingSmokeAllowed('staging')).not.toThrow();
  });
});
