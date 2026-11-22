import { describe, expect, it } from 'vitest';

import {
  clerkIdentifierForSignIn,
  clerkUsernameForEmailInvitee,
  clerkUsernameForStaffNumber,
} from './staff-username';

describe('clerkUsernameForEmailInvitee', () => {
  it('makes a hidden, Clerk-valid username with a letter and no staff-number shape', () => {
    const username = clerkUsernameForEmailInvitee();
    expect(username).toMatch(/^em_[0-9a-f]{24}$/);
    expect(username).not.toMatch(/^\d+$/);
  });

  it('is different every time', () => {
    const names = new Set(Array.from({ length: 50 }, () => clerkUsernameForEmailInvitee()));
    expect(names.size).toBe(50);
  });

  it('is never changed by the sign-in mapping', () => {
    const username = clerkUsernameForEmailInvitee();
    expect(clerkIdentifierForSignIn(username)).toBe(username);
  });
});

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
