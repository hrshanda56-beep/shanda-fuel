import Decimal from 'decimal.js';
import { AppError } from '../../platform/errors';
import { ExactDecimal, type DecimalPolicy } from '../../platform/domain/primitives';

/**
 * Pure purchasing-policy and invoice-line arithmetic (ADR-018). No tax rate, threshold or
 * tolerance is hard-coded here: every figure comes from the tenant's purchasing policy.
 * Absent configuration allows 0.5% on litres, nothing on price, and is VAT-free (mode NONE).
 *
 * Rounding rule (documented once, applied everywhere): a derived monetary amount is rounded
 * half-up (a tie moves away from zero) to 4 decimal places, at exactly one named boundary per
 * line, and the other component is derived by subtraction so that net + VAT == gross always
 * holds exactly. Header totals are plain sums of the rounded line figures.
 */

export const VAT_MODES = ['NONE', 'EXCLUSIVE', 'INCLUSIVE'] as const;
export type VatMode = (typeof VAT_MODES)[number];

export const TOLERANCE_ACTIONS = ['FLAG', 'REQUIRE_APPROVAL'] as const;
export type ToleranceAction = (typeof TOLERANCE_ACTIONS)[number];

const MONEY: DecimalPolicy = { name: 'Money', precision: 20, scale: 4 };
const LITRES: DecimalPolicy = { name: 'Litres', precision: 18, scale: 3 };
const UNIT_PRICE: DecimalPolicy = { name: 'UnitPrice', precision: 20, scale: 8 };
const PERCENT: DecimalPolicy = { name: 'Percent', precision: 9, scale: 4 };

export type PurchasingPolicyValues = Readonly<{
  quantityToleranceLitres: string | null;
  quantityTolerancePercent: string | null;
  priceTolerancePercent: string | null;
  amountTolerance: string | null;
  overReceiptToleranceLitres: string | null;
  overReceiptTolerancePercent: string | null;
  toleranceAction: ToleranceAction;
  vatMode: VatMode;
  defaultVatRate: string | null;
  productVatRates: Readonly<Record<string, string>>;
  requireInvoiceLines: boolean;
}>;

/** Per-supplier override: every undefined/null field inherits from the tenant policy. */
export type PurchasingPolicyOverride = Readonly<
  Partial<Omit<PurchasingPolicyValues, 'productVatRates'>>
>;

export type ResolvedPurchasingPolicy = PurchasingPolicyValues &
  Readonly<{
    source: 'DEFAULT' | 'TENANT' | 'SUPPLIER_OVERRIDE';
  }>;

/**
 * Used until a tenant configures a policy: VAT-free, invoices carry lines, 0.5% allowed on litres
 * (dip and meter readings never agree exactly) and none on price, which is an agreed figure.
 */
export const BUILT_IN_PURCHASING_POLICY: PurchasingPolicyValues = {
  quantityToleranceLitres: null,
  quantityTolerancePercent: '0.5',
  priceTolerancePercent: null,
  amountTolerance: null,
  overReceiptToleranceLitres: null,
  overReceiptTolerancePercent: null,
  toleranceAction: 'FLAG',
  vatMode: 'NONE',
  defaultVatRate: null,
  productVatRates: {},
  requireInvoiceLines: true,
};

