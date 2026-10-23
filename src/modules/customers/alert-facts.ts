/**
 * Customer facts for alerts: who is overdue (oldest unpaid charge first, the ageing rule) and who
 * is over their limit. Pure and exact; the SQL that feeds it is in
 * `approvals/extra-alert-facts.ts`. Dates are station business dates.
 */
import { DECIMAL_POLICIES, ExactDecimal } from '../../platform/domain/primitives';
import { computeAccountAgeing, type AgeingLedgerLine } from './ageing';
import { staffBenefitUse, type StaffBenefitLine } from './staff-benefit';

export type CustomerAlertAccount = Readonly<{
  accountId: string;
  customerId: string;
  customerName: string;
  /** Credit limit; for a staff benefit account this is the monthly limit. */
  limit: string | null;
  isStaffBenefit: boolean;
  staffName: string | null;
  lines: readonly (AgeingLedgerLine & { entryType: string; reversalOfEntryId?: string | null })[];
}>;

export type CustomerOverdueFact = Readonly<{
  accountId: string;
  customerId: string;
  customerName: string;
  /** Business date of the oldest charge that is still unpaid. */
  oldestUnpaidDate: string;
  /** Everything still unpaid. */
  owed: string;
}>;

export type CustomerOverLimitFact = Readonly<{
  accountId: string;
  customerId: string;
  customerName: string;
  kind: 'CREDIT' | 'STAFF_BENEFIT_MONTH';
  /** What is owed (credit) or taken this month (staff benefit). */
  amount: string;
  limit: string;
}>;

const money = (value: ExactDecimal) =>
  value.quantize(DECIMAL_POLICIES.money).value.toFixed(DECIMAL_POLICIES.money.scale);

export function buildCustomerAlertFacts(
  accounts: readonly CustomerAlertAccount[],
  today: string,
): { overdue: CustomerOverdueFact[]; overLimit: CustomerOverLimitFact[] } {
  const overdue: CustomerOverdueFact[] = [];
  const overLimit: CustomerOverLimitFact[] = [];
  for (const account of accounts) {
    const ageing = computeAccountAgeing(account.lines, { asAt: today });
    if (ageing.oldestOpenChargeDate && new ExactDecimal(ageing.totalOwed).value.gt(0)) {
      overdue.push({
        accountId: account.accountId,
        customerId: account.customerId,
        customerName:
          account.isStaffBenefit && account.staffName ? account.staffName : account.customerName,
        oldestUnpaidDate: ageing.oldestOpenChargeDate,
        owed: ageing.totalOwed,
      });
    }
    if (!account.limit || !new ExactDecimal(account.limit).value.gt(0)) continue;
    const name =
      account.isStaffBenefit && account.staffName ? account.staffName : account.customerName;
    const balance = account.lines.reduce(
      (sum, line) =>
        line.direction === 'INCREASE'
          ? sum.add(new ExactDecimal(line.amount))
          : sum.subtract(new ExactDecimal(line.amount)),
      new ExactDecimal('0'),
    );
    if (account.isStaffBenefit) {
      const use = staffBenefitUse(
        account.limit,
        account.lines as readonly StaffBenefitLine[],
        today,
      );
      if (use.over) {
        overLimit.push({
          accountId: account.accountId,
          customerId: account.customerId,
          customerName: name,
          kind: 'STAFF_BENEFIT_MONTH',
          amount: use.spent,
          limit: use.limit,
        });
        continue;
      }
    }
    if (balance.value.gt(new ExactDecimal(account.limit).value)) {
      overLimit.push({
        accountId: account.accountId,
        customerId: account.customerId,
        customerName: name,
        kind: 'CREDIT',
        amount: money(balance),
        limit: money(new ExactDecimal(account.limit)),
      });
    }
  }
  const byName = (a: { customerName: string; accountId: string }, b: typeof a) =>
    a.customerName.localeCompare(b.customerName) || a.accountId.localeCompare(b.accountId);
  return { overdue: overdue.sort(byName), overLimit: overLimit.sort(byName) };
}
