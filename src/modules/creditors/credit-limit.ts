import { ExactDecimal } from '../../platform/domain/primitives';

/**
 * How much of a supplier's credit limit is used. A supplier with no limit is simply not judged.
 * Used from 80% of the limit counts as "near"; above the limit is "over".
 */
export type CreditLimitStatus = 'none' | 'ok' | 'near' | 'over';

export const NEAR_LIMIT_SHARE = '0.8';

export type CreditLimitPosition = Readonly<{
  status: CreditLimitStatus;
  limit: string | null;
  owed: string;
  /** What can still be bought on credit; zero once the limit is reached or passed. */
  available: string | null;
  /** Whole percent of the limit used, or null with no limit (or a limit of zero). */
  percentUsed: number | null;
}>;

export function creditLimitPosition(owed: string, limit: string | null): CreditLimitPosition {
  const owedValue = new ExactDecimal(owed).value;
  if (limit === null) {
    return { status: 'none', limit: null, owed, available: null, percentUsed: null };
  }
  const limitValue = new ExactDecimal(limit).value;
  const remaining = limitValue.sub(owedValue);
  const status: CreditLimitStatus = owedValue.gt(limitValue)
    ? 'over'
    : owedValue.gte(limitValue.mul(NEAR_LIMIT_SHARE)) && limitValue.gt(0)
      ? 'near'
      : 'ok';
  return {
    status,
    limit,
    owed,
    available: remaining.isNegative() ? '0' : remaining.toFixed(),
    percentUsed: limitValue.gt(0)
      ? Math.min(999, owedValue.div(limitValue).mul(100).toDecimalPlaces(0).toNumber())
      : null,
  };
}
