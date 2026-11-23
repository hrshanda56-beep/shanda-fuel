/**
 * The pure rules behind the purchasing-settings guide: the ready-made answers for each allowance,
 * how a stored value maps back to one of them, and the checks. Keys are element ids.
 */
import { checkAllowanceInput } from './purchasing-format';

export type Errors = Record<string, string>;

export type PolicyFormValues = {
  quantityToleranceLitres: string;
  quantityTolerancePercent: string;
  overReceiptToleranceLitres: string;
  overReceiptTolerancePercent: string;
  priceTolerancePercent: string;
  amountTolerance: string;
  toleranceAction: string;
  vatMode: string;
  defaultVatRate: string;
  requireInvoiceLines: string;
  requireTransportBill: string;
};

export type AllowanceKey = 'qty' | 'over' | 'price' | 'amount';

type Field = keyof PolicyFormValues;

/** Which form fields hold each allowance. `litres` is absent for allowances that have none. */
export const ALLOWANCE_FIELDS: Record<
  AllowanceKey,
  { litres?: Field; percent?: Field; usd?: Field }
> = {
  qty: { litres: 'quantityToleranceLitres', percent: 'quantityTolerancePercent' },
  over: { litres: 'overReceiptToleranceLitres', percent: 'overReceiptTolerancePercent' },
  price: { percent: 'priceTolerancePercent' },
  amount: { usd: 'amountTolerance' },
};

export const OTHER = 'other';

/** The usual answers for an allowance. A supplier can also follow the company's setting. */
export function allowanceChoices(
  key: AllowanceKey,
  isCompany: boolean,
): Array<{ value: string; label: string }> {
  const usual =
    key === 'amount'
      ? [
          { value: 'u1', label: 'Up to $1.00' },
          { value: 'u5', label: 'Up to $5.00' },
        ]
      : [
          { value: 'p05', label: 'Up to 0.5%' },
          { value: 'p1', label: 'Up to 1%' },
        ];
  return [
    ...(isCompany ? [] : [{ value: 'follow', label: 'Same as the company' }]),
    { value: 'none', label: 'No difference allowed' },
    ...usual,
    { value: OTHER, label: 'Another amount' },
  ];
}

function trimmed(value: string): string {
  return value.trim().replace(/,/g, '');
}

function isZero(value: string): boolean {
  const text = trimmed(value);
  return text !== '' && /^0+(?:\.0+)?$/.test(text);
}

function fieldsOf(key: AllowanceKey): Field[] {
  const f = ALLOWANCE_FIELDS[key];
  return [f.litres, f.percent, f.usd].filter((x): x is Field => Boolean(x));
}

/** Which ready-made answer the current values amount to, or "other". */
export function currentAllowanceChoice(
  key: AllowanceKey,
  form: PolicyFormValues,
  isCompany: boolean,
): string {
  const fields = fieldsOf(key);
  const values = fields.map((field) => trimmed(form[field]));
  if (values.every((v) => v === '')) return isCompany ? 'none' : 'follow';
  if (values.every((v) => v === '' || isZero(v))) return 'none';
  const f = ALLOWANCE_FIELDS[key];
  const percent = f.percent ? trimmed(form[f.percent]) : '';
  const litres = f.litres ? trimmed(form[f.litres]) : '';
  const usd = f.usd ? trimmed(form[f.usd]) : '';
  if (f.percent && litres === '' && percent === '0.5') return 'p05';
  if (f.percent && litres === '' && percent === '1') return 'p1';
  if (f.usd && usd === '1') return 'u1';
  if (f.usd && usd === '5') return 'u5';
  return OTHER;
}

