import {
  clearDraft,
  draftStorageKey,
  loadDraft,
  saveDraft,
  type StoredDraft,
} from '@/platform/drafts/local-draft';

/**
 * Saving a wizard's progress on this device, so a reload or a lost connection does not throw away
 * answers from screens that are no longer showing. The page-wide draft keeper only reads fields that
 * are on screen, so a wizard that wants more opts out (`ownDraft` on `WizardCard`) and saves here.
 *
 * What is saved is the screen the person was on and the answers so far. It stays on this device,
 * is offered back and never applied silently, and is dropped after 24 hours, when the record it
 * was typed on has changed (`version`), or once the wizard saves.
 */

export type WizardDraft<A> = {
  step: string;
  index: number;
  answers: A;
};

/** Words that must never be kept in a draft, whatever a screen puts in its answers. */
const NEVER_KEPT = /pass(word|code)?|secret|token|otp|one-?time|verification|\bpin\b|card/i;

/** The key for one wizard, per signed-in person and place, e.g. `['expense', userId, stationId]`. */
export function wizardDraftKey(parts: readonly (string | undefined | null)[]): string {
  return draftStorageKey(['wizard', ...parts]);
}

/** Drops answers whose names look like secrets. Only plain, top-level values are kept. */
export function keepableAnswers<A extends Record<string, unknown>>(answers: A): Partial<A> {
  const kept: Partial<A> = {};
  for (const [name, value] of Object.entries(answers)) {
    if (NEVER_KEPT.test(name)) continue;
    (kept as Record<string, unknown>)[name] = value;
  }
  return kept;
}

/** True when there is nothing worth keeping, so the saved draft should be removed instead. */
export function isBlank(answers: Record<string, unknown>): boolean {
  return Object.values(answers).every(
    (value) =>
      value === '' ||
      value === null ||
      value === undefined ||
      value === false ||
      (Array.isArray(value) && value.length === 0),
  );
}

export function saveWizardDraft<A extends Record<string, unknown>>(
  key: string,
  version: string,
  draft: WizardDraft<A>,
  now?: number,
  storage?: Parameters<typeof saveDraft>[4],
): boolean {
  const answers = keepableAnswers(draft.answers);
  if (isBlank(answers)) {
    clearDraft(key, storage ?? undefined);
    return false;
  }
  return saveDraft(key, version, { ...draft, answers }, now, storage);
}

/**
 * The saved draft, only when its screen still exists in the wizard (`steps`). A draft that points
 * at a screen that no longer applies is thrown away rather than restored to a wrong place.
 */
export function loadWizardDraft<A>(
  key: string,
  version: string,
  steps: readonly string[],
  now?: number,
  storage?: Parameters<typeof loadDraft>[3],
): StoredDraft<WizardDraft<A>> | null {
  const found = loadDraft<WizardDraft<A>>(key, version, now, storage);
  if (!found) return null;
  const data = found.data;
  const valid =
    data !== null &&
    typeof data === 'object' &&
    typeof data.step === 'string' &&
    steps.includes(data.step) &&
    Number.isInteger(data.index) &&
    data.index >= 0 &&
    typeof data.answers === 'object' &&
    data.answers !== null;
  if (!valid) {
    clearDraft(key, storage ?? undefined);
    return null;
  }
  return found;
}

export { clearDraft as clearWizardDraft };
