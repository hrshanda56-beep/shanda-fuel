/** The checks behind the "New purchase order" guide. Pure, so they are tested alone. Keys are element ids. */
import { checkOrderLines, type OrderLineInput } from './ui/purchasing-format';

export type Errors = Record<string, string>;

export function checkOrderSupplier(supplierId: string): Errors {
  return supplierId ? {} : { 'po-supplier': 'Choose the supplier you are ordering from.' };
}

export function checkOrderDates(orderDate: string, expected: string): Errors {
  if (!orderDate) return { 'po-date': 'Choose the date of the order.' };
  if (expected && expected < orderDate) {
    return { 'po-expected': 'The expected delivery date cannot be before the order date.' };
  }
  return {};
}

/** Checks every fuel line and puts each problem on the field that holds it. */
export function checkOrderFuel(
  lines: readonly OrderLineInput[],
  unitOf?: (productId: string) => 'LITRES' | 'KILOGRAMS' | undefined,
): Errors {
  if (lines.length === 0) return { 'po-add-line': 'Add at least one fuel to the order.' };
  const errors: Errors = {};
  lines.forEach((line, index) => {
    const checked = checkOrderLines([line], unitOf);
    if (checked.ok) return;
    const field = !line.productId ? 'product' : /price/i.test(checked.message) ? 'price' : 'litres';
    const prefix = lines.length > 1 ? `Fuel ${index + 1}: ` : '';
    errors[`po-${field}-${index}`] = `${prefix}${checked.message}`;
  });
  return errors;
}
