import { StatusBadge } from '@/design-system/primitives';
import { formatTileMoney } from '@/modules/reporting/format';
import type { StaffBenefitUse } from '../staff-benefit';

/** The clear label for a staff fuel benefit account, so it is never mistaken for a customer. */
export function StaffBenefitLabel() {
  return <StatusBadge tone="informational">Staff fuel benefit</StatusBadge>;
}

/** This month's use against the monthly limit, in plain words. `use` is null when unknown. */
export function StaffBenefitUseSummary({ use }: { use: StaffBenefitUse | null }) {
  if (!use) {
    return (
      <p className="muted">
        This month’s use is not available until the limit and the station’s timezone are on file.
      </p>
    );
  }
  return (
    <p>
      Used {formatTileMoney(use.spent)} of {formatTileMoney(use.limit)} this month.{' '}
      {use.over ? (
        <StatusBadge tone="critical">Over the monthly limit</StatusBadge>
      ) : (
        <span>{formatTileMoney(use.remaining)} left.</span>
      )}
    </p>
  );
}