export function resolvePurchasingPolicy(
  tenantPolicy: PurchasingPolicyValues | null,
  supplierOverride: PurchasingPolicyOverride | null,
): ResolvedPurchasingPolicy {
  const base = tenantPolicy ?? BUILT_IN_PURCHASING_POLICY;
  const o = supplierOverride ?? {};
  const text = (
    key:
      | 'quantityToleranceLitres'
      | 'quantityTolerancePercent'
      | 'priceTolerancePercent'
      | 'amountTolerance'
      | 'overReceiptToleranceLitres'
      | 'overReceiptTolerancePercent'
      | 'defaultVatRate',
  ): string | null => o[key] ?? base[key];
  return {
    quantityToleranceLitres: text('quantityToleranceLitres'),
    quantityTolerancePercent: text('quantityTolerancePercent'),
    priceTolerancePercent: text('priceTolerancePercent'),
    amountTolerance: text('amountTolerance'),
    overReceiptToleranceLitres: text('overReceiptToleranceLitres'),
    overReceiptTolerancePercent: text('overReceiptTolerancePercent'),
    toleranceAction: o.toleranceAction ?? base.toleranceAction,
    vatMode: o.vatMode ?? base.vatMode,
    defaultVatRate: text('defaultVatRate'),
    productVatRates: base.productVatRates,
    requireInvoiceLines: o.requireInvoiceLines ?? base.requireInvoiceLines,
    source: supplierOverride ? 'SUPPLIER_OVERRIDE' : tenantPolicy ? 'TENANT' : 'DEFAULT',
  };
}

function bad(message: string, details?: Record<string, unknown>): never {
  throw new AppError('VALIDATION_FAILED', message, details);
}

function parse(value: string, policy: DecimalPolicy, label: string): ExactDecimal {
  try {
    return new ExactDecimal(value.trim(), policy);
  } catch {
    return bad(
      `${label} must be a plain number with at most ${policy.scale} decimal places (you sent "${value}").`,
    );
  }
}

/** Exact, non-negative decimal text within a policy, or null when unset. */
export function optionalDecimal(
  value: string | null | undefined,
  policy: DecimalPolicy,
  label: string,
  max?: string,
): string | null {
  if (value === null || value === undefined) return null;
  const parsed = parse(value, policy, label);
  if (parsed.value.isNegative()) bad(`${label} cannot be negative.`);
  if (max !== undefined && parsed.value.gt(new Decimal(max))) {
    bad(`${label} cannot be more than ${max}.`);
  }
  return parsed.value.toFixed(policy.scale);
}

export const percentText = (value: string | null | undefined, label: string) =>
  optionalDecimal(value, PERCENT, label, '100');
export const litresText = (value: string | null | undefined, label: string) =>
  optionalDecimal(value, LITRES, label);
export const moneyText = (value: string | null | undefined, label: string) =>
  optionalDecimal(value, MONEY, label);

/** Normalizes and validates a policy write; cross-field rules live here. */
export function validatePurchasingPolicyValues(input: {
  quantityToleranceLitres?: string | null;
  quantityTolerancePercent?: string | null;
  priceTolerancePercent?: string | null;
  amountTolerance?: string | null;
  overReceiptToleranceLitres?: string | null;
  overReceiptTolerancePercent?: string | null;
  toleranceAction?: string | null;
  vatMode?: string | null;
  defaultVatRate?: string | null;
  productVatRates?: Readonly<Record<string, string>>;
  requireInvoiceLines?: boolean | null;
}): Omit<PurchasingPolicyValues, 'toleranceAction' | 'vatMode' | 'requireInvoiceLines'> & {
  toleranceAction: ToleranceAction | null;
  vatMode: VatMode | null;
  requireInvoiceLines: boolean | null;
} {
  const action = input.toleranceAction ?? null;
  if (action !== null && !TOLERANCE_ACTIONS.includes(action as ToleranceAction)) {
    bad('The action when a tolerance is exceeded must be FLAG or REQUIRE_APPROVAL.');
  }
  const mode = input.vatMode ?? null;
  if (mode !== null && !VAT_MODES.includes(mode as VatMode)) {
    bad('VAT mode must be NONE, EXCLUSIVE or INCLUSIVE.');
  }
  const productVatRates: Record<string, string> = {};
  for (const [productId, rate] of Object.entries(input.productVatRates ?? {})) {
    productVatRates[productId] = percentText(rate, 'A product VAT rate') as string;
  }
  return {
    quantityToleranceLitres: litresText(
      input.quantityToleranceLitres,
      'Quantity tolerance (litres)',
    ),
    quantityTolerancePercent: percentText(
      input.quantityTolerancePercent,
      'Quantity tolerance (percent)',
    ),
    priceTolerancePercent: percentText(input.priceTolerancePercent, 'Price tolerance (percent)'),
    amountTolerance: moneyText(input.amountTolerance, 'Amount tolerance'),
    overReceiptToleranceLitres: litresText(
      input.overReceiptToleranceLitres,
      'Over-receipt tolerance (litres)',
    ),
    overReceiptTolerancePercent: percentText(
      input.overReceiptTolerancePercent,
      'Over-receipt tolerance (percent)',
    ),
    toleranceAction: action as ToleranceAction | null,
    vatMode: mode as VatMode | null,
    defaultVatRate: percentText(input.defaultVatRate, 'The default VAT rate'),
    productVatRates,
    requireInvoiceLines: input.requireInvoiceLines ?? null,
  };
}

