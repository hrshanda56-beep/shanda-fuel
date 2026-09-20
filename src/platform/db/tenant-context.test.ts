import { describe, expect, it } from 'vitest';
import { parseTenantTransactionContext } from './tenant-context';

const baseContext = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  actorId: '22222222-2222-4222-8222-222222222222',
};

describe('tenant transaction context', () => {
  it('accepts a valid tenant and actor context', () => {
    expect(parseTenantTransactionContext(baseContext)).toEqual(baseContext);
  });

  it('fails closed for missing, malformed, or inconsistent scope', () => {
    expect(() => parseTenantTransactionContext({})).toThrow('valid tenant and actor context');
    expect(() => parseTenantTransactionContext({ ...baseContext, tenantId: 'tenant-a' })).toThrow(
      'valid tenant and actor context',
    );
    expect(() =>
      parseTenantTransactionContext({
        ...baseContext,
        stationId: '33333333-3333-4333-8333-333333333333',
      }),
    ).toThrow('valid tenant and actor context');
  });
});
