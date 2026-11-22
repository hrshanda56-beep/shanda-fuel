/**
 * The checks behind the credit-limit and transaction-details guides. Pure, so they are tested
 * alone. Keys are element ids. No floating-point maths is done on an amount.
 */

export type Errors = Record<string, string>;

/** An exact positive amount as typed (commas allowed, up to four decimals), or null. */
export function parseLimit(value: string): string | null {
  const text = value.trim().replace(/,/g, '');
  if (!/^\d+(\.\d{1,4})?$/.test(text) || !/[1-9]/.test(text)) return null;
  return text;
}

export function checkNewLimit(value: string): Errors {
  return parseLimit(value) ? {} : { 'limit-new': 'Enter the new limit, for example 2500.00.' };
}

export function checkLimitApprover(approverId: string): Errors {
  return approverId ? {} : { 'limit-approver': 'Choose who approved this change.' };
}

export function checkLimitReason(reason: string): Errors {
  return reason.trim() ? {} : { 'limit-reason': 'Say why the limit is being changed.' };
}

export function checkDetailsStation(stationId: string): Errors {
  return stationId ? {} : { 'details-station': 'Choose the station where this happened.' };
}

export type EntryDetails = {
  vehicle: string;
  driver: string;
  voucher: string;
  approverId: string;
};

/** Details cannot be changed once saved, so saving nothing is refused rather than saved empty. */
export function hasAnyDetail(details: EntryDetails): boolean {
  return Boolean(
    details.vehicle.trim() || details.driver.trim() || details.voucher.trim() || details.approverId,
  );
}

/** Only the details that were given, trimmed, in the shape the server expects. */
export function entryDetailsPayload(details: EntryDetails): Record<string, string> {
  return {
    ...(details.vehicle.trim() ? { vehicleRegistration: details.vehicle.trim() } : {}),
    ...(details.driver.trim() ? { driverName: details.driver.trim() } : {}),
    ...(details.voucher.trim() ? { voucherNumber: details.voucher.trim() } : {}),
    ...(details.approverId ? { approvedByMembershipId: details.approverId } : {}),
  };
}
