/** Plain-language reasons a shift cannot be closed. Pure, so the wording can be tested. */

/**
 * The meter was not in place when the shift opened. The usual cause is a nozzle added after the
 * shift started, whose meter then counts as working only from the day it was added.
 */
export function meterNotWorkingForShiftMessage(labels: string | readonly string[]): string {
  const list = typeof labels === 'string' ? [labels] : labels;
  if (list.length <= 1) {
    return `the meter for ${list[0] ?? 'one of the pumps'} is not set up as working for this shift. Ask the owner to open Setup, go to the pumps & nozzles, and set the "Meter working since" date for that nozzle to the day the meter was fitted. Then press Close Shift again.`;
  }
  const names = `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
  return `the meters for ${names} are not set up as working for this shift. Ask the owner to open Setup, go to the pumps & nozzles, and set the "Meter working since" date for each of those nozzles to the day its meter was fitted. Then press Close Shift again.`;
}
