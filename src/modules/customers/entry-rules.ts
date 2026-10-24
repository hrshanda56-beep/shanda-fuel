import { AppError } from '../../platform/errors';
import type { CustomerEntryDetailsInput } from './validation';

/**
 * Owner default for fuel taken on a credit account: the vehicle registration and the voucher
 * number must be written down, so the customer's bill can be checked against their paperwork.
 * The driver's name stays optional because drivers change often.
 */
export function assertCreditFuelDetails(details: CustomerEntryDetailsInput | undefined): void {
  const missing: string[] = [];
  if (!details?.vehicleRegistration) missing.push('vehicle registration');
  if (!details?.voucherNumber) missing.push('voucher number');
  if (missing.length > 0) {
    throw new AppError(
      'VALIDATION_FAILED',
      `Add the ${missing.join(' and ')} for fuel taken on credit.`,
    );
  }
}

/** A voucher is compared without case or stray spaces, so "v-12 " and "V-12" are the same. */
export function normaliseVoucher(voucher: string): string {
  return voucher.trim().replace(/\s+/g, ' ').toUpperCase();
}
