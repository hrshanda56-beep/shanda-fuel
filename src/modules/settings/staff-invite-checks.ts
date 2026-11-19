/** The checks behind the "Invite staff" guide. Pure, so they are tested alone. Keys are element ids. */

export type Errors = Record<string, string>;

export function checkInviteName(name: string): Errors {
  return name.trim() ? {} : { 'inv-name': "Enter the person's name." };
}

export function checkInviteEmail(email: string): Errors {
  const trimmed = email.trim();
  if (!trimmed) return { 'inv-email': 'Enter their email address.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return {
      'inv-email': 'That does not look like an email address, for example name@company.com.',
    };
  }
  return {};
}

/** The staff number is optional; when given it is their login name. */
export function checkInviteStaffNumber(staffNumber: string): Errors {
  const trimmed = staffNumber.trim();
  if (!trimmed) return {};
  if (!/^[A-Za-z0-9_-]{4,32}$/.test(trimmed)) {
    return {
      'inv-number': 'Use 4 to 32 letters, numbers, hyphens or underscores, with no spaces.',
    };
  }
  return {};
}

export function checkInviteScope(
  scopeType: 'TENANT' | 'LEGAL_ENTITY' | 'STATION',
  legalEntityId: string,
  stationIds: readonly string[],
): Errors {
  if (scopeType === 'TENANT') return {};
  if (!legalEntityId) return { 'inv-company': 'Choose the company they will work for.' };
  if (scopeType === 'STATION' && stationIds.length === 0) {
    return { 'inv-stations': 'Tick at least one station they will work at.' };
  }
  return {};
}