/** The form values that go with a ready-made answer. "Another amount" changes nothing yet. */
export function applyAllowanceChoice(
  key: AllowanceKey,
  choice: string,
  isCompany: boolean,
): Partial<PolicyFormValues> {
  const fields = fieldsOf(key);
  const blank = Object.fromEntries(fields.map((f) => [f, ''])) as Partial<PolicyFormValues>;
  const f = ALLOWANCE_FIELDS[key];
  if (choice === 'follow') return blank;
  if (choice === 'none') {
    // A company with nothing set already allows no difference; a supplier must say zero so it
    // does not follow the company.
    return isCompany
      ? blank
      : (Object.fromEntries(fields.map((x) => [x, '0'])) as Partial<PolicyFormValues>);
  }
  if (choice === 'p05' && f.percent) return { ...blank, [f.percent]: '0.5' };
  if (choice === 'p1' && f.percent) return { ...blank, [f.percent]: '1' };
  if (choice === 'u1' && f.usd) return { ...blank, [f.usd]: '1' };
  if (choice === 'u5' && f.usd) return { ...blank, [f.usd]: '5' };
  return {};
}

const LABELS: Record<Field, { label: string; places: number }> = {
  quantityToleranceLitres: { label: 'Allowed quantity difference (litres or kg)', places: 3 },
  quantityTolerancePercent: { label: 'Allowed quantity difference (%)', places: 4 },
  overReceiptToleranceLitres: { label: 'Allowed extra quantity (litres or kg)', places: 3 },
  overReceiptTolerancePercent: { label: 'Allowed extra quantity (%)', places: 4 },
  priceTolerancePercent: { label: 'Allowed price difference (%)', places: 4 },
  amountTolerance: { label: 'Allowed invoice total difference', places: 4 },
  toleranceAction: { label: '', places: 0 },
  vatMode: { label: '', places: 0 },
  defaultVatRate: { label: 'VAT rate', places: 4 },
  requireInvoiceLines: { label: '', places: 0 },
  requireTransportBill: { label: '', places: 0 },
};

/** The element id each number is typed into. */
export const FIELD_IDS: Record<Field, string> = {
  quantityToleranceLitres: 'pp-qty-l',
  quantityTolerancePercent: 'pp-qty-p',
  overReceiptToleranceLitres: 'pp-over-l',
  overReceiptTolerancePercent: 'pp-over-p',
  priceTolerancePercent: 'pp-price',
  amountTolerance: 'pp-amount',
  toleranceAction: 'pp-action',
  vatMode: 'pp-vat',
  defaultVatRate: 'pp-vat-rate',
  requireInvoiceLines: 'pp-lines',
  requireTransportBill: 'pp-transport-bill',
};

function checkNumbers(fields: readonly Field[], form: PolicyFormValues): Errors {
  const errors: Errors = {};
  for (const field of fields) {
    const { label, places } = LABELS[field];
    if (!checkAllowanceInput(form[field], places).ok) {
      errors[FIELD_IDS[field]] =
        `${label}: enter a plain number (at most ${places} decimal places), or leave it empty.`;
    }
  }
  return errors;
}

export function checkAllowance(key: AllowanceKey, form: PolicyFormValues): Errors {
  return checkNumbers(fieldsOf(key), form);
}

/** The VAT rate is needed whenever VAT is shown on invoices. */
export function vatRateNeeded(vatMode: string): boolean {
  return vatMode !== '' && vatMode !== 'NONE';
}

export function checkVatRate(form: PolicyFormValues): Errors {
  const errors = checkNumbers(['defaultVatRate'], form);
  if (Object.keys(errors).length) return errors;
  if (vatRateNeeded(form.vatMode) && !trimmed(form.defaultVatRate)) {
    return { 'pp-vat-rate': 'Enter the VAT rate that applies to supplier invoices.' };
  }
  return {};
}

export function checkPolicyReason(reason: string): Errors {
  return reason.trim() ? {} : { 'pp-reason': 'Say briefly why you are changing these settings.' };
}

/** A supplier must pick (or follow the company); a company always has an answer. */
export function checkChoice(id: string, value: string, isCompany: boolean): Errors {
  return isCompany || value !== '' ? {} : { [id]: 'Choose an answer.' };
}
