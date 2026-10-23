import { DECIMAL_POLICIES, ExactDecimal } from '../../platform/domain/primitives';
import { staffBenefitUse, type StaffBenefitLine, type StaffBenefitUse } from './staff-benefit';

export type StaffBenefitAccountFact = Readonly<{
  accountId: string;
  customerId: string;
  customerName: string;
  accountReference: string;
  staffName: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
  /** The monthly USD limit (the account's credit limit). */
  limit: string | null;
  /** The station business date for the account's company, or null when no station timezone is known. */
  today: string | null;
}>;

export type StaffBenefitRow = Readonly<{
  accountId: string;
  customerId: string;
  customerName: string;
  accountReference: string;
  staffName: string;
  status: StaffBenefitAccountFact['status'];
  limit: string | null;
  /** Null when the month cannot be worked out (no limit, or no station timezone on file). */
  use: StaffBenefitUse | null;
  /** What is owed on the account in total (statement balance), exact. */
  balance: string;
}>;

const ZERO = new ExactDecimal('0');

export function buildStaffBenefitRows(
  accounts: readonly StaffBenefitAccountFact[],
  linesByAccount: ReadonlyMap<string, readonly StaffBenefitLine[]>,
): StaffBenefitRow[] {
  return accounts.map((account) => {
    const lines = linesByAccount.get(account.accountId) ?? [];
    const balance = lines.reduce(
      (sum, line) =>
        line.direction === 'INCREASE'
          ? sum.add(new ExactDecimal(line.amount))
          : sum.subtract(new ExactDecimal(line.amount)),
      ZERO,
    );
    return {
      accountId: account.accountId,
      customerId: account.customerId,
      customerName: account.customerName,
      accountReference: account.accountReference,
      staffName: account.staffName,
      status: account.status,
      limit: account.limit,
      use:
        account.limit && account.today
          ? staffBenefitUse(account.limit, lines, account.today)
          : null,
      balance: balance.quantize(DECIMAL_POLICIES.money).value.toFixed(DECIMAL_POLICIES.money.scale),
    };
  });
}
