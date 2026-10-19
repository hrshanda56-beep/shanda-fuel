import Decimal from 'decimal.js';
import type { StatusTone } from '@/design-system/primitives';
import { formatBusinessDate, formatDecimal } from '@/design-system/formatters';
import { formatTileMoney } from '@/modules/reporting/format';

/**
 * Plain-language wording and presentation helpers for the Purchasing screens. Pure and
 * browser-safe. Amounts and litres stay exact strings; nothing here decides money.
 */

export type OrderDisplayState =
  'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CANCELLED' | 'CLOSED';

const ORDER_STATUS: Record<OrderDisplayState, { label: string; tone: StatusTone; next: string }> = {
  DRAFT: {
    label: 'Draft',
    tone: 'neutral',
    next: 'Check the details, then send it for approval.',
  },
  SUBMITTED: {
    label: 'Waiting for approval',
    tone: 'pending',
    next: 'A manager needs to approve this order before it goes to the supplier.',
  },
  APPROVED: {
    label: 'Approved, fuel not delivered yet',
    tone: 'informational',
    next: 'When the fuel arrives, link the delivery to this order.',
  },
  PARTIALLY_RECEIVED: {
    label: 'Partly delivered',
    tone: 'warning',
    next: 'Some fuel has arrived. Link further deliveries, or close the order if no more is coming.',
  },
  RECEIVED: {
    label: 'Fully delivered',
    tone: 'positive',
    next: 'All the fuel has arrived. Close the order once the invoice is sorted.',
  },
  CANCELLED: { label: 'Cancelled', tone: 'locked', next: 'This order was cancelled.' },
  CLOSED: { label: 'Closed', tone: 'locked', next: 'This order is finished.' },
};

export function orderStatus(state: string): { label: string; tone: StatusTone; next: string } {
  return (
    ORDER_STATUS[state as OrderDisplayState] ?? { label: 'Unknown', tone: 'neutral', next: '' }
  );
}

export type OrderFilter = 'all' | 'waiting' | 'open' | 'finished';

export const ORDER_FILTERS: ReadonlyArray<{ value: OrderFilter; label: string }> = [
  { value: 'all', label: 'All orders' },
  { value: 'waiting', label: 'Waiting for approval' },
  { value: 'open', label: 'Expecting fuel' },
  { value: 'finished', label: 'Finished' },
];

export function orderMatchesFilter(state: string, filter: OrderFilter): boolean {
  if (filter === 'waiting') return state === 'DRAFT' || state === 'SUBMITTED';
  if (filter === 'open') return state === 'APPROVED' || state === 'PARTIALLY_RECEIVED';
  if (filter === 'finished') {
    return state === 'RECEIVED' || state === 'CLOSED' || state === 'CANCELLED';
  }
  return true;
}

/** "12000.000" becomes "12,000 L"; "1250.500" keeps its real decimals. */
export function litresText(value: string | null | undefined): string {
  if (value === null || value === undefined || !/^-?\d+(?:\.\d+)?$/.test(value.trim())) return '—';
  const trimmed = new Decimal(value.trim()).toFixed().replace(/(\.\d*?)0+$/, '$1');
  return formatDecimal(trimmed.replace(/\.$/, ''), ' L');
}

/** A per-litre price, e.g. "USD 1.45 per litre". Keeps up to four decimals, at least two. */
export function pricePerLitreText(value: string | null | undefined): string {
  if (value === null || value === undefined || !/^-?\d+(?:\.\d+)?$/.test(value.trim())) {
    return 'No price set';
  }
  const decimal = new Decimal(value.trim());
  const rounded = decimal.toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
  const places = Math.max(2, rounded.decimalPlaces());
  return `USD ${formatDecimal(rounded.toFixed(places))} per litre`;
}

export function moneyText(value: string | null | undefined): string {
  return formatTileMoney(value);
}

export function dateText(value: string | null | undefined): string {
  if (!value) return '—';
  return formatBusinessDate(value.slice(0, 10));
}

