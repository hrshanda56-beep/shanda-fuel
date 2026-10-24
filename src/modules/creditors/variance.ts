import Decimal from 'decimal.js';
import type { PurchasingPolicyValues, ToleranceAction } from './purchasing-policy';

/**
 * Pure variance and coverage evaluation (ADR-018 D2/D3). Every tolerance comes from the
 * tenant's purchasing policy; nothing is hard-coded. Everything is exact decimal.
 *
 * Tolerance rule, applied the same way to every check:
 * - the allowed difference is the GREATER of the litres/amount tolerance and the percent
 *   tolerance applied to the reference figure (a configured tolerance never makes a check
 *   stricter than the other one);
 * - a tolerance that is not configured is zero, so any difference is flagged;
 * - a difference exactly equal to the allowance is WITHIN tolerance (the boundary is
 *   inclusive); only a strictly larger difference is exceeded.
 */

export type CoverageState = 'UNBILLED' | 'PARTIALLY_BILLED' | 'BILLED' | 'OVER_BILLED';

export type NetBilled = Readonly<{
  /** Invoiced litres minus credited litres, never below zero. */
  netLitres: string;
  /** True when credit notes cover more litres than the invoices bill (clamped to zero, shown). */
  creditExceedsInvoiced: boolean;
  /** Litres of credit that could not be netted because they exceed what was invoiced. */
  unappliedCreditLitres: string;
}>;

/**
 * Posted credit notes reduce the billed quantity of a delivery (ADR-018, gap 3). The result
 * never goes below zero silently: an excess credit is reported, not hidden.
 */
export function netBilledLitres(invoicedLitres: string, creditedLitres: string): NetBilled {
  const net = new Decimal(invoicedLitres).sub(new Decimal(creditedLitres));
  return net.isNegative()
    ? {
        netLitres: '0.000',
        creditExceedsInvoiced: true,
        unappliedCreditLitres: net.abs().toFixed(3),
      }
    : { netLitres: net.toFixed(3), creditExceedsInvoiced: false, unappliedCreditLitres: '0.000' };
}

/** Net billed money, same rule as litres; null when either side's amount is unknown. */
export function netBilledAmount(
  invoicedAmount: string | null,
  creditedAmount: string | null,
): string | null {
  if (invoicedAmount === null) return null;
  const net = new Decimal(invoicedAmount).sub(new Decimal(creditedAmount ?? 0));
  return Decimal.max(net, new Decimal(0)).toFixed(4);
}

export function classifyCoverage(
  acceptedLitres: string,
  coveredLitres: string,
  hasActiveInvoice: boolean,
): CoverageState {
  if (!hasActiveInvoice) return 'UNBILLED';
  const accepted = new Decimal(acceptedLitres);
  const covered = new Decimal(coveredLitres);
  if (covered.lt(accepted)) return 'PARTIALLY_BILLED';
  if (covered.gt(accepted)) return 'OVER_BILLED';
  return 'BILLED';
}

export type Tolerance = Readonly<{
  /** Absolute tolerance in the unit of the check (litres or money); null = not configured. */
  absolute: string | null;
  /** Percent of the reference figure; null = not configured. */
  percent: string | null;
}>;

/** The allowance for a reference figure. Zero when nothing is configured. */
export function allowedDifference(reference: string, tolerance: Tolerance): Decimal {
  const absolute = tolerance.absolute === null ? new Decimal(0) : new Decimal(tolerance.absolute);
  const byPercent =
    tolerance.percent === null
      ? new Decimal(0)
      : new Decimal(reference).abs().mul(new Decimal(tolerance.percent)).div(100);
  return Decimal.max(absolute, byPercent);
}

export function isWithinTolerance(
  difference: string,
  reference: string,
  tolerance: Tolerance,
): boolean {
  return new Decimal(difference).abs().lte(allowedDifference(reference, tolerance));
}

