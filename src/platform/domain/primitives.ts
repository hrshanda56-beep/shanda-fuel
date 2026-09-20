import Decimal from 'decimal.js';

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

type Brand<T, Name extends string> = T & { readonly __brand: Name };

export type TenantId = Brand<string, 'TenantId'>;
export type LegalEntityId = Brand<string, 'LegalEntityId'>;
export type StationId = Brand<string, 'StationId'>;
export type UserId = Brand<string, 'UserId'>;
export type ActorId = Brand<string, 'ActorId'>;
export type MembershipId = Brand<string, 'MembershipId'>;
export type BusinessDate = Brand<string, 'BusinessDate'>;
export type Version = Brand<number, 'Version'>;
export type IdempotencyKey = Brand<string, 'IdempotencyKey'>;
export type HumanReference = Brand<string, 'HumanReference'>;

export type CurrencyCode = 'USD' | (string & { readonly __currencyCode: unique symbol });

export class ExactDecimal {
  readonly value: Decimal;

  constructor(value: string) {
    if (typeof value !== 'string') throw new Error('Decimal value must be a string');
    if (value.trim() === '') throw new Error('Decimal value cannot be empty');
    const parsed = new Decimal(value);
    if (!parsed.isFinite()) throw new Error('Decimal value must be finite');
    this.value = parsed;
  }

  add(other: ExactDecimal): ExactDecimal {
    return new ExactDecimal(this.value.add(other.value).toFixed());
  }

  subtract(other: ExactDecimal): ExactDecimal {
    return new ExactDecimal(this.value.sub(other.value).toFixed());
  }

  multiply(other: ExactDecimal): ExactDecimal {
    return new ExactDecimal(this.value.mul(other.value).toFixed());
  }

  equals(other: ExactDecimal): boolean {
    return this.value.eq(other.value);
  }

  toString(): string {
    return this.value.toFixed();
  }
}

export type Litres = ExactDecimal;
export type UnitPrice = ExactDecimal;
export type WeightedAverageCost = ExactDecimal;

export type Money = {
  amount: ExactDecimal;
  currency: CurrencyCode;
};

export function money(amount: string, currency: CurrencyCode = 'USD'): Money {
  return { amount: new ExactDecimal(amount), currency };
}

export function litres(value: string): Litres {
  return new ExactDecimal(value);
}

export function businessDate(value: string): BusinessDate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('BusinessDate must use YYYY-MM-DD');
  return value as BusinessDate;
}
