import Decimal from 'decimal.js';
import { AppError } from '../../platform/errors';

/**
 * Purchase order domain rules (ADR-018 D4). Pure and side-effect free.
 *
 * A purchase order is commercial intent only. It never writes inventory, cash, bank, or
 * supplier-ledger rows. PARTIALLY_RECEIVED and RECEIVED are derived from confirmed linked
 * deliveries on the read side; they are never stored and never set by hand.
 */

export const PURCHASE_ORDER_STATES = [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'CANCELLED',
  'CLOSED',
] as const;
export type PurchaseOrderState = (typeof PURCHASE_ORDER_STATES)[number];

export const PURCHASE_ORDER_RECEIPT_STATUSES = [
  'NOT_RECEIVED',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
] as const;
export type PurchaseOrderReceiptStatus = (typeof PURCHASE_ORDER_RECEIPT_STATUSES)[number];

/** Amending an approved order sends it back to SUBMITTED so the new terms are approved again. */
const transitions: Readonly<Record<PurchaseOrderState, readonly PurchaseOrderState[]>> = {
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['APPROVED', 'CANCELLED'],
  APPROVED: ['SUBMITTED', 'CLOSED', 'CANCELLED'],
  CANCELLED: [],
  CLOSED: [],
};

export function assertPurchaseOrderTransition(
  from: PurchaseOrderState,
  to: PurchaseOrderState,
): void {
  if (!transitions[from]?.includes(to)) {
    throw new AppError('CONFLICT', `A purchase order in state ${from} cannot move to ${to}`, {
      from,
      to,
    });
  }
}

export function isAmendableState(state: PurchaseOrderState): boolean {
  return state === 'DRAFT' || state === 'SUBMITTED' || state === 'APPROVED';
}

export function isValidBusinessDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function assertOrderDates(orderDate: string, expectedDeliveryDate: string | null): void {
  if (!isValidBusinessDate(orderDate)) {
    throw new AppError('VALIDATION_FAILED', 'orderDate must be a valid YYYY-MM-DD date');
  }
  if (expectedDeliveryDate !== null) {
    if (!isValidBusinessDate(expectedDeliveryDate)) {
      throw new AppError(
        'VALIDATION_FAILED',
        'expectedDeliveryDate must be a valid YYYY-MM-DD date',
      );
    }
    if (expectedDeliveryDate < orderDate) {
      throw new AppError('VALIDATION_FAILED', 'The expected delivery date precedes the order date');
    }
  }
}

/** Strictly positive exact litres with at most three decimals. */
export function positiveLitres(value: string, field = 'orderedLitres'): string {
  let parsed: Decimal;
  try {
    parsed = new Decimal(value);
  } catch {
    throw new AppError('VALIDATION_FAILED', `${field} must be an exact decimal`);
  }
  if (!parsed.isFinite() || parsed.decimalPlaces() > 3) {
    throw new AppError('VALIDATION_FAILED', `${field} allows at most 3 decimals`);
  }
  if (parsed.lte(0)) throw new AppError('VALIDATION_FAILED', `${field} must be greater than zero`);
  return parsed.toFixed(3);
}

/** Non-negative exact unit price with at most eight decimals (landed-cost precision). */
export function unitPrice(value: string, field = 'agreedUnitPrice'): string {
  let parsed: Decimal;
  try {
    parsed = new Decimal(value);
  } catch {
    throw new AppError('VALIDATION_FAILED', `${field} must be an exact decimal`);
  }
  if (!parsed.isFinite() || parsed.decimalPlaces() > 8) {
    throw new AppError('VALIDATION_FAILED', `${field} allows at most 8 decimals`);
  }
  if (parsed.lt(0)) throw new AppError('VALIDATION_FAILED', `${field} cannot be negative`);
  return parsed.toFixed(8);
}

export type LineDraft = Readonly<{
  lineId?: string;
  productId: string;
  orderedLitres: string;
  agreedUnitPrice?: string | null;
}>;

export type ValidatedLine = Readonly<{
  lineId: string | null;
  productId: string;
  orderedLitres: string;
  agreedUnitPrice: string | null;
}>;