export type VarianceCode =
  | 'OVER_RECEIPT'
  | 'SHORT_RECEIPT'
  | 'QUANTITY_OVER_BILLED'
  | 'QUANTITY_UNDER_BILLED'
  | 'PRICE_ABOVE_RECEIPT_COST'
  | 'PRICE_BELOW_RECEIPT_COST'
  | 'PRICE_ABOVE_PO_PRICE'
  | 'PRICE_BELOW_PO_PRICE'
  | 'AMOUNT_ABOVE_EXPECTED'
  | 'AMOUNT_BELOW_EXPECTED';

const INVOICE_SIDE_CODES: readonly VarianceCode[] = [
  'QUANTITY_OVER_BILLED',
  'PRICE_ABOVE_RECEIPT_COST',
  'PRICE_ABOVE_PO_PRICE',
  'AMOUNT_ABOVE_EXPECTED',
];

/** Which figure the invoice unit price was compared against. */
export type PriceBasis = 'PURCHASE_ORDER' | 'RECEIPT_COST';

export type VarianceFinding = Readonly<{
  code: VarianceCode;
  /** EXCEPTION counts against the tolerance policy; INFO is shown but never blocks. */
  severity: 'EXCEPTION' | 'INFO';
  message: string;
  difference: string;
  allowed: string;
}>;

export type VarianceInput = Readonly<{
  noteQuantityLitres: string;
  acceptedQuantityLitres: string;
  /** Litres the posted invoices claim for this delivery; null when the invoice gave none. */
  invoicedQuantityLitres: string | null;
  /** Net unit price on the invoice (before VAT); null when no priced line is linked. */
  invoicedUnitPrice: string | null;
  /** Net amount the invoice charges for this delivery; null when unknown. */
  invoicedNetAmount: string | null;
  /** Recorded landed (receipt) unit cost; null when none has been recorded. */
  referenceUnitCost: string | null;
  /**
   * Agreed unit price of the purchase-order line this delivery is linked to (ACTIVE link);
   * null when the delivery is unlinked or the line has no agreed price. When present it is
   * the price basis; otherwise the check falls back to the receipt cost.
   */
  purchaseOrderUnitPrice?: string | null;
  purchaseOrderNumber?: string | null;
  deliveryLabel?: string;
  policy: Pick<
    PurchasingPolicyValues,
    | 'quantityToleranceLitres'
    | 'quantityTolerancePercent'
    | 'priceTolerancePercent'
    | 'amountTolerance'
    | 'overReceiptToleranceLitres'
    | 'overReceiptTolerancePercent'
    | 'toleranceAction'
  >;
}>;

export type VarianceResult = Readonly<{
  findings: readonly VarianceFinding[];
  /** True when at least one EXCEPTION finding exceeded its allowance. */
  exceeded: boolean;
  /** True when an invoice-side finding (over-billing, price, amount) exceeded: gates posting. */
  invoiceExceeded: boolean;
  action: ToleranceAction;
  /** What the invoice price was compared with; null when the price check did not run. */
  priceBasis: PriceBasis | null;
  /** The over-receipt exception, when the received litres exceed the note beyond tolerance. */
  overReceipt: OverReceiptAssessment | null;
  /** Checks that could not run, with the reason ("unpriced" is never treated as zero). */
  skipped: readonly string[];
}>;

const fmt = (value: Decimal, places: number) => value.toFixed(places);

export type OverReceiptAssessment = Readonly<{
  flagged: boolean;
  excessLitres: string;
  allowedLitres: string;
  /** The tenant's tolerance action. Over-receipt never blocks; REQUIRE_APPROVAL asks for review. */
  action: ToleranceAction;
  reviewRequired: boolean;
}>;

/**
 * Over-receipt: more litres accepted than the delivery note claims, beyond the policy's
 * over-receipt tolerance. Informational and never blocking (the fuel is already in the tank).
 */
