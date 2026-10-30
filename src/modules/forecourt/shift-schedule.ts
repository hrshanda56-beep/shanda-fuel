/** How long before its scheduled start a shift may be opened, so a handover can overlap. */
export const SHIFT_EARLY_START_MINUTES = 30;

/** The earliest moment a shift that is scheduled to start at `plannedStartAt` may be opened. */
export function shiftOpensAt(plannedStartAt: Date | string): Date {
  return new Date(new Date(plannedStartAt).getTime() - SHIFT_EARLY_START_MINUTES * 60_000);
}
