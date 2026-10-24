/**
 * Plain-language rules for the cash handover card: what each state means to the person looking at
 * it, and which buttons they may press. The server enforces all of this again.
 */

export type HandoverView = Readonly<{
  state: string;
  deliveredByMembershipId: string;
}>;

export type HandoverViewer = Readonly<{
  membershipId: string;
  canAccept: boolean;
  canResolve: boolean;
  canSubmit: boolean;
}>;

export type HandoverAction = 'accept' | 'resolve' | 'withdraw';

export const HANDOVER_STATE_LABELS: Readonly<Record<string, string>> = {
  DRAFT: 'Not sent yet',
  SUBMITTED: 'Waiting to be accepted',
  ACCEPTED: 'Accepted',
  DISPUTED: 'Does not add up',
  RESOLVED: 'Settled',
  CANCELLED: 'Withdrawn',
};

export function handoverTone(state: string): 'positive' | 'pending' | 'critical' | 'neutral' {
  if (state === 'ACCEPTED' || state === 'RESOLVED') return 'positive';
  if (state === 'SUBMITTED') return 'pending';
  if (state === 'DISPUTED') return 'critical';
  return 'neutral';
}

export function availableHandoverActions(
  handover: HandoverView,
  viewer: HandoverViewer,
): HandoverAction[] {
  const mine = handover.deliveredByMembershipId === viewer.membershipId;
  const actions: HandoverAction[] = [];
  if (handover.state === 'SUBMITTED' && viewer.canAccept && !mine) actions.push('accept');
  if (handover.state === 'DISPUTED' && viewer.canResolve && !mine) actions.push('resolve');
  if (
    (handover.state === 'SUBMITTED' || handover.state === 'DISPUTED') &&
    ((mine && viewer.canSubmit) || viewer.canAccept)
  ) {
    actions.push('withdraw');
  }
  return actions;
}

/** "Handed to <place> by <person>" style sentence, built only from what is known. */
export function describeHandover(input: {
  from: string;
  to: string;
  deliveredByName: string;
  receivedByName: string | null;
  state: string;
}): string {
  const base = `${input.deliveredByName} handed cash from ${input.from} to ${input.to}`;
  if ((input.state === 'ACCEPTED' || input.state === 'RESOLVED') && input.receivedByName) {
    return `${base}. Received by ${input.receivedByName}.`;
  }
  return `${base}.`;
}
