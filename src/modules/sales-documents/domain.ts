import { DECIMAL_POLICIES, ExactDecimal } from '../../platform/domain/primitives';
import { AppError } from '../../platform/errors';

/** Plain per-company rule, never a tax-authority claim (DEC-045). */
export type SalesDocumentType = 'QUOTATION' | 'INVOICE' | 'RECEIPT';

export type DraftLine = {
  readonly quantity: string;
  readonly unitPrice: string;
  /** A money amount taken off this line before tax. */
  readonly discountAmount: string;
  /** Percent, for example "15" for 15 percent. "0" means no tax. */
  readonly taxRate: string;
};

export type ComputedLine = {
  readonly netAmount: string;
  readonly taxAmount: string;
  readonly lineTotal: string;
};

export type DocumentTotals = {
  readonly lines: readonly ComputedLine[];
  readonly subtotal: string;
  readonly discountTotal: string;
  readonly taxTotal: string;
  readonly total: string;
};

const ZERO = new ExactDecimal('0');

function money(value: ExactDecimal): ExactDecimal {
  return value.quantize(DECIMAL_POLICIES.money, 'half-up');
}

/** Four decimals always, so stored and printed figures never lose trailing zeros. */
function fixed(value: ExactDecimal): string {
  return money(value).value.toFixed(DECIMAL_POLICIES.money.scale);
}

/**
 * Each line is worked out and rounded to four decimals on its own (gross, then discount, then
 * tax), and the document totals are the sums of those rounded lines, so every figure on the
 * printed page adds up exactly. Nothing goes through JavaScript floating point.
 */
export function computeDocumentTotals(lines: readonly DraftLine[]): DocumentTotals {
  let subtotal = ZERO;
  let discountTotal = ZERO;
  let taxTotal = ZERO;
  const computed: ComputedLine[] = lines.map((line) => {
    const gross = money(new ExactDecimal(line.quantity).multiply(new ExactDecimal(line.unitPrice)));
    const discount = money(new ExactDecimal(line.discountAmount));
    if (discount.value.gt(gross.value)) {
      throw new AppError(
        'VALIDATION_FAILED',
        'A line discount cannot be more than the line amount',
      );
    }
    const net = gross.subtract(discount);
    const rate = new ExactDecimal(line.taxRate);
    if (rate.value.lt(0) || rate.value.gt(100)) {
      throw new AppError('VALIDATION_FAILED', 'A tax rate must be between 0 and 100');
    }
    const tax = money(net.multiply(rate).multiply(new ExactDecimal('0.01')));
    subtotal = subtotal.add(gross);
    discountTotal = discountTotal.add(discount);
    taxTotal = taxTotal.add(tax);
    return {
      netAmount: fixed(net),
      taxAmount: fixed(tax),
      lineTotal: fixed(net.add(tax)),
    };
  });
  const total = subtotal.subtract(discountTotal).add(taxTotal);
  return {
    lines: computed,
    subtotal: fixed(subtotal),
    discountTotal: fixed(discountTotal),
    taxTotal: fixed(taxTotal),
    total: fixed(total),
  };
}

/** Example: QT-2026-0007. The sequence restarts each calendar year, per company and type. */
export function formatDocumentNumber(prefix: string, year: number, sequence: number): string {
  if (!/^[A-Za-z0-9-]{1,10}$/.test(prefix)) throw new Error('Invalid document prefix');
  if (!Number.isInteger(year) || year < 2000 || year > 2200) throw new Error('Invalid year');
  if (!Number.isInteger(sequence) || sequence < 1) throw new Error('Invalid sequence');
  return `${prefix}-${year}-${String(sequence).padStart(4, '0')}`;
}

/** Whole money amounts owed: the invoice total less the receipts that are not voided. */
export function invoiceBalance(invoiceTotal: string, receiptTotals: readonly string[]): string {
  const paid = receiptTotals.reduce((sum, value) => sum.add(new ExactDecimal(value)), ZERO);
  return fixed(new ExactDecimal(invoiceTotal).subtract(paid));
}

export type PaymentState = 'UNPAID' | 'PART_PAID' | 'PAID' | 'OVERPAID';

export function paymentState(invoiceTotal: string, receiptTotals: readonly string[]): PaymentState {
  const balance = new ExactDecimal(invoiceBalance(invoiceTotal, receiptTotals));
  if (balance.value.eq(0)) return 'PAID';
  if (balance.value.lt(0)) return 'OVERPAID';
  const paid = receiptTotals.reduce((sum, value) => sum.add(new ExactDecimal(value)), ZERO);
  return paid.value.gt(0) ? 'PART_PAID' : 'UNPAID';
}