export type OrderLineLike = { orderedLitres: string; status: string };

/** Total litres across lines that are still part of the order. */
export function totalOrderedLitres(lines: readonly OrderLineLike[]): string {
  return lines
    .filter((line) => line.status === 'ACTIVE')
    .reduce((sum, line) => sum.add(line.orderedLitres), new Decimal(0))
    .toFixed(3);
}

/** What the order is for, e.g. "Diesel 10,000 L, Petrol 5,000 L". */
export function orderFuelSummary(
  lines: readonly { productName: string; orderedLitres: string; status: string }[],
): string {
  return lines
    .filter((line) => line.status === 'ACTIVE')
    .map((line) => `${line.productName} ${litresText(line.orderedLitres)}`)
    .join(', ');
}

export type CoverageState = 'UNBILLED' | 'PARTIALLY_BILLED' | 'BILLED' | 'OVER_BILLED';

const COVERAGE: Record<CoverageState, { label: string; tone: StatusTone }> = {
  UNBILLED: { label: 'Not invoiced yet', tone: 'warning' },
  PARTIALLY_BILLED: { label: 'Partly invoiced', tone: 'warning' },
  BILLED: { label: 'Invoiced', tone: 'positive' },
  OVER_BILLED: { label: 'Invoiced for too much', tone: 'critical' },
};

export function coverageStatus(state: string): { label: string; tone: StatusTone } {
  return COVERAGE[state as CoverageState] ?? { label: 'Unknown', tone: 'neutral' };
}

/** True when a delivery still needs someone to chase or check an invoice. */
export function needsInvoiceAttention(state: string): boolean {
  return state !== 'BILLED';
}

export function priceBasisText(basis: string | null, orderNumber: string | null): string | null {
  if (basis === 'PURCHASE_ORDER') {
    return orderNumber
      ? `the price agreed on order ${orderNumber}`
      : 'the price agreed on the order';
  }
  if (basis === 'RECEIPT_COST') return 'the cost recorded when the fuel arrived';
  return null;
}

/** A short plain headline for a check result. */
export function checkHeadline(row: { exceeded: boolean; invoicedLitres: string | null }): {
  label: string;
  tone: StatusTone;
} {
  if (row.exceeded) return { label: 'Needs a look', tone: 'critical' };
  if (row.invoicedLitres === null) return { label: 'No invoice yet', tone: 'neutral' };
  return { label: 'Looks right', tone: 'positive' };
}

/** "0.070" litres difference as "70 L more" / "70 L less" / "no difference". */
export function differenceText(value: string | null, unit: 'litres' | 'price'): string | null {
  if (value === null) return null;
  const decimal = new Decimal(value);
  if (decimal.isZero()) return 'no difference';
  const direction = decimal.gt(0) ? 'more' : 'less';
  if (unit === 'litres') return `${litresText(decimal.abs().toFixed())} ${direction}`;
  return `${pricePerLitreText(decimal.abs().toFixed()).replace(' per litre', '')} ${direction} per litre`;
}

export const TOLERANCE_ACTION_OPTIONS = [
  { value: 'FLAG', label: 'Flag it so someone can review it' },
  { value: 'REQUIRE_APPROVAL', label: 'Hold the invoice until a manager approves it' },
] as const;

export const VAT_MODE_OPTIONS = [
  { value: 'NONE', label: 'No VAT on supplier invoices' },
  { value: 'EXCLUSIVE', label: 'Invoice prices do not include VAT (VAT is added on top)' },
  { value: 'INCLUSIVE', label: 'Invoice prices already include VAT' },
] as const;

export function toleranceActionText(value: string): string {
  return (
    TOLERANCE_ACTION_OPTIONS.find((option) => option.value === value)?.label ?? 'Flag it for review'
  );
}

export function vatModeText(mode: string, rate: string | null): string {
  if (mode === 'EXCLUSIVE') return `Prices exclude VAT${rate ? `, ${rate}% added on top` : ''}`;
  if (mode === 'INCLUSIVE') return `Prices include VAT${rate ? ` at ${rate}%` : ''}`;
  return 'No VAT on supplier invoices';
}

