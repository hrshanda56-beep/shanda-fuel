import { describe, expect, it } from 'vitest';

import { clerkIdentifierForSignIn, clerkUsernameForStaffNumber } from './staff-username';

describe('clerkUsernameForStaffNumber', () => {
  it('prefixes an all-digit staff number so Clerk accepts it', () => {
    expect(clerkUsernameForStaffNumber('20090')).toBe('s20090');
    expect(clerkUsernameForStaffNumber(' 20090 ')).toBe('s20090');
  });

  it('leaves staff numbers that already contain a letter alone', () => {
    expect(clerkUsernameForStaffNumber('FU-0042')).toBe('FU-0042');
    expect(clerkUsernameForStaffNumber('A20090')).toBe('A20090');
  });
});

describe('clerkIdentifierForSignIn', () => {
  it('maps a digit-only staff number and keeps an email as typed', () => {
    expect(clerkIdentifierForSignIn('20090')).toBe('s20090');
    expect(clerkIdentifierForSignIn('name@example.com')).toBe('name@example.com');
  });
});
