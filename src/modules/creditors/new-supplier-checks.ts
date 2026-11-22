/** The checks behind the "Add supplier" guide. Pure, so they are tested alone. Keys are element ids. */

export type Errors = Record<string, string>;

export function checkSupplierName(code: string, legalName: string): Errors {
  const errors: Errors = {};
  if (!legalName.trim()) errors['supplier-legal-name'] = 'Enter the supplier’s legal name.';
  if (!code.trim())
    errors['supplier-code'] = 'Enter a short code for this supplier, for example PUMA.';
  return errors;
}

export function checkSupplierContact(email: string): Errors {
  const value = email.trim();
  if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return {
      'supplier-contact-email': 'Enter a valid email address, for example name@company.com.',
    };
  }
  return {};
}

export function checkSupplierCredit(creditDays: string, creditLimit: string): Errors {
  const errors: Errors = {};
  const days = creditDays.trim();
  if (days && !/^\d{1,3}$/.test(days)) {
    errors['supplier-credit-days'] =
      'Enter the usual credit period as a whole number of days, for example 30.';
  }
  const limit = creditLimit.trim().replace(/,/g, '');
  if (limit && !/^\d+(?:\.\d{1,4})?$/.test(limit)) {
    errors['supplier-create-credit-limit'] =
      'Enter the credit limit as an amount, for example 5000.';
  }
  return errors;
}
