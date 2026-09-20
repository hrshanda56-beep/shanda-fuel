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

export type DecimalRounding = 'half-up' | 'half-even' | 'down' | 'up';

export type DecimalPolicy = {
  readonly name: string;
  readonly precision: number;
  readonly scale: number;
};

/** These mirror the Blueprint's PostgreSQL NUMERIC precision/scale direction. */
export const DECIMAL_POLICIES = {
  money: { name: 'Money', precision: 20, scale: 4 },
  litres: { name: 'Litres', precision: 18, scale: 3 },
  unitPrice: { name: 'UnitPrice', precision: 20, scale: 6 },
  weightedAverageCost: { name: 'WeightedAverageCost', precision: 20, scale: 8 },
  intermediate: { name: 'IntermediateDecimal', precision: 24, scale: 8 },
  ratio: { name: 'Ratio', precision: 18, scale: 8 },
} as const satisfies Record<string, DecimalPolicy>;

const roundingModes: Record<DecimalRounding, Decimal.Rounding> = {
  'half-up': Decimal.ROUND_HALF_UP,
  'half-even': Decimal.ROUND_HALF_EVEN,
  down: Decimal.ROUND_DOWN,
  up: Decimal.ROUND_UP,
};

function normalizedParts(value: Decimal): { integerDigits: number; fractionalDigits: number } {
  const normalized = value.toFixed();
  const unsigned = normalized.replace(/^-/, '');
  const [integerPart = '', fractionalPart = ''] = unsigned.split('.');
  const integerDigits = integerPart.replace(/^0+/, '').length;
  return { integerDigits, fractionalDigits: fractionalPart.length };
}

function assertFitsPolicy(value: Decimal, policy: DecimalPolicy): void {
  const { integerDigits, fractionalDigits } = normalizedParts(value);
  const maxIntegerDigits = policy.precision - policy.scale;

  if (fractionalDigits > policy.scale) {
    throw new Error(
      `${policy.name} accepts at most ${policy.scale} fractional digits; received ${fractionalDigits}`,
    );
  }
  if (integerDigits > maxIntegerDigits) {
    throw new Error(
      `${policy.name} accepts at most ${maxIntegerDigits} integer digits; received ${integerDigits}`,
    );
  }
}

export class ExactDecimal {
  readonly value: Decimal;

  constructor(value: string, policy?: DecimalPolicy) {
    if (typeof value !== 'string') throw new Error('Decimal value must be a string');
    if (value.trim() === '') throw new Error('Decimal value cannot be empty');
    const parsed = new Decimal(value);
    if (!parsed.isFinite()) throw new Error('Decimal value must be finite');
    if (policy) assertFitsPolicy(parsed, policy);
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

  /** Explicitly rounds at a named calculation boundary; construction never rounds silently. */
  quantize(policy: DecimalPolicy, rounding: DecimalRounding = 'half-up'): ExactDecimal {
    const rounded = this.value.toDecimalPlaces(policy.scale, roundingModes[rounding]);
    return new ExactDecimal(rounded.toFixed(policy.scale), policy);
  }

  equals(other: ExactDecimal): boolean {
    return this.value.eq(other.value);
  }

  toString(): string {
    return this.value.toFixed();
  }
}

export type MoneyAmount = ExactDecimal & Brand<ExactDecimal, 'MoneyAmount'>;
export type Litres = ExactDecimal & Brand<ExactDecimal, 'Litres'>;
export type UnitPrice = ExactDecimal & Brand<ExactDecimal, 'UnitPrice'>;
export type WeightedAverageCost = ExactDecimal & Brand<ExactDecimal, 'WeightedAverageCost'>;
export type IntermediateDecimal = ExactDecimal & Brand<ExactDecimal, 'IntermediateDecimal'>;
export type Ratio = ExactDecimal & Brand<ExactDecimal, 'Ratio'>;

export type Money = {
  amount: MoneyAmount;
  currency: CurrencyCode;
};

function domainDecimal<T extends ExactDecimal>(value: string, policy: DecimalPolicy): T {
  return new ExactDecimal(value, policy) as T;
}

export function money(amount: string, currency: CurrencyCode = 'USD'): Money {
  return { amount: domainDecimal<MoneyAmount>(amount, DECIMAL_POLICIES.money), currency };
}

export function litres(value: string): Litres {
  return domainDecimal<Litres>(value, DECIMAL_POLICIES.litres);
}

export function unitPrice(value: string): UnitPrice {
  return domainDecimal<UnitPrice>(value, DECIMAL_POLICIES.unitPrice);
}

export function weightedAverageCost(value: string): WeightedAverageCost {
  return domainDecimal<WeightedAverageCost>(value, DECIMAL_POLICIES.weightedAverageCost);
}

export function intermediateDecimal(value: string): IntermediateDecimal {
  return domainDecimal<IntermediateDecimal>(value, DECIMAL_POLICIES.intermediate);
}

export function ratio(value: string): Ratio {
  return domainDecimal<Ratio>(value, DECIMAL_POLICIES.ratio);
}

export function businessDate(value: string): BusinessDate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('BusinessDate must use YYYY-MM-DD');
  return value as BusinessDate;
}
