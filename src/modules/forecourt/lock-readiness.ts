/**
 * What stops a business day from being locked, in plain words. Locking is permanent, so every
 * shift report must be approved, none may be sent back, and every active tank needs a dip reading
 * for the day. The same sentence is shown beside the disabled button and returned by the server
 * when someone tries anyway.
 */
export type LockBlockerCounts = Readonly<{
  /** Reports started but not submitted. */
  draft: number;
  /** Reports submitted and waiting for approval. */
  submitted: number;
  /** Reports sent back and not resubmitted. */
  returned: number;
  /** Active tanks with no dip reading for the business date. */
  tanksWithoutDip: number;
}>;

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function describeLockBlockers(blockers: LockBlockerCounts): string | null {
  const reasons: string[] = [];
  if (blockers.submitted > 0)
    reasons.push(`${count(blockers.submitted, 'shift', 'shifts')} still waiting for approval.`);
  if (blockers.returned > 0)
    reasons.push(
      blockers.returned === 1
        ? '1 report was sent back and has not been resubmitted.'
        : `${blockers.returned} reports were sent back and have not been resubmitted.`,
    );
  if (blockers.draft > 0)
    reasons.push(
      `${count(blockers.draft, 'shift report is', 'shift reports are')} not submitted yet.`,
    );
  if (blockers.tanksWithoutDip > 0)
    reasons.push(
      `${count(blockers.tanksWithoutDip, 'tank has', 'tanks have')} no dip reading for this day.`,
    );
  return reasons.length > 0 ? reasons.join(' ') : null;
}
