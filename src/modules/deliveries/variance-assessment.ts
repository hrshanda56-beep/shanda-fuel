import Decimal from 'decimal.js';
import { allowedDifference, type Tolerance } from '../creditors/variance';

/**
 * The delivery loss rule. Pure and exact: nothing here touches the database.
 *
 * Fuel is credited to the tank at the litres actually received, never the litres on the note.
 * The gap between what the note says and what arrived is worked out here, never typed. When the
 * gap is bigger than the owner's allowance the person receiving must say why. Fuel grows and
 * shrinks with the weather, so the load temperature is kept as evidence only: it never changes
 * the litres, and the system never decides who pays.
 */

export const VARIANCE_CAUSES = [
  'THEFT_SUSPECTED',
  'TEMPERATURE',
  'MEASURING_ERROR',
  'SPILL_OR_LEAK',
  'LOADING_SHORT',
  'OTHER',
] as const;
export type VarianceCause = (typeof VARIANCE_CAUSES)[number];

export const VARIANCE_CAUSE_LABELS: Readonly<Record<VarianceCause, string>> = {
  THEFT_SUSPECTED: 'Fuel may have been taken',
  TEMPERATURE: 'Weather or temperature',
  MEASURING_ERROR: 'Measuring or dip error',
  SPILL_OR_LEAK: 'Spill or leak',
  LOADING_SHORT: 'The depot loaded less than the note says',
  OTHER: 'Something else',
};

export const LOSS_LIABLE_PARTIES = ['NONE', 'DRIVER', 'TRANSPORTER', 'SUPPLIER', 'OTHER'] as const;
export type LossLiableParty = (typeof LOSS_LIABLE_PARTIES)[number];

export const LOSS_RECOVERY_STATUSES = ['NONE', 'RAISED', 'SETTLED', 'WRITTEN_OFF'] as const;
export type LossRecoveryStatus = (typeof LOSS_RECOVERY_STATUSES)[number];

/** How a settled claim was paid. The two account methods post a credit on the supplier account (DEC-055). */
export const LOSS_SETTLEMENT_METHODS = ['CASH', 'TRANSPORT_BILL', 'SUPPLIER_BALANCE'] as const;
export type LossSettlementMethod = (typeof LOSS_SETTLEMENT_METHODS)[number];

export const LOSS_APPROVAL_STATUSES = ['NOT_NEEDED', 'PENDING', 'APPROVED', 'REJECTED'] as const;
export type LossApprovalStatus = (typeof LOSS_APPROVAL_STATUSES)[number];

export type VarianceAssessmentInput = Readonly<{
  /** Litres the supplier's delivery note says. */
  noteLitres: string;
  /** Litres that really arrived. This is what the tank is credited with. */
  receivedLitres: string;
  /** Litres ordered on the purchase order, when there is one. */
  orderedLitres?: string | null;
  /** Physical litres in the tank before and after, when both dips were taken. */
  dipBeforeLitres?: string | null;
  dipAfterLitres?: string | null;
  /** Allowance for a shortage, and for an excess. From the purchasing policy. */
  shortageTolerance: Tolerance;
  excessTolerance: Tolerance;
  /** Allowance for the dip reading against the litres received. */
  dipTolerance: Tolerance;
}>;

export type VarianceAssessment = Readonly<{
  /** received minus note: negative is a shortage, positive an excess. */
  noteVarianceLitres: string;
  noteVariance: 'OK' | 'SHORT' | 'OVER';
  /** True when the difference is bigger than the allowance. */
  noteOutOfTolerance: boolean;
  allowedNoteLitres: string;
  /** received minus ordered; null without an order. Shown, never blocks. */
  orderVarianceLitres: string | null;
  /** Litres the dips say went into the tank; null unless both dips are given. */
  dipMeasuredLitres: string | null;
  /** dip-measured minus received; null unless both dips are given. */
  dipVarianceLitres: string | null;
  dipOutOfTolerance: boolean;
  /** True when the person receiving must explain the difference. */
  causeRequired: boolean;
}>;

function decimal(value: string): Decimal {
  return new Decimal(value);
}