// ---------------------------------------------------------------------------------------
// Invoice lines and VAT
// ---------------------------------------------------------------------------------------

export type InvoiceLineInput = Readonly<{
  productId?: string | undefined;
  description: string;
  /** Litres or units, at most 3 decimal places. */
  quantity: string;
  /** Per-unit price as printed on the invoice, at most 8 decimal places. */
  unitPrice: string;
  /**
   * The line total as printed on the invoice. Optional: defaults to quantity x unit price,
   * rounded half-up to 4 decimal places. In EXCLUSIVE mode it is the net (before VAT) total;
   * in INCLUSIVE mode it is the VAT-inclusive total.
   */
  amount?: string | undefined;
  /** Percent, overriding the product/default rate (documentation only if vatAmount is given). */
  vatRate?: string | undefined;
  /** VAT as printed on the invoice, overriding the computed figure. */
  vatAmount?: string | undefined;
  deliveryId?: string | undefined;
  allocationId?: string | undefined;
}>;

export type ComputedInvoiceLine = Readonly<{
  lineNo: number;
  productId: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
  netAmount: string;
  vatRate: string | null;
  vatAmount: string;
  grossAmount: string;
  deliveryId: string | null;
  allocationId: string | null;
}>;

function round(value: Decimal, scale: number): Decimal {
  return value.toDecimalPlaces(scale, Decimal.ROUND_HALF_UP);
}

export function resolveVatRate(
  line: Pick<InvoiceLineInput, 'productId' | 'vatRate'>,
  policy: Pick<PurchasingPolicyValues, 'defaultVatRate' | 'productVatRates'>,
): string | null {
  if (line.vatRate !== undefined) return percentText(line.vatRate, 'The VAT rate') as string;
  if (line.productId && policy.productVatRates[line.productId] !== undefined) {
    return policy.productVatRates[line.productId]!;
  }
  return policy.defaultVatRate;
}