/** "Not set" for an empty tolerance; strict (zero) is what the server applies. */
export function allowanceText(value: string | null, suffix: string): string | null {
  if (value === null || value === '') return null;
  return `${formatDecimal(
    new Decimal(value)
      .toFixed()
      .replace(/(\.\d*?)0+$/, '$1')
      .replace(/\.$/, ''),
  )}${suffix}`;
}

/** One sentence describing a quantity allowance given litres and/or percent. */
export function litresAllowanceSentence(litres: string | null, percent: string | null): string {
  const parts = [allowanceText(litres, ' L'), allowanceText(percent, '%')].filter(Boolean);
  if (parts.length === 0) return 'No difference allowed';
  return `Up to ${parts.join(' or ')}`;
}

export function percentAllowanceSentence(percent: string | null): string {
  const text = allowanceText(percent, '%');
  return text ? `Up to ${text}` : 'No difference allowed';
}

export function amountAllowanceSentence(amount: string | null): string {
  const text = allowanceText(amount, '');
  return text ? `Up to USD ${text}` : 'No difference allowed';
}

const EXACT_NUMBER = /^\d+(?:\.\d+)?$/;

/** Empty is fine (nothing allowed); otherwise a plain non-negative number within decimals. */
export function checkAllowanceInput(
  value: string,
  places: number,
): { ok: true; value: string | null } | { ok: false } {
  const text = value.trim().replace(/,/g, '');
  if (text === '') return { ok: true, value: null };
  if (!EXACT_NUMBER.test(text)) return { ok: false };
  if ((text.split('.')[1]?.length ?? 0) > places) return { ok: false };
  return { ok: true, value: text };
}

export type OrderLineInput = {
  lineId?: string;
  productId: string;
  litres: string;
  price: string;
};

export type OrderLineCheck =
  | {
      ok: true;
      lines: {
        lineId?: string;
        productId: string;
        orderedLitres: string;
        agreedUnitPrice: string | null;
      }[];
    }
  | { ok: false; message: string };

/** Turns what was typed into exact strings the server accepts, or says what to fix. */
export function checkOrderLines(lines: readonly OrderLineInput[]): OrderLineCheck {
  if (lines.length === 0) return { ok: false, message: 'Add at least one fuel line to the order.' };
  const result: {
    lineId?: string;
    productId: string;
    orderedLitres: string;
    agreedUnitPrice: string | null;
  }[] = [];
  for (const [index, line] of lines.entries()) {
    const label = lines.length > 1 ? `Line ${index + 1}: ` : '';
    if (!line.productId) return { ok: false, message: `${label}Choose the fuel.` };
    const litres = line.litres.trim().replace(/,/g, '');
    if (!EXACT_NUMBER.test(litres) || new Decimal(litres).lte(0)) {
      return { ok: false, message: `${label}Enter how many litres you are ordering, e.g. 10000.` };
    }
    if ((litres.split('.')[1]?.length ?? 0) > 3) {
      return { ok: false, message: `${label}Litres can have at most 3 decimal places.` };
    }
    const price = line.price.trim().replace(/,/g, '');
    if (price !== '' && !EXACT_NUMBER.test(price)) {
      return { ok: false, message: `${label}Enter the price per litre as a number, e.g. 1.45.` };
    }
    if ((price.split('.')[1]?.length ?? 0) > 8) {
      return { ok: false, message: `${label}The price can have at most 8 decimal places.` };
    }
    result.push({
      ...(line.lineId ? { lineId: line.lineId } : {}),
      productId: line.productId,
      orderedLitres: litres,
      agreedUnitPrice: price === '' ? null : price,
    });
  }
  return { ok: true, lines: result };
}

/** Today in the business time zone as YYYY-MM-DD. */
export function todayBusinessDate(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Harare' }).format(new Date());
}