export function assessDeliveryVariance(input: VarianceAssessmentInput): VarianceAssessment {
  const note = decimal(input.noteLitres);
  const received = decimal(input.receivedLitres);
  const difference = received.sub(note);
  const noteVariance = difference.isZero() ? 'OK' : difference.isNegative() ? 'SHORT' : 'OVER';
  const allowedNote = allowedDifference(
    note.toFixed(),
    difference.isNegative() ? input.shortageTolerance : input.excessTolerance,
  );
  const noteOutOfTolerance = difference.abs().gt(allowedNote);

  const orderVarianceLitres = input.orderedLitres
    ? received.sub(decimal(input.orderedLitres)).toFixed()
    : null;

  let dipMeasured: Decimal | null = null;
  let dipVariance: Decimal | null = null;
  let dipOutOfTolerance = false;
  if (input.dipBeforeLitres && input.dipAfterLitres) {
    dipMeasured = decimal(input.dipAfterLitres).sub(decimal(input.dipBeforeLitres));
    dipVariance = dipMeasured.sub(received);
    dipOutOfTolerance = dipVariance
      .abs()
      .gt(allowedDifference(received.toFixed(), input.dipTolerance));
  }

  return {
    noteVarianceLitres: difference.toFixed(),
    noteVariance,
    noteOutOfTolerance,
    allowedNoteLitres: allowedNote.toFixed(),
    orderVarianceLitres,
    dipMeasuredLitres: dipMeasured ? dipMeasured.toFixed() : null,
    dipVarianceLitres: dipVariance ? dipVariance.toFixed() : null,
    dipOutOfTolerance,
    causeRequired: noteOutOfTolerance || dipOutOfTolerance,
  };
}

export type VarianceExplanation = Readonly<{
  cause?: VarianceCause | null;
  note?: string | null;
}>;

/** The message shown when a cause is needed and missing, or null when the answer is complete. */
export function missingExplanation(
  assessment: Pick<VarianceAssessment, 'causeRequired'>,
  explanation: VarianceExplanation,
): string | null {
  if (!assessment.causeRequired) return null;
  if (!explanation.cause) {
    return 'The litres received are different from the delivery note. Say why before you save.';
  }
  if (explanation.cause === 'OTHER' && !explanation.note?.trim()) {
    return 'Say in a few words what happened.';
  }
  return null;
}

const AMOUNT = /^\d+(?:\.\d{1,4})?$/;

function isPositiveAmount(value: string | null | undefined): value is string {
  return !!value && AMOUNT.test(value) && !decimal(value).isZero();
}

/**
 * A loss can be charged back, but the owner decides case by case. The record only keeps who
 * was held responsible, the amount expected back, and what happened. A raised claim needs the
 * amount expected back; a settled one needs the amount paid and how it was paid; each amount
 * needs a currency. A claim with no responsible party is meaningless.
 */
export function checkLossRecovery(input: {
  liableParty: LossLiableParty;
  status: LossRecoveryStatus;
  /** The amount expected back, kept from the moment the claim is raised. */
  expectedAmount: string | null;
  /** The amount actually paid back, only for a settled claim. */
  recoveredAmount: string | null;
  settlementMethod: LossSettlementMethod | null;
  currency: string | null;
}): string | null {
  const { liableParty, status, expectedAmount, recoveredAmount, settlementMethod, currency } =
    input;
  if (liableParty === 'NONE' && status !== 'NONE') {
    return 'Choose who is responsible before you record a claim.';
  }
  if (liableParty !== 'NONE' && status === 'NONE') {
    return 'Say what happened with the claim: raised, settled or written off.';
  }
  if (status === 'NONE') return null;
  if (expectedAmount && !AMOUNT.test(expectedAmount)) {
    return 'Enter the amount expected back as a number, for example 150.00.';
  }
  if (status === 'RAISED' && !isPositiveAmount(expectedAmount)) {
    return 'Enter the amount you expect to get back.';
  }
  if (status === 'SETTLED') {
    if (!isPositiveAmount(recoveredAmount)) return 'Enter the amount that was paid back.';
    if (!settlementMethod) return 'Say how it was paid back.';
  } else {
    if (recoveredAmount) return 'An amount paid back is only kept for a settled claim.';
    if (settlementMethod) return 'How it was paid back is only kept for a settled claim.';
  }
  if ((expectedAmount || recoveredAmount) && !currency) {
    return 'Choose the currency of the amount.';
  }
  return null;
}
