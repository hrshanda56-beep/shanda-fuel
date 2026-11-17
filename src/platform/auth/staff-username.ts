import { randomBytes } from 'node:crypto';

/**
 * Clerk refuses usernames made only of digits (form_username_needs_non_number_char),
 * but staff numbers such as 20090 are all digits. The provider username gets an
 * "s" prefix in that case; people still type and see the plain staff number.
 */
export function clerkUsernameForStaffNumber(staffNumber: string): string {
  const value = staffNumber.trim();
  return /^\d+$/.test(value) ? `s${value}` : value;
}

/** Sign-in field: an email stays as typed, an all-digit staff number is mapped. */
export function clerkIdentifierForSignIn(identifier: string): string {
  return clerkUsernameForStaffNumber(identifier);
}

/**
 * The Clerk instance requires every account to have a username. Staff-number
 * accounts use the staff number; people invited by email have none, so they get
 * a hidden generated one. It is never shown and never typed: they sign in with
 * their email. The "em_" prefix keeps it a letter-led, non-numeric Clerk username.
 */
export function clerkUsernameForEmailInvitee(): string {
  return `em_${randomBytes(12).toString('hex')}`;
}
