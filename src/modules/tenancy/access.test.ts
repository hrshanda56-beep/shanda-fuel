import { describe, expect, it } from 'vitest';
import { assertActiveTenantMembership } from './access';

const context = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  actorId: '22222222-2222-4222-8222-222222222222',
  membershipId: '33333333-3333-4333-8333-333333333333',
};

describe('tenant membership guard', () => {
  it('accepts the active membership that matches the request context', () => {
    expect(() =>
      assertActiveTenantMembership(context, { ...context, status: 'ACTIVE' }),
    ).not.toThrow();
  });

  it('denies disabled, mismatched, and missing membership context', () => {
    expect(() =>
      assertActiveTenantMembership(context, { ...context, status: 'SUSPENDED' }),
    ).toThrow('active membership');
    expect(() =>
      assertActiveTenantMembership(context, {
        ...context,
        tenantId: '44444444-4444-4444-8444-444444444444',
        status: 'ACTIVE',
      }),
    ).toThrow('active membership');
    expect(() =>
      assertActiveTenantMembership(
        { ...context, membershipId: '' },
        { ...context, status: 'ACTIVE' },
      ),
    ).toThrow('active membership');
  });
});
