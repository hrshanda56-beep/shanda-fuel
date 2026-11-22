/** The checks behind the "Your company details" guide. Pure, so they are tested alone. Keys are element ids. */

export type Errors = Record<string, string>;

export function checkCompanyName(name: string, email: string): Errors {
  const errors: Errors = {};
  if (!name.trim()) errors['sd-c-name'] = 'Enter the name to print at the top of your documents.';
  const mail = email.trim();
  if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) {
    errors['sd-c-email'] = 'Enter a valid email address, for example name@company.com.';
  }
  return errors;
}

export function checkCompanyTax(label: string, rate: string): Errors {
  const errors: Errors = {};
  if (!label.trim()) errors['sd-c-taxlabel'] = 'Name your tax, for example VAT.';
  const value = rate.trim().replace(/,/g, '');
  if (value) {
    const number = Number(value);
    if (!/^\d+(?:\.\d+)?$/.test(value) || number > 100) {
      errors['sd-c-rate'] = 'Enter a percentage between 0 and 100, for example 15.';
    }
  }
  return errors;
}

export function checkCompanyNumbers(
  quotation: string,
  invoice: string,
  receipt: string,
  validDays: string,
  dueDays: string,
): Errors {
  const errors: Errors = {};
  if (!quotation.trim()) errors['sd-c-qt'] = 'Enter the letters quotation numbers start with.';
  if (!invoice.trim()) errors['sd-c-inv'] = 'Enter the letters invoice numbers start with.';
  if (!receipt.trim()) errors['sd-c-rc'] = 'Enter the letters receipt numbers start with.';
  if (!/^\d{1,3}$/.test(validDays.trim()))
    errors['sd-c-valid'] = 'Enter a whole number of days, for example 30.';
  if (!/^\d{1,3}$/.test(dueDays.trim()))
    errors['sd-c-due'] = 'Enter a whole number of days, for example 30.';
  return errors;
}
