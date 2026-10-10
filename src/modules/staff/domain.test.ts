import { describe, expect, it } from 'vitest';

import {
  createInvitationToken,
  hashInvitationToken,
  invitationExpiry,
  normalizeEmail,
  validateInvitationScope,
} from './domain';

describe('staff invitation domain', () => {
  it('normalizes email and hashes only the token lookup value', () => {
    const token = createInvitationToken();
    expect(normalizeEmail('  Person@Example.com ')).toBe('person@example.com');
    expect(token.token).not.toBe(token.tokenHash);
    expect(token.tokenHash).toBe(hashInvitationToken(token.token));
    expect(token.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('uses the approved 72-hour lifetime', () => {
    const now = new Date('2026-10-09T00:00:00.000Z');
    expect(invitationExpiry(now).toISOString()).toBe('2026-10-12T00:00:00.000Z');
  });

  it('requires explicit tenant and station scope by role', () => {
    expect(validateInvitationScope('OWNER', { scopeType: 'TENANT', stationIds: [] })).toEqual({
      scopeType: 'TENANT',
      stationIds: [],
    });
    expect(() =>
      validateInvitationScope('SUPERVISOR', { scopeType: 'TENANT', stationIds: [] }),
    ).toThrow('requires one or more stations');
    expect(
      validateInvitationScope('ATTENDANT', {
        scopeType: 'STATION',
        legalEntityId: '11111111-1111-4111-8111-111111111111',
        stationIds: [
          '22222222-2222-4222-8222-222222222222',
          '22222222-2222-4222-8222-222222222222',
        ],
      }),
    ).toEqual({
      scopeType: 'STATION',
      legalEntityId: '11111111-1111-4111-8111-111111111111',
      stationIds: ['22222222-2222-4222-8222-222222222222'],
    });
  });
});