export function assessOverReceipt(input: {
  noteQuantityLitres: string;
  acceptedQuantityLitres: string;
  policy: Pick<
    PurchasingPolicyValues,
    'overReceiptToleranceLitres' | 'overReceiptTolerancePercent' | 'toleranceAction'
  >;
}): OverReceiptAssessment {
  const note = new Decimal(input.noteQuantityLitres);
  const excess = new Decimal(input.acceptedQuantityLitres).sub(note);
  const allowed = allowedDifference(note.toFixed(), {
    absolute: input.policy.overReceiptToleranceLitres,
    percent: input.policy.overReceiptTolerancePercent,
  });
  const flagged = excess.isPositive() && excess.gt(allowed);
  return {
    flagged,
    excessLitres: Decimal.max(excess, new Decimal(0)).toFixed(3),
    allowedLitres: allowed.toFixed(3),
    action: input.policy.toleranceAction,
    reviewRequired: flagged && input.policy.toleranceAction === 'REQUIRE_APPROVAL',
  };
}

export function evaluateDeliveryVariance(input: VarianceInput): VarianceResult {
  const findings: VarianceFinding[] = [];
  const skipped: string[] = [];
  const label = input.deliveryLabel ? `Delivery ${input.deliveryLabel}` : 'This delivery';
  const note = new Decimal(input.noteQuantityLitres);
  const accepted = new Decimal(input.acceptedQuantityLitres);
  const policy = input.policy;
  const overReceipt = assessOverReceipt({
    noteQuantityLitres: input.noteQuantityLitres,
    acceptedQuantityLitres: input.acceptedQuantityLitres,
    policy,
  });

  // Delivery note vs accepted (physical) quantity.
  const receiptDifference = accepted.sub(note);
  if (!receiptDifference.isZero()) {
    if (receiptDifference.isPositive()) {
      const tolerance: Tolerance = {
        absolute: policy.overReceiptToleranceLitres,
        percent: policy.overReceiptTolerancePercent,
      };
      const allowed = allowedDifference(note.toFixed(), tolerance);
      if (receiptDifference.gt(allowed)) {
        findings.push({
          code: 'OVER_RECEIPT',
          severity: 'EXCEPTION',
          message: `${label}: ${fmt(accepted, 3)} litres were received but the delivery note says ${fmt(note, 3)} (${fmt(receiptDifference, 3)} more than the note; allowed ${fmt(allowed, 3)}). The fuel is already in the tank, so this is flagged for review, not blocked.`,
          difference: fmt(receiptDifference, 3),
          allowed: fmt(allowed, 3),
        });
      }
    } else {
      const shortage = receiptDifference.abs();
      const allowed = allowedDifference(note.toFixed(), {
        absolute: policy.quantityToleranceLitres,
        percent: policy.quantityTolerancePercent,
      });
      if (shortage.gt(allowed)) {
        findings.push({
          code: 'SHORT_RECEIPT',
          severity: 'EXCEPTION',
          message: `${label}: only ${fmt(accepted, 3)} litres were received but the delivery note says ${fmt(note, 3)} (${fmt(shortage, 3)} short; allowed ${fmt(allowed, 3)}).`,
          difference: fmt(shortage, 3),
          allowed: fmt(allowed, 3),
        });
      }
    }
  }

  // Invoiced vs accepted quantity.
  if (input.invoicedQuantityLitres === null) {
    skipped.push('Quantity check skipped: the invoice does not state litres for this delivery.');
  } else {
    const invoiced = new Decimal(input.invoicedQuantityLitres);
    const difference = invoiced.sub(accepted);
    const allowed = allowedDifference(accepted.toFixed(), {
      absolute: policy.quantityToleranceLitres,
      percent: policy.quantityTolerancePercent,
    });
    if (difference.abs().gt(allowed)) {
      if (difference.isPositive()) {
        findings.push({
          code: 'QUANTITY_OVER_BILLED',
          severity: 'EXCEPTION',
          message: `${label}: the invoice bills ${fmt(invoiced, 3)} litres but only ${fmt(accepted, 3)} litres were received (${fmt(difference, 3)} more; allowed ${fmt(allowed, 3)}). Do not pay for fuel that was not received.`,
          difference: fmt(difference, 3),
          allowed: fmt(allowed, 3),
        });
      } else {
        findings.push({
          code: 'QUANTITY_UNDER_BILLED',
          severity: 'INFO',
          message: `${label}: the invoice bills ${fmt(invoiced, 3)} litres but ${fmt(accepted, 3)} litres were received (${fmt(difference.abs(), 3)} not yet billed). The rest may arrive on another invoice.`,
          difference: fmt(difference.abs(), 3),
          allowed: fmt(allowed, 3),
        });
      }
    }
  }

  // Invoiced unit price vs the agreed purchase-order price when the delivery is linked to a
  // priced PO line, otherwise vs the recorded receipt cost.
  let priceBasis: PriceBasis | null = null;
  const poPrice = input.purchaseOrderUnitPrice ?? null;
  if (input.invoicedUnitPrice === null) {
    skipped.push('Price check skipped: no priced invoice line is linked to this delivery.');
  } else if (poPrice === null && input.referenceUnitCost === null) {
    skipped.push(
      'Price check skipped: the delivery has no priced purchase-order line and no receipt cost has been recorded (unpriced, not zero).',
    );
  } else {
    const usePo = poPrice !== null;
    priceBasis = usePo ? 'PURCHASE_ORDER' : 'RECEIPT_COST';
    const price = new Decimal(input.invoicedUnitPrice);
    const reference = new Decimal(usePo ? poPrice : input.referenceUnitCost!);
    const difference = price.sub(reference);
    const allowed = allowedDifference(reference.toFixed(), {
      absolute: null,
      percent: policy.priceTolerancePercent,
    });
    if (difference.abs().gt(allowed)) {
      const above = difference.isPositive();
      const basisText = usePo
        ? `the agreed price on purchase order ${input.purchaseOrderNumber ?? 'line'}`
        : 'the recorded receipt cost';
      findings.push({
        code: usePo
          ? above
            ? 'PRICE_ABOVE_PO_PRICE'
            : 'PRICE_BELOW_PO_PRICE'
          : above
            ? 'PRICE_ABOVE_RECEIPT_COST'
            : 'PRICE_BELOW_RECEIPT_COST',
        severity: above ? 'EXCEPTION' : 'INFO',
        message: `${label}: the invoice price is ${fmt(price, 8)} per litre but ${basisText} is ${fmt(reference, 8)} (${fmt(difference.abs(), 8)} ${above ? 'higher' : 'lower'}; allowed ${fmt(allowed, 8)}).`,
        difference: fmt(difference.abs(), 8),
        allowed: fmt(allowed, 8),
      });
    }
  }

  // Invoiced net amount vs what the received litres cost at the invoiced price.
  if (input.invoicedNetAmount === null || input.invoicedUnitPrice === null) {
    skipped.push('Amount check skipped: the invoice does not state an amount and price for it.');
  } else {
    const expected = accepted
      .mul(new Decimal(input.invoicedUnitPrice))
      .toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
    const billed = new Decimal(input.invoicedNetAmount);
    const difference = billed.sub(expected);
    const allowed = allowedDifference(expected.toFixed(), {
      absolute: policy.amountTolerance,
      percent: null,
    });
    if (difference.abs().gt(allowed)) {
      const above = difference.isPositive();
      findings.push({
        code: above ? 'AMOUNT_ABOVE_EXPECTED' : 'AMOUNT_BELOW_EXPECTED',
        severity: above ? 'EXCEPTION' : 'INFO',
        message: `${label}: the invoice charges ${fmt(billed, 4)} but ${fmt(accepted, 3)} litres at the invoiced price come to ${fmt(expected, 4)} (${fmt(difference.abs(), 4)} ${above ? 'more' : 'less'}; allowed ${fmt(allowed, 4)}).`,
        difference: fmt(difference.abs(), 4),
        allowed: fmt(allowed, 4),
      });
    }
  }

  return {
    findings,
    exceeded: findings.some((finding) => finding.severity === 'EXCEPTION'),
    invoiceExceeded: findings.some(
      (finding) => finding.severity === 'EXCEPTION' && INVOICE_SIDE_CODES.includes(finding.code),
    ),
    action: policy.toleranceAction,
    priceBasis,
    overReceipt: overReceipt.flagged ? overReceipt : null,
    skipped,
  };
}
