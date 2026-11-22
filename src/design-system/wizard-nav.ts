/**
 * The pure rules behind `useWizard`, kept apart from React so they can be tested directly.
 *
 * A wizard is at a `step`, and a step that repeats ("pump 2", "payment line 3") also has an
 * `index`. The trail remembers every screen that was left so Back returns to it exactly,
 * including which repeat it was on.
 */

export type WizardPlace<S extends string = string> = { step: S; index: number };

/** Remember the place being left. Returns a new trail; never changes the old one. */
export function pushTrail<S extends string>(
  trail: readonly WizardPlace<S>[],
  leaving: WizardPlace<S>,
): WizardPlace<S>[] {
  return [...trail, leaving];
}

/** The place Back returns to, and the trail without it. `null` previous means "cancel". */
export function popTrail<S extends string>(
  trail: readonly WizardPlace<S>[],
): {
  previous: WizardPlace<S> | null;
  rest: WizardPlace<S>[];
} {
  const previous = trail[trail.length - 1] ?? null;
  return { previous, rest: previous ? trail.slice(0, -1) : [] };
}

/** "Step 2 of 7": never below 1, even for a step that is not in the sequence right now. */
export function stepPosition<S extends string>(sequence: readonly S[], step: S): number {
  return Math.max(1, sequence.indexOf(step) + 1);
}

/** True when going back lands on the last screen (the summary), so "came from summary" ends. */
export function returnsToSummary<S extends string>(
  sequence: readonly S[],
  previous: WizardPlace<S>,
): boolean {
  return previous.step === sequence[sequence.length - 1];
}

/**
 * The next repeat of a repeating step, or `null` when the last one was just done.
 * `count` is how many repeats there are (for example the number of pumps).
 */
export function nextRepeat(index: number, count: number): number | null {
  return index + 1 < count ? index + 1 : null;
}

/** The previous repeat, or `null` when already on the first one. */
export function previousRepeat(index: number): number | null {
  return index > 0 ? index - 1 : null;
}

/** "Pump 2 of 4" style label for a repeating step; empty when there is only one. */
export function repeatLabel(noun: string, index: number, count: number): string {
  return count > 1 ? `${noun} ${index + 1} of ${count}` : '';
}
