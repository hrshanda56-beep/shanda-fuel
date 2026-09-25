import { AppError } from '../../platform/errors';
import { ExactDecimal, litres } from '../../platform/domain/primitives';

export type SegmentSaleCandidate = Readonly<{
  id: string;
  state: string;
  openingReading: string;
  closingReading: string;
  litres: string;
  businessDate: string;
  meterInstallationId: string;
  segmentStartAt: Date | string;
  segmentEndAt: Date | string;
}>;

export type SegmentSaleReading = Readonly<{
  openingReading: string;
  closingReading: string;
  litresSold: string;
}>;

export type SegmentSaleAllocation = Readonly<{
  segmentId: string;
  litres: string;
  businessDate: string;
  segmentStartAt: Date | string;
  segmentEndAt: Date | string;
}>;

function decimal(value: string): ExactDecimal {
  return new ExactDecimal(value);
}

function same(a: string, b: string): boolean {
  return decimal(a).equals(decimal(b));
}

/**
 * Derives only an exact, contiguous allocation already evidenced by A3.
 * No quantity is inferred or proportionally distributed by this function.
 * A3 stores non-overlapping operational intervals rather than requiring
 * adjacent timestamps: handover, delivery, and price-change boundaries may be
 * captured later than the preceding segment closes. In those controlled gaps,
 * the repeated exact meter reading proves that no litre quantity is missing;
 * only overlap is invalid. A controlled meter replacement may change
 * installations between adjacent segments; reading continuity, rather than
 * installation identity, is the authoritative cross-installation invariant.
 */
export function deriveSegmentSaleAllocations(
  reading: SegmentSaleReading,
  candidates: readonly SegmentSaleCandidate[],
): readonly SegmentSaleAllocation[] {
  if (candidates.length === 0) {
    throw new AppError(
      'CONFLICT',
      'The reconciliation reading has no matching sealed meter-segment evidence',
    );
  }

  const ordered = [...candidates].sort((left, right) => {
    const startDifference =
      Date.parse(String(left.segmentStartAt)) - Date.parse(String(right.segmentStartAt));
    return startDifference || left.id.localeCompare(right.id);
  });

  for (const candidate of ordered) {
    if (candidate.state !== 'SEALED') {
      throw new AppError(
        'CONFLICT',
        'All meter segments used for canonical sale posting must be sealed',
      );
    }
    const startAt = Date.parse(String(candidate.segmentStartAt));
    const endAt = Date.parse(String(candidate.segmentEndAt));
    if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || startAt >= endAt) {
      throw new AppError('INVARIANT_VIOLATION', 'Meter-segment chronology is invalid');
    }
    if (decimal(candidate.litres).value.isNegative()) {
      throw new AppError('CONFLICT', 'A negative-litre segment cannot be canonical sale evidence');
    }
  }

  const first = ordered[0]!;
  const last = ordered[ordered.length - 1]!;
  if (!same(first.openingReading, reading.openingReading)) {
    throw new AppError(
      'CONFLICT',
      'The first sealed meter segment does not match the reconciliation opening reading',
    );
  }
  if (!same(last.closingReading, reading.closingReading)) {
    throw new AppError(
      'CONFLICT',
      'The last sealed meter segment does not match the reconciliation closing reading',
    );
  }

  let allocated = decimal('0');
  for (let index = 0; index < ordered.length; index += 1) {
    const current = ordered[index]!;
    allocated = allocated.add(litres(current.litres));
    const next = ordered[index + 1];
    if (next && !same(current.closingReading, next.openingReading)) {
      throw new AppError(
        'CONFLICT',
        'Matching sealed meter segments are not contiguous at litre precision',
      );
    }
    if (
      next &&
      Date.parse(String(current.segmentEndAt)) > Date.parse(String(next.segmentStartAt))
    ) {
      throw new AppError('CONFLICT', 'Matching sealed meter segments overlap in time');
    }
  }

  if (!same(allocated.toString(), reading.litresSold)) {
    throw new AppError(
      'CONFLICT',
      'Sealed meter-segment litres do not exactly reconcile to the reading litres',
    );
  }

  return ordered.map((candidate) => ({
    segmentId: candidate.id,
    litres: litres(candidate.litres).toString(),
    businessDate: candidate.businessDate,
    segmentStartAt: candidate.segmentStartAt,
    segmentEndAt: candidate.segmentEndAt,
  }));
}
