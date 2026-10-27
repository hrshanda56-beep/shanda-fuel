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
