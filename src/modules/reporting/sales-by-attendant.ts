import { ExactDecimal } from '../../platform/domain/primitives';

/**
 * Sales by attendant. Pure, so the crediting rule can be swapped without touching queries.
 *
 * A shift is credited to a person only when the authoritative meter segments support the
 * declared attendants and their litres reconcile exactly. Those litres are used to split the
 * shift's sales and accounted amount with an exact-decimal remainder allocation. If the segment
 * attribution is incomplete or disagrees with the declaration, the report preserves the truthful
 * "Shared shift" state instead of inventing a person-level split.
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
  authoritativeSegments?: readonly AuthoritativeAttendantSegment[] | null;
  /** Internal count used when one source shift expands to one row per attendant. */
  shiftCount?: number;
}>;

export type AuthoritativeAttendantSegment = Readonly<{
  attendantId: string | null;
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
    group.shifts += shift.shiftCount ?? 1;
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

function allocateMoneyByLitres(total: string, weights: readonly ExactDecimal[]): ExactDecimal[] {
  const amount = new ExactDecimal(total);
  const totalWeight = weights.reduce((sum, weight) => sum.add(weight), new ExactDecimal('0'));
  if (totalWeight.value.isZero()) return weights.map(() => new ExactDecimal('0.0000'));

  const allocated: ExactDecimal[] = [];
  let used = new ExactDecimal('0.0000');
  weights.forEach((weight, index) => {
    if (index === weights.length - 1) {
      allocated.push(amount.subtract(used).quantize({ name: 'Money', precision: 20, scale: 4 }));
      return;
    }
    const share = new ExactDecimal(
      amount.value.mul(weight.value).div(totalWeight.value).toFixed(),
    ).quantize({ name: 'Money', precision: 20, scale: 4 });
    allocated.push(share);
    used = used.add(share);
  });
  return allocated;
}

function authoritativeShiftRows(shift: AttendantShiftSale): AttendantShiftSale[] | null {
  const segments = shift.authoritativeSegments;
  if (!segments?.length || segments.some((segment) => !segment.attendantId)) return null;

  const totalLitres = segments.reduce(
    (sum, segment) => sum.add(new ExactDecimal(segment.litres)),
    new ExactDecimal('0'),
  );
  if (!totalLitres.equals(new ExactDecimal(shift.litres)) || totalLitres.value.isZero())
    return null;

  const declared = new Map(shift.attendants.map((attendant) => [attendant.id, attendant]));
  const attributedIds = new Set(segments.map((segment) => segment.attendantId!));
  if (
    declared.size === 0 ||
    declared.size !== attributedIds.size ||
    [...declared.keys()].some((id) => !attributedIds.has(id))
  ) {
    return null;
  }

  const weights = segments.map((segment) => new ExactDecimal(segment.litres));
  const sales = allocateMoneyByLitres(shift.sales, weights);
  const accounted = allocateMoneyByLitres(shift.accounted, weights);
  const byAttendant = new Map<
    string,
    {
      attendant: { id: string; name: string };
      litres: ExactDecimal;
      sales: ExactDecimal;
      accounted: ExactDecimal;
    }
  >();
  segments.forEach((segment, index) => {
    const attendant = declared.get(segment.attendantId!);
    if (!attendant) return;
    const current = byAttendant.get(attendant.id) ?? {
      attendant,
      litres: new ExactDecimal('0'),
      sales: new ExactDecimal('0'),
      accounted: new ExactDecimal('0'),
    };
    current.litres = current.litres.add(new ExactDecimal(segment.litres));
    current.sales = current.sales.add(sales[index]!);
    current.accounted = current.accounted.add(accounted[index]!);
    byAttendant.set(attendant.id, current);
  });

  return [...byAttendant.values()].map((row) => ({
    stationName: shift.stationName,
    attendants: [row.attendant],
    sales: row.sales.toString(),
    accounted: row.accounted.toString(),
    litres: row.litres.toString(),
    shiftCount: 1,
  }));
}

/** Uses authoritative segment attribution when it reconciles; otherwise keeps the shared label. */
export function creditSalesByAuthoritativeSegments(
  shifts: readonly AttendantShiftSale[],
): AttendantSalesRow[] {
  const expanded = shifts.flatMap((shift) => authoritativeShiftRows(shift) ?? [shift]);
  return creditSalesToAttendants(expanded);
}
