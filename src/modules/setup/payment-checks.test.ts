import { describe, expect, it } from 'vitest';
import {
  checkAccountCharges,
  checkAccountDetails,
  checkAccountWhere,
  checkBalanceAmount,
  checkBalanceDate,
  checkBalanceStation,
  checkBankCompany,
  checkBankDetails,
  cleanBalance,
  checkProviderCode,
  checkProviderWho,
} from './payment-checks';

describe('payment setup checks', () => {
  it('provider needs a name and a type, then a code', () => {
    expect(checkProviderWho('', '')).toHaveProperty('provider-name');
    expect(checkProviderWho('EcoCash', 'nope')).toHaveProperty('provider-type');
    expect(checkProviderWho('EcoCash', 'MOBILE_MONEY')).toEqual({});
    expect(checkProviderCode(' ')).toHaveProperty('provider-code');
    expect(checkProviderCode('ECOCASH')).toEqual({});
  });

  it('account needs a station, a provider, a name, a reference and a currency', () => {
    expect(checkAccountWhere('', '')).toEqual(
      expect.objectContaining({
        'account-station': expect.any(String),
        'account-provider': expect.any(String),
      }),
    );
    expect(checkAccountDetails('', '', 'USD')).toHaveProperty('account-name');
    expect(checkAccountDetails('A', 'R', 'US')).toHaveProperty('account-currency');
    expect(checkAccountDetails('A', 'R', 'usd')).toEqual({});
  });

  it('charges are optional but must be sensible', () => {
    expect(checkAccountCharges('', '')).toEqual({});
    expect(checkAccountCharges('101', '')).toHaveProperty('account-fee-percent');
    expect(checkAccountCharges('1.5', 'abc')).toHaveProperty('account-fee-fixed');
    expect(checkAccountCharges('1.5', '0.10')).toEqual({});
  });

  it('bank account needs a company and three details', () => {
    expect(checkBankCompany('')).toHaveProperty('bank-company');
    expect(checkBankCompany('c1')).toEqual({});
    expect(checkBankDetails('', '', '')).toEqual(
      expect.objectContaining({
        'bank-account-name': expect.any(String),
        'bank-name': expect.any(String),
        'bank-reference-masked': expect.any(String),
      }),
    );
    expect(checkBankDetails('Main', 'CBZ', '****1234')).toEqual({});
  });

  it('bank balance needs a station, a number and a date', () => {
    expect(checkBalanceStation('')).toHaveProperty('balance-station');
    expect(checkBalanceStation('s1')).toEqual({});
    expect(checkBalanceAmount('')).toHaveProperty('balance-amount');
    expect(checkBalanceAmount('abc')).toHaveProperty('balance-amount');
    expect(checkBalanceAmount('1.23456')).toHaveProperty('balance-amount');
    expect(checkBalanceAmount('1,250.50')).toEqual({});
    expect(checkBalanceAmount('-20')).toEqual({});
    expect(cleanBalance(' 1,250.50 ')).toBe('1250.50');
    expect(checkBalanceDate('')).toHaveProperty('balance-date');
    expect(checkBalanceDate('2026-11-20')).toEqual({});
  });
});
