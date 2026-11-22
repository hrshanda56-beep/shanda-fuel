/**
 * Rules for the opening-readings wizard: one pump meter per screen, then a check screen.
 * Kept apart from the screens so they can be tested directly.
 */

export type OpeningPump = Readonly<{
  nozzleId: string;
  pumpNumber: string;
  nozzleNumber: string;
  productName: string;
  sellingPriceId: string | null;
  /** The last closing reading on record for this meter, if there is one. */
  previousReading: string | null;
}>;

/** Pumps in the order they stand on the forecourt: pump 2 nozzle 1 before pump 10 nozzle 1. */
export function sortPumps<P extends Pick<OpeningPump, 'pumpNumber' | 'nozzleNumber'>>(
  pumps: readonly P[],
): P[] {
  return [...pumps].sort((a, b) =>
    `${a.pumpNumber}.${a.nozzleNumber}`.localeCompare(
      `${b.pumpNumber}.${b.nozzleNumber}`,
      undefined,
      { numeric: true },
    ),
  );
}

/** "Pump 1, nozzle 2" */
export function pumpName(pump: Pick<OpeningPump, 'pumpNumber' | 'nozzleNumber'>): string {
  return `Pump ${pump.pumpNumber}, nozzle ${pump.nozzleNumber}`;
}

/** The reading each pump starts with: the last closing reading on record, or empty. */
export function startingReadings(pumps: readonly OpeningPump[]): Record<string, string> {
  return Object.fromEntries(pumps.map((pump) => [pump.nozzleId, pump.previousReading ?? '']));
}

export type ReadingCheck = { ok: true; value: string } | { ok: false; message: string };

/** A meter reading is a number that is not negative, with at most three decimals. */
export function checkReading(raw: string, pump: Pick<OpeningPump, 'pumpNumber' | 'nozzleNumber'>) {
  const value = raw.trim();
  const which = pumpName(pump).toLowerCase();
  if (!value) return { ok: false, message: `Enter what the meter of ${which} shows.` } as const;
  if (!/^\d+(\.\d{1,3})?$/.test(value)) {
    return {
      ok: false,
      message: 'Use numbers only, for example 12345.5. No minus sign and no letters.',
    } as const;
  }
  return { ok: true, value } as const;
}

/** Pumps whose fuel has no selling price yet. The shift cannot take readings for them. */
export function unpricedPumps<P extends Pick<OpeningPump, 'sellingPriceId'>>(
  pumps: readonly P[],
): P[] {
  return pumps.filter((pump) => !pump.sellingPriceId);
}

/** "Step 2 of 5": one screen per pump, then the check screen. */
export function readingPosition(pumpCount: number, index: number, onReview: boolean) {
  const total = pumpCount + 1;
  return { position: onReview ? total : Math.min(index + 1, pumpCount), total };
}
