import { TABLE_REPORT_FILTER_KEYS, type TableReportFilterKey } from './definitions';

/**
 * The extra report filters as they travel in the page address and the download address. The
 * address names are the same as the report query fields, so a download carries them unchanged.
 * Pure parsing and writing; nothing here is trusted: the report query validates them again.
 */
export const NARROWING_PARAMS: Readonly<Record<TableReportFilterKey, string>> = {
  product: 'productId',
  supplier: 'supplierId',
  customer: 'customerId',
  employee: 'employeeId',
  shift: 'shiftTemplateId',
  paymentMethod: 'paymentMethod',
};

export const NARROWING_LABELS: Readonly<Record<TableReportFilterKey, string>> = {
  product: 'Fuel',
  supplier: 'Supplier',
  customer: 'Customer',
  employee: 'Employee',
  shift: 'Shift',
  paymentMethod: 'Payment method',
};

export const NARROWING_ALL_LABELS: Readonly<Record<TableReportFilterKey, string>> = {
  product: 'All fuels',
  supplier: 'All suppliers',
  customer: 'All customers',
  employee: 'All employees',
  shift: 'All shifts',
  paymentMethod: 'All payment methods',
};

export const PAYMENT_METHOD_OPTIONS: readonly { id: string; label: string }[] = [
  { id: 'CASH', label: 'Cash' },
  { id: 'POS', label: 'Card (POS)' },
  { id: 'ECOCASH', label: 'EcoCash' },
  { id: 'BANK_TRANSFER', label: 'Bank transfer' },
  { id: 'CUSTOMER_CREDIT', label: 'Customer credit' },
  { id: 'PREPAID', label: 'Prepaid' },
  { id: 'STAFF_OR_MANAGEMENT_FUEL', label: 'Staff or management fuel' },
  { id: 'OTHER_APPROVED', label: 'Other approved' },
];

type Params = Pick<URLSearchParams, 'get'>;

/** Only the filters this report understands, and only non-empty values. */
export function parseNarrowing(
  params: Params,
  keys: readonly TableReportFilterKey[],
): Partial<Record<string, string>> {
  const out: Partial<Record<string, string>> = {};
  for (const key of keys) {
    const name = NARROWING_PARAMS[key];
    const value = params.get(name)?.trim();
    if (value) out[name] = value;
  }
  return out;
}

/** Writes the chosen values onto existing params, removing every narrowing name first. */
export function applyNarrowing(
  base: URLSearchParams,
  values: Partial<Record<TableReportFilterKey, string>>,
): URLSearchParams {
  const next = new URLSearchParams(base);
  for (const key of TABLE_REPORT_FILTER_KEYS) next.delete(NARROWING_PARAMS[key]);
  for (const key of TABLE_REPORT_FILTER_KEYS) {
    const value = values[key];
    if (value) next.set(NARROWING_PARAMS[key], value);
  }
  return next;
}
