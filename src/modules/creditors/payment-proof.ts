import { ExactDecimal } from '../../platform/domain/primitives';

/**
 * Proof of payment for supplier payments (TEI Oils brief S9, owner decision 11: "Optional in v1.
 * Payments over US$1,000 with no proof are flagged for review"). Proof never blocks a payment;
 * a payment at or above the threshold that has no proof file is only flagged.
 *
 * The threshold is a code constant, not a tenant setting: the repository has no per-tenant
 * settings table for creditors yet, and the owner's figure is USD 1000 ("1000 or more" per the
 * brief). To make it editable later, replace this constant with a settings read; every caller goes
 * through `paymentNeedsProofFlag`, so nothing else needs to change.
 */
export const SUPPLIER_PAYMENT_PROOF_THRESHOLD_USD = '1000';

/** True when the payment is large enough to need proof and has none. Exact decimal compare. */
export function paymentNeedsProofFlag(
  amount: string,
  proofCount: number,
  threshold: string = SUPPLIER_PAYMENT_PROOF_THRESHOLD_USD,
): boolean {
  if (proofCount > 0) return false;
  return new ExactDecimal(amount).value.gte(new ExactDecimal(threshold).value);
}
