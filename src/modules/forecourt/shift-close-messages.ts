/** Plain-language reasons a shift cannot be closed. Pure, so the wording can be tested. */

/**
 * The meter was not in place when the shift opened. The usual cause is a nozzle added after the
 * shift started, whose meter then counts as working only from the day it was added.
 */
export function meterNotWorkingForShiftMessage(label: string): string {
  return `the meter for ${label} is not set up as working for this shift. Ask the owner to open Setup, go to the pumps and nozzles, and set the "Meter working since" date for that nozzle to the day the meter was fitted. Then press Close Shift again.`;
}