export function validateLines(lines: readonly LineDraft[]): ValidatedLine[] {
  if (lines.length === 0) {
    throw new AppError('VALIDATION_FAILED', 'A purchase order needs at least one line');
  }
  const seen = new Set<string>();
  return lines.map((line) => {
    if (line.lineId) {
      if (seen.has(line.lineId)) {
        throw new AppError('VALIDATION_FAILED', 'A line appears more than once');
      }
      seen.add(line.lineId);
    }
    return {
      lineId: line.lineId ?? null,
      productId: line.productId,
      orderedLitres: positiveLitres(line.orderedLitres),
      agreedUnitPrice:
        line.agreedUnitPrice === undefined || line.agreedUnitPrice === null
          ? null
          : unitPrice(line.agreedUnitPrice),
    };
  });
}

/**
 * Separation of duties: the person who submitted (or last amended) an order may not approve it
 * while another approver exists. The caller supplies whether another active approver exists.
 */
export function assertApproverAllowed(input: {
  submitterMembershipId: string | null;
  approverMembershipId: string;
  alternateApproverExists: boolean;
}): void {
  if (input.submitterMembershipId === input.approverMembershipId && input.alternateApproverExists) {
    throw new AppError(
      'FORBIDDEN',
      'A purchase order cannot be approved by the person who submitted it while another approver exists',
    );
  }
}

export type LineReceiptInput = Readonly<{
  orderedLitres: string;
  /** Sum of actual litres on CONFIRMED linked deliveries. */
  confirmedLitres: string;
  /** Sum of actual litres on DRAFT linked deliveries (not yet physical authority). */
  draftLitres: string;
  shortClosedLitres: string | null;
}>;

export type LineReceipt = Readonly<{
  receivedLitres: string;
  pendingLitres: string;
  /** Ordered minus received, never negative; zero once short-closed. */
  openLitres: string;
  /** Received above ordered, as a plain fact. The tolerance policy is owned elsewhere. */
  overReceiptLitres: string;
  shortClosedLitres: string | null;
  receiptStatus: PurchaseOrderReceiptStatus;
}>;

export function computeLineReceipt(input: LineReceiptInput): LineReceipt {
  const ordered = new Decimal(input.orderedLitres);
  const received = new Decimal(input.confirmedLitres);
  const pending = new Decimal(input.draftLitres);
  const over = Decimal.max(received.sub(ordered), 0);
  const shortClosed =
    input.shortClosedLitres === null ? null : new Decimal(input.shortClosedLitres);
  const open = shortClosed ? new Decimal(0) : Decimal.max(ordered.sub(received), 0);
  const status: PurchaseOrderReceiptStatus = received.gte(ordered)
    ? 'RECEIVED'
    : received.gt(0)
      ? 'PARTIALLY_RECEIVED'
      : 'NOT_RECEIVED';
  return {
    receivedLitres: received.toFixed(3),
    pendingLitres: pending.toFixed(3),
    openLitres: open.toFixed(3),
    overReceiptLitres: over.toFixed(3),
    shortClosedLitres: shortClosed ? shortClosed.toFixed(3) : null,
    receiptStatus: status,
  };
}

/** Order-level receipt status over active lines: all received, some received, or none. */
export function deriveOrderReceiptStatus(
  lines: readonly Pick<LineReceipt, 'receiptStatus'>[],
): PurchaseOrderReceiptStatus {
  if (lines.length === 0) return 'NOT_RECEIVED';
  if (lines.every((line) => line.receiptStatus === 'RECEIVED')) return 'RECEIVED';
  if (lines.some((line) => line.receiptStatus !== 'NOT_RECEIVED')) return 'PARTIALLY_RECEIVED';
  return 'NOT_RECEIVED';
}

/** What an approved order shows: the derived receipt status once fuel has arrived. */
export function displayState(
  state: PurchaseOrderState,
  receipt: PurchaseOrderReceiptStatus,
): PurchaseOrderState | 'PARTIALLY_RECEIVED' | 'RECEIVED' {
  if (state !== 'APPROVED') return state;
  return receipt === 'NOT_RECEIVED' ? 'APPROVED' : receipt;
}

/** Litres still owed on a line at close time; recorded as short-closed litres. */
export function shortClosedLitres(orderedLitres: string, confirmedLitres: string): string {
  return Decimal.max(new Decimal(orderedLitres).sub(new Decimal(confirmedLitres)), 0).toFixed(3);
}
