import { ExactDecimal } from '../../platform/domain/primitives';

/**
 * The plain-language names for where cash is and how far it has got towards the bank. One place
 * decides them, so the cash page, the reports and any export say the same thing.
 *
 * Nothing here is stored. The names are worked out from the amounts and states already recorded.
 * Cash is only Fully banked once the bank has confirmed it, and a deposit cannot be confirmed
 * without its deposit slip. Collected is never banked: it is cash taken from the till and not yet in
 * a confirmed deposit. A missing bank reference is a visible warning only.
 */

/** The stored/derived custody states the cash workspace already uses. */
export const CUSTODY_STATES = [
  'AT_STATION',
  'RECEIVED',
  'IN_TRANSIT',
  'PARTIALLY_DEPOSITED',
  'BANKED',
] as const;
export type CustodyState = (typeof CUSTODY_STATES)[number];

export const CASH_STATUS_LABELS = {
  /** Counted cash nobody has collected yet. */
  AT_STATION: 'Still at the station',
  /** Collected from the till, not in a bank deposit yet. It is not banked. */
  COLLECTED: 'Collected, not banked yet',
  IN_TRANSIT: 'On its way to the bank',
  HELD_BY_MANAGEMENT: 'Held by management',
  PARTLY_BANKED: 'Partly banked',
  FULLY_BANKED: 'Fully banked',
  /** The bank confirmed a different amount from the one deposited. */
  BANKED_WITH_DIFFERENCE: 'Banked with difference',
} as const;
export type CashStatus = keyof typeof CASH_STATUS_LABELS;

const CUSTODY_TO_STATUS: Record<CustodyState, CashStatus> = {
  // A collection exists, so the cash has been collected; it is not banked.
  AT_STATION: 'COLLECTED',
  // A collection that management has received and not yet put into a deposit.
  RECEIVED: 'HELD_BY_MANAGEMENT',
  IN_TRANSIT: 'IN_TRANSIT',
  PARTIALLY_DEPOSITED: 'PARTLY_BANKED',
  BANKED: 'FULLY_BANKED',
};

export function isCustodyState(value: string): value is CustodyState {
  return (CUSTODY_STATES as readonly string[]).includes(value);
}

/** The status for a stored custody state; an unknown value is returned as it is, never hidden. */
export function cashStatusForCustody(custodyState: string): CashStatus | null {
  return isCustodyState(custodyState) ? CUSTODY_TO_STATUS[custodyState] : null;
}

export function cashStatusLabel(status: CashStatus): string {
  return CASH_STATUS_LABELS[status];
}

export function cashStatusLabelForCustody(custodyState: string): string {
  const status = cashStatusForCustody(custodyState);
  return status ? CASH_STATUS_LABELS[status] : custodyState;
}

/**
 * The status of one collection from its amounts. Exact decimals throughout.
 * Nothing banked yet and nothing in a deposit: collected, or held by management once
 * management has received it. Partly banked means some of it, but not all, has gone to the bank.
 */
export function deriveCashStatus(input: {
  amount: string;
  allocatedAmount: string;
  confirmedAmount: string;
  received: boolean;
}): CashStatus {
  const amount = new ExactDecimal(input.amount);
  const allocated = new ExactDecimal(input.allocatedAmount);
  const confirmed = new ExactDecimal(input.confirmedAmount);
  if (amount.value.gt(0) && confirmed.value.gte(amount.value)) return 'FULLY_BANKED';
  if (confirmed.value.gt(0)) return 'PARTLY_BANKED';
  if (allocated.value.gt(0)) {
    return allocated.value.gte(amount.value) ? 'IN_TRANSIT' : 'PARTLY_BANKED';
  }
  return input.received ? 'HELD_BY_MANAGEMENT' : 'COLLECTED';
}

/** Where a handover leaves the cash, from the type of the location that receives it. */
export function cashStatusForLocationType(locationType: string): CashStatus | null {
  switch (locationType) {
    case 'STATION_TILL':
    case 'STATION_SAFE':
      return 'AT_STATION';
    case 'TRANSIT':
      return 'IN_TRANSIT';
    case 'COLLECTOR':
      return 'HELD_BY_MANAGEMENT';
    default:
      return null;
  }
}

export type DepositProofFlags = Readonly<{
  /** No deposit slip document is attached to the deposit. */
  missingProof: boolean;
  /** No bank reference has been entered. */
  missingBankReference: boolean;
}>;

export const MISSING_PROOF_LABEL = 'No deposit slip attached';
export const MISSING_REFERENCE_LABEL = 'No bank reference yet';

/** The slip is required to confirm a deposit; this only reports what is missing before that. */
export function depositProofFlags(input: {
  slipCount: number;
  bankReference: string | null | undefined;
}): DepositProofFlags {
  return {
    missingProof: input.slipCount <= 0,
    missingBankReference: !input.bankReference || input.bankReference.trim() === '',
  };
}

/** One short line for a report cell: what is missing, or empty when nothing is. */
export function depositProofSummary(flags: DepositProofFlags): string {
  const parts: string[] = [];
  if (flags.missingProof) parts.push(MISSING_PROOF_LABEL);
  if (flags.missingBankReference) parts.push(MISSING_REFERENCE_LABEL);
  return parts.join('; ');
}

/**
 * How far one bank deposit has got, in the same words as collections. A deposit the bank has not
 * confirmed is on its way; confirmed for less than was deposited is partly banked.
 */
export function bankingStatusForDeposit(input: {
  state: string;
  amount: string;
  confirmedAmount: string | null;
}): string | null {
  switch (input.state) {
    case 'RECORDED':
    case 'SUBMITTED':
      return CASH_STATUS_LABELS.IN_TRANSIT;
    case 'CONFIRMED': {
      if (input.confirmedAmount === null) return CASH_STATUS_LABELS.IN_TRANSIT;
      const confirmed = new ExactDecimal(input.confirmedAmount);
      return confirmed.value.eq(new ExactDecimal(input.amount).value)
        ? CASH_STATUS_LABELS.FULLY_BANKED
        : CASH_STATUS_LABELS.BANKED_WITH_DIFFERENCE;
    }
    case 'REJECTED':
      return 'Rejected by the bank';
    case 'REVERSED':
      return 'Reversed';
    default:
      return null;
  }
}

/** A shortage with no reason written down. New shortages cannot be submitted without one. */
export function shortageReasonMissing(input: {
  variance: string | null;
  reason: string | null | undefined;
}): boolean {
  if (input.variance === null) return false;
  const variance = new ExactDecimal(input.variance);
  if (!variance.value.lt(0)) return false;
  return !input.reason || input.reason.trim() === '';
}