export function computeInvoiceLine(
  input: InvoiceLineInput,
  lineNo: number,
  policy: Pick<PurchasingPolicyValues, 'vatMode' | 'defaultVatRate' | 'productVatRates'>,
): ComputedInvoiceLine {
  const label = `Line ${lineNo}`;
  const description = input.description.trim();
  if (!description) bad(`${label} needs a description.`);
  const quantity = parse(input.quantity, LITRES, `${label} quantity`);
  if (!quantity.value.gt(0)) bad(`${label} quantity must be greater than zero.`);
  const unitPrice = parse(input.unitPrice, UNIT_PRICE, `${label} unit price`);
  if (unitPrice.value.isNegative()) bad(`${label} unit price cannot be negative.`);

  const stated =
    input.amount !== undefined
      ? parse(input.amount, MONEY, `${label} amount`).value
      : round(quantity.value.mul(unitPrice.value), MONEY.scale);
  if (stated.isNegative()) bad(`${label} amount cannot be negative.`);

  const statedVat =
    input.vatAmount !== undefined
      ? parse(input.vatAmount, MONEY, `${label} VAT amount`).value
      : undefined;
  if (statedVat?.isNegative()) bad(`${label} VAT amount cannot be negative.`);

  let net: Decimal;
  let vat: Decimal;
  let gross: Decimal;
  let rate: string | null = null;

  if (policy.vatMode === 'NONE') {
    if (
      (statedVat !== undefined && !statedVat.isZero()) ||
      (input.vatRate !== undefined &&
        !parse(input.vatRate, PERCENT, `${label} VAT rate`).value.isZero())
    ) {
      bad(
        `${label} has VAT, but VAT is switched off in the purchasing policy. Remove the VAT or ask an administrator to turn VAT on.`,
      );
    }
    net = stated;
    vat = new Decimal(0);
    gross = stated;
  } else {
    rate = resolveVatRate(input, policy);
    if (statedVat === undefined && rate === null) {
      bad(
        `${label} needs a VAT rate. No rate is configured for this product or as a default; enter the rate for the line or ask an administrator to set one in the purchasing policy.`,
      );
    }
    if (policy.vatMode === 'EXCLUSIVE') {
      net = stated;
      vat = statedVat ?? round(net.mul(new Decimal(rate!)).div(100), MONEY.scale);
      gross = net.add(vat);
    } else {
      gross = stated;
      if (statedVat !== undefined) {
        vat = statedVat;
        net = gross.sub(vat);
      } else {
        net = round(gross.mul(100).div(new Decimal(100).add(new Decimal(rate!))), MONEY.scale);
        vat = gross.sub(net);
      }
      if (net.isNegative()) bad(`${label} VAT is larger than the line total.`);
    }
  }

  return {
    lineNo,
    productId: input.productId ?? null,
    description,
    quantity: quantity.value.toFixed(LITRES.scale),
    unitPrice: unitPrice.value.toFixed(UNIT_PRICE.scale),
    netAmount: net.toFixed(MONEY.scale),
    vatRate: rate,
    vatAmount: vat.toFixed(MONEY.scale),
    grossAmount: gross.toFixed(MONEY.scale),
    deliveryId: input.deliveryId ?? null,
    allocationId: input.allocationId ?? null,
  };
}

export type InvoiceTotals = Readonly<{ net: string; vat: string; gross: string }>;

export function sumInvoiceLines(lines: readonly ComputedInvoiceLine[]): InvoiceTotals {
  let net = new Decimal(0);
  let vat = new Decimal(0);
  let gross = new Decimal(0);
  for (const line of lines) {
    net = net.add(line.netAmount);
    vat = vat.add(line.vatAmount);
    gross = gross.add(line.grossAmount);
  }
  return {
    net: net.toFixed(MONEY.scale),
    vat: vat.toFixed(MONEY.scale),
    gross: gross.toFixed(MONEY.scale),
  };
}

/**
 * The header amount (what is payable) must equal the line total exactly, and any header net
 * or VAT figure the supplier printed must match the computed one exactly.
 */
export function assertHeaderMatchesLines(
  header: { amount: string; netAmount?: string | undefined; vatAmount?: string | undefined },
  totals: InvoiceTotals,
): void {
  const amount = parse(header.amount, MONEY, 'The invoice amount').value;
  if (!amount.eq(totals.gross)) {
    bad(
      `The invoice total is ${amount.toFixed(MONEY.scale)} but its lines add up to ${totals.gross} (${totals.net} before VAT plus ${totals.vat} VAT). Correct the lines or the total so they agree.`,
      { headerAmount: amount.toFixed(MONEY.scale), lineTotal: totals.gross },
    );
  }
  if (header.netAmount !== undefined) {
    const net = parse(header.netAmount, MONEY, 'The invoice net amount').value;
    if (!net.eq(totals.net)) {
      bad(
        `The invoice net amount is ${net.toFixed(MONEY.scale)} but its lines add up to ${totals.net} before VAT.`,
      );
    }
  }
  if (header.vatAmount !== undefined) {
    const vat = parse(header.vatAmount, MONEY, 'The invoice VAT amount').value;
    if (!vat.eq(totals.vat)) {
      bad(
        `The invoice VAT is ${vat.toFixed(MONEY.scale)} but its lines come to ${totals.vat} VAT.`,
      );
    }
  }
}
