import { ExactDecimal } from '../../platform/domain/primitives';

/**
 * Sales by attendant. Pure, so the crediting rule can be swapped without touching queries.
 *
 * AWAITING OWNER CONFIRMATION (docs/v1-owner-decisions.md item 1, recommended option C): a
 * shift is credited to a person only when exactly one attendant worked it. A shift with two or
 * more attendants is shown as "Shared shift" and is not split between people. A shift with no
 * attendant recorded is shown separately and never credited to anyone.
 */

export const SHARED_SHIFT_LABEL = 'Shared shift';
export const NO_ATTENDANT_LABEL = 'No attendant recorded';

export type AttendantShiftSale = Readonly<{
  stationName: string;
  attendants: readonly { id: string; name: string }[];
  /** Exact decimal strings. */
  sales: string;
  accounted: string;
  litres: string;
}>;

export type AttendantCredit = Readonly<{
  /** Null for shared or unassigned shifts. */
  attendantId: string | null;
  label: string;
}>;

/** Decides who a shift is credited to. Replace this to change the owner rule. */
export type AttendantCreditRule = (shift: AttendantShiftSale) => AttendantCredit;

export const soleAttendantOnly: AttendantCreditRule = (shift) => {
  if (shift.attendants.length === 0) return { attendantId: null, label: NO_ATTENDANT_LABEL };
  if (shift.attendants.length === 1) {
    const [only] = shift.attendants;
    return { attendantId: only!.id, label: only!.name };
  }
  return { attendantId: null, label: SHARED_SHIFT_LABEL };
};

export type AttendantSalesRow = Readonly<{
  stationName: string;
  attendantId: string | null;
  label: string;
  shifts: number;
  litres: string;
  sales: string;
  accounted: string;
}>;

export function creditSalesToAttendants(
  shifts: readonly AttendantShiftSale[],
  rule: AttendantCreditRule = soleAttendantOnly,
): AttendantSalesRow[] {
  const zero = () => new ExactDecimal('0');
  const groups = new Map<
    string,
    {
      stationName: string;
      credit: AttendantCredit;
      shifts: number;
      litres: ExactDecimal;
      sales: ExactDecimal;
      accounted: ExactDecimal;
    }
  >();
  for (const shift of shifts) {
    const credit = rule(shift);
    const key = `${shift.stationName}\u0000${credit.attendantId ?? credit.label}`;
    const group = groups.get(key) ?? {
      stationName: shift.stationName,
      credit,
      shifts: 0,
      litres: zero(),
      sales: zero(),
      accounted: zero(),
    };
    group.shifts += 1;
    group.litres = group.litres.add(new ExactDecimal(shift.litres));
    group.sales = group.sales.add(new ExactDecimal(shift.sales));
    group.accounted = group.accounted.add(new ExactDecimal(shift.accounted));
    groups.set(key, group);
  }
  const rank = (row: { attendantId: string | null; label: string }) =>
    row.attendantId ? 0 : row.label === SHARED_SHIFT_LABEL ? 1 : 2;
  return [...groups.values()]
    .map((group) => ({
      stationName: group.stationName,
      attendantId: group.credit.attendantId,
      label: group.credit.label,
      shifts: group.shifts,
      litres: group.litres.toString(),
      sales: group.sales.toString(),
      accounted: group.accounted.toString(),
    }))
    .sort(
      (a, b) =>
        a.stationName.localeCompare(b.stationName) ||
        rank(a) - rank(b) ||
        a.label.localeCompare(b.label),
    );
}
