import { describe, expect, it } from 'vitest';

import {
  createInvitationToken,
  createActivationCode,
  createStaffNumber,
  hashInvitationToken,
  invitationExpiry,
  normalizeEmail,
  normalizeStaffNumber,
  normalizeActivationCode,
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

  it('generates permanent non-secret Staff Numbers and one-time activation hashes', () => {
    const staffNumber = createStaffNumber();
    expect(staffNumber).toMatch(/^SF-[0-9]{8}$/);
    expect(normalizeStaffNumber(staffNumber.toLowerCase())).toBe(staffNumber);

    const activation = createActivationCode();
    expect(activation.code).toMatch(
      /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/,
    );
    expect(activation.codeHash).not.toBe(activation.code);
    expect(activation.codeHash).toBe(hashInvitationToken(activation.code.toLowerCase()));
    expect(normalizeStaffNumber(' e12345 ')).toBe('E12345');
    expect(() => normalizeStaffNumber('a b')).toThrow();
  });

  it('normalizes friendly codes and preserves legacy codes without accepting ambiguous symbols', () => {
    expect(normalizeActivationCode(' 7k3m 9r2x ')).toBe('7k3m-9r2x');
    expect(normalizeActivationCode('7K3M-9R2X')).toBe('7k3m-9r2x');
    expect(normalizeActivationCode('A'.repeat(40))).toBe('a'.repeat(40));
    expect(() => normalizeActivationCode('OOOO-1111')).toThrow();
    expect(() => normalizeActivationCode('7K3M')).toThrow();
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
