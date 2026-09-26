import { describe, expect, it } from 'vitest';
import { AppError } from '../../platform/errors';
import { deriveSegmentSaleAllocations, type SegmentSaleCandidate } from './segment-sale-chronology';

const candidate = (
  id: string,
  openingReading: string,
  closingReading: string,
  litres: string,
  start: string,
  end: string,
  businessDate = '2026-09-22',
  meterInstallationId = 'installation-1',
  state = 'SEALED',
): SegmentSaleCandidate => ({
  id,
  state,
  openingReading,
  closingReading,
  litres,
  businessDate,
  meterInstallationId,
  segmentStartAt: start,
  segmentEndAt: end,
});

describe('deriveSegmentSaleAllocations', () => {
  it('maps one sealed segment without changing its exact litres', () => {
    expect(
      deriveSegmentSaleAllocations(
        { openingReading: '100.000', closingReading: '150.000', litresSold: '50.000' },
        [
          candidate(
            'segment-1',
            '100.000',
            '150.000',
            '50.000',
            '2026-09-22T14:00:00Z',
            '2026-09-22T15:00:00Z',
          ),
        ],
      ),
    ).toMatchObject([{ segmentId: 'segment-1', litres: '50' }]);
  });

  it('maps reading-contiguous delivery-separated segments across an A3-controlled temporal gap', () => {
    expect(
      deriveSegmentSaleAllocations(
        { openingReading: '100.000', closingReading: '250.000', litresSold: '150.000' },
        [
          candidate(
            'segment-b',
            '175.000',
            '250.000',
            '75.000',
            '2026-09-22T17:00:00Z',
            '2026-09-22T18:00:00Z',
          ),
          candidate(
            'segment-a',
            '100.000',
            '175.000',
            '75.000',
            '2026-09-22T15:00:00Z',
            '2026-09-22T16:00:00Z',
          ),
        ],
      ).map((allocation) => allocation.segmentId),
    ).toEqual(['segment-a', 'segment-b']);
  });

  it('preserves zero-litre sealed segments in the bridge allocation without sale quantity', () => {
    const allocations = deriveSegmentSaleAllocations(
      { openingReading: '100.000', closingReading: '150.000', litresSold: '50.000' },
      [
        candidate(
          'segment-zero',
          '100.000',
          '100.000',
          '0.000',
          '2026-09-22T14:00:00Z',
          '2026-09-22T14:30:00Z',
        ),
        candidate(
          'segment-positive',
          '100.000',
          '150.000',
          '50.000',
          '2026-09-22T14:30:00Z',
          '2026-09-22T15:00:00Z',
        ),
      ],
    );
    expect(allocations.map((allocation) => [allocation.segmentId, allocation.litres])).toEqual([
      ['segment-zero', '0'],
      ['segment-positive', '50'],
    ]);
  });

  it('allows a controlled meter replacement to preserve reading continuity across installations', () => {
    expect(
      deriveSegmentSaleAllocations(
        { openingReading: '100.000', closingReading: '200.000', litresSold: '100.000' },
        [
          candidate(
            'segment-old-installation',
            '100.000',
            '150.000',
            '50.000',
            '2026-09-22T14:00:00Z',
            '2026-09-22T15:00:00Z',
            '2026-09-22',
            'installation-old',
          ),
          candidate(
            'segment-new-installation',
            '150.000',
            '200.000',
            '50.000',
            '2026-09-22T15:00:00Z',
            '2026-09-22T16:00:00Z',
            '2026-09-22',
            'installation-new',
          ),
        ],
      ).map((allocation) => allocation.segmentId),
    ).toEqual(['segment-old-installation', 'segment-new-installation']);
  });

  it('rejects a missing or unsealed segment instead of inventing allocation', () => {
    expect(() =>
      deriveSegmentSaleAllocations(
        { openingReading: '100.000', closingReading: '150.000', litresSold: '50.000' },
        [],
      ),
    ).toThrow(AppError);
    expect(() =>
      deriveSegmentSaleAllocations(
        { openingReading: '100.000', closingReading: '150.000', litresSold: '50.000' },
        [
          candidate(
            'segment-1',
            '100.000',
            '150.000',
            '50.000',
            '2026-09-22T14:00:00Z',
            '2026-09-22T15:00:00Z',
            '2026-09-22',
            'installation-1',
            'OPEN',
          ),
        ],
      ),
    ).toThrow('must be sealed');
  });

  it('rejects negative-litre segments instead of treating them as sale quantity', () => {
    expect(() =>
      deriveSegmentSaleAllocations(
        { openingReading: '150.000', closingReading: '100.000', litresSold: '-50.000' },
        [
          candidate(
            'segment-negative',
            '150.000',
            '100.000',
            '-50.000',
            '2026-09-22T14:00:00Z',
            '2026-09-22T15:00:00Z',
          ),
        ],
      ),
    ).toThrow('negative-litre');
  });

  it('rejects an exact-litre total mismatch', () => {
    expect(() =>
      deriveSegmentSaleAllocations(
        { openingReading: '100.000', closingReading: '250.000', litresSold: '149.000' },
        [
          candidate(
            'segment-a',
            '100.000',
            '175.000',
            '75.000',
            '2026-09-22T15:00:00Z',
            '2026-09-22T16:00:00Z',
          ),
          candidate(
            'segment-b',
            '175.000',
            '250.000',
            '75.000',
            '2026-09-22T16:00:00Z',
            '2026-09-22T17:00:00Z',
          ),
        ],
      ),
    ).toThrow('do not exactly reconcile');
  });

  it('rejects a first opening-reading mismatch', () => {
    expect(() =>
      deriveSegmentSaleAllocations(
        { openingReading: '99.000', closingReading: '150.000', litresSold: '50.000' },
        [
          candidate(
            'segment-1',
            '100.000',
            '150.000',
            '50.000',
            '2026-09-22T14:00:00Z',
            '2026-09-22T15:00:00Z',
          ),
        ],
      ),
    ).toThrow('first sealed meter segment');
  });

  it('rejects a last closing-reading mismatch', () => {
    expect(() =>
      deriveSegmentSaleAllocations(
        { openingReading: '100.000', closingReading: '151.000', litresSold: '50.000' },
        [
          candidate(
            'segment-1',
            '100.000',
            '150.000',
            '50.000',
            '2026-09-22T14:00:00Z',
            '2026-09-22T15:00:00Z',
          ),
        ],
      ),
    ).toThrow('last sealed meter segment');
  });

  it('rejects overlapping segment chronology', () => {
    expect(() =>
      deriveSegmentSaleAllocations(
        { openingReading: '100.000', closingReading: '200.000', litresSold: '100.000' },
        [
          candidate(
            'segment-a',
            '100.000',
            '150.000',
            '50.000',
            '2026-09-22T14:00:00Z',
            '2026-09-22T15:30:00Z',
          ),
          candidate(
            'segment-b',
            '150.000',
            '200.000',
            '50.000',
            '2026-09-22T15:00:00Z',
            '2026-09-22T16:00:00Z',
          ),
        ],
      ),
    ).toThrow('overlap');
  });

  it('rejects invalid segment timestamps', () => {
    expect(() =>
      deriveSegmentSaleAllocations(
        { openingReading: '100.000', closingReading: '150.000', litresSold: '50.000' },
        [
          candidate(
            'segment-1',
            '100.000',
            '150.000',
            '50.000',
            'not-a-time',
            '2026-09-22T15:00:00Z',
          ),
        ],
      ),
    ).toThrow('chronology is invalid');
  });

  it('rejects a zero-duration segment even when its litres are zero', () => {
    expect(() =>
      deriveSegmentSaleAllocations(
        { openingReading: '100.000', closingReading: '100.000', litresSold: '0.000' },
        [
          candidate(
            'segment-zero-duration',
            '100.000',
            '100.000',
            '0.000',
            '2026-09-22T14:00:00Z',
            '2026-09-22T14:00:00Z',
          ),
        ],
      ),
    ).toThrow('chronology is invalid');
  });

  it('rejects a litre-reading gap between otherwise chronological segments', () => {
    expect(() =>
      deriveSegmentSaleAllocations(
        { openingReading: '100.000', closingReading: '250.000', litresSold: '145.000' },
        [
          candidate(
            'segment-a',
            '100.000',
            '175.000',
            '75.000',
            '2026-09-22T15:00:00Z',
            '2026-09-22T16:00:00Z',
          ),
          candidate(
            'segment-b',
            '180.000',
            '250.000',
            '70.000',
            '2026-09-22T16:00:00Z',
            '2026-09-22T17:00:00Z',
          ),
        ],
      ),
    ).toThrow('not contiguous');
  });
});
