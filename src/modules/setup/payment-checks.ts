/** The checks behind the payment setup guides. Pure, so they are tested alone. Keys are element ids. */

export type Errors = Record<string, string>;

const PROVIDER_TYPES = ['CARD_ACQUIRER', 'POS', 'MOBILE_MONEY', 'OTHER_ELECTRONIC'];

export function checkProviderWho(name: string, type: string): Errors {
  const errors: Errors = {};
  if (!name.trim()) errors['provider-name'] = 'Enter the provider name.';
  if (!PROVIDER_TYPES.includes(type)) errors['provider-type'] = 'Choose the provider type.';
  return errors;
}

export function checkProviderCode(code: string): Errors {
  return code.trim() ? {} : { 'provider-code': 'Enter a short code, for example ECOCASH.' };
}

export function checkAccountWhere(stationId: string, providerId: string): Errors {
  const errors: Errors = {};
  if (!stationId) errors['account-station'] = 'Choose a station.';
  if (!providerId) errors['account-provider'] = 'Choose a provider.';
  return errors;
}

export function checkAccountDetails(name: string, reference: string, currency: string): Errors {
  const errors: Errors = {};
  if (!name.trim()) errors['account-name'] = 'Enter a name for this account.';
  if (!reference.trim()) errors['account-reference'] = 'Enter the merchant or terminal reference.';
  if (!/^[A-Za-z]{3}$/.test(currency.trim())) {
    errors['account-currency'] = 'Enter a three-letter currency code.';
  }
  return errors;
}

export function checkAccountCharges(percent: string, fixed: string): Errors {
  const errors: Errors = {};
  const pct = percent.trim();
  if (pct && !(/^\d+(?:\.\d{1,4})?$/.test(pct) && Number(pct) <= 100)) {
    errors['account-fee-percent'] =
      'Enter a percentage from 0 to 100, for example 1.5, or leave it empty.';
  }
  const flat = fixed.trim();
  if (flat && !/^\d+(?:\.\d{1,4})?$/.test(flat)) {
    errors['account-fee-fixed'] = 'Enter an amount, for example 0.10, or leave it empty.';
  }
  return errors;
}

export function checkBankCompany(companyId: string): Errors {
  return companyId ? {} : { 'bank-company': 'Choose the company this account belongs to.' };
}

export function checkBankDetails(name: string, bankName: string, masked: string): Errors {
  const errors: Errors = {};
  if (!name.trim()) errors['bank-account-name'] = 'Enter an account name.';
  if (!bankName.trim()) errors['bank-name'] = 'Enter the bank name.';
  if (!masked.trim()) errors['bank-reference-masked'] = 'Enter the masked account reference only.';
  return errors;
}
