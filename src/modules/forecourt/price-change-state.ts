/**
 * Pure presentation logic for the "Change a price" screen. No server or browser code lives here,
 * so it is safe to import from both and easy to test.
 */
import { compareDecimalText, normaliseReadingText } from './my-shift-state';

export type PriceChangeCapabilities = {
  request: boolean;
  approve: boolean;
  prepare: boolean;
  boundary: boolean;
  activate: boolean;
};

export type PriceChangeNozzle = {
  nozzleId: string;
  label: string;
  meterInstallationId: string | null;
  lastReading: string | null;
  /** The pump meter was already read for the change that is under way. */
  done: boolean;
  /** The old-price reading is already saved for the change under way, so it is not taken again. */
  closed: boolean;
};

export type PriceChange = {
  priceId: string;
  unitPrice: string;
  state: string;
  version: number;
  requestedByMe: boolean;
  /** The date and time it was planned to start. The pump meter readings set the real start. */
  plannedFrom?: string;
};

/** A price that has been in use, newest first: kept so a past sale can be checked against it. */
export type PriceHistoryEntry = {
  priceId: string;
  unitPrice: string;
  startedAt: string;
  endedAt: string | null;
  state: string;
};

export type PriceChangeProduct = {
  productId: string;
  name: string;
  currentPrice: string | null;
  change: PriceChange | null;
  history?: PriceHistoryEntry[];
  nozzles: PriceChangeNozzle[];
};

export type PriceChangeData = {
  tenantId: string;
  station: { id: string; name: string; timezone: string };
  capabilities: PriceChangeCapabilities;
  shift: { id: string; businessDayId: string; label: string | null; version: number } | null;
  attendants: Array<{ id: string; name: string }>;
  products: PriceChangeProduct[];
};

/** What happens to a price change next, in the order it has to happen. */
export type PriceChangeStep = 'REQUEST' | 'APPROVE' | 'PREPARE' | 'READINGS' | 'ACTIVATE' | 'NONE';

const APPROVAL_STEPS: Record<
  string,
  { step: PriceChangeStep; needs: keyof PriceChangeCapabilities }
> = {
  DRAFT: { step: 'REQUEST', needs: 'request' },
  PENDING_APPROVAL: { step: 'APPROVE', needs: 'approve' },
  APPROVED: { step: 'PREPARE', needs: 'prepare' },
};

/**
 * The next step for a change that is under way, or why nobody here can take it.
 * `blockedBy` is set when the step exists but this person is not allowed to do it.
 */
export function nextPriceChangeStep(
  change: Pick<PriceChange, 'state'>,
  nozzles: Array<Pick<PriceChangeNozzle, 'done'>>,
  can: PriceChangeCapabilities,
): { step: PriceChangeStep; blockedBy?: keyof PriceChangeCapabilities } {
  const approval = APPROVAL_STEPS[change.state];
  if (approval) {
    return can[approval.needs]
      ? { step: approval.step }
      : { step: approval.step, blockedBy: approval.needs };
  }
  if (change.state === 'PENDING_STATION_ACTIVATION' || change.state === 'BOUNDARIES_IN_PROGRESS') {
    const allRead = nozzles.length > 0 && nozzles.every((nozzle) => nozzle.done);
    if (!allRead) {
      return can.boundary ? { step: 'READINGS' } : { step: 'READINGS', blockedBy: 'boundary' };
    }
    return can.activate ? { step: 'ACTIVATE' } : { step: 'ACTIVATE', blockedBy: 'activate' };
  }
  return { step: 'NONE' };
}

/** Plain words for where a change has got to. */
export function describePriceChange(state: string, allRead: boolean): string {
  switch (state) {
    case 'DRAFT':
      return 'Saved. Not sent for approval yet.';
    case 'PENDING_APPROVAL':
      return 'Waiting for approval.';
    case 'APPROVED':
      return 'Approved. Ready to switch.';
    case 'PENDING_STATION_ACTIVATION':
    case 'BOUNDARIES_IN_PROGRESS':
      return allRead ? 'Pump readings done. Ready to switch.' : 'Waiting for the pump readings.';
    default:
      return 'In progress.';
  }
}

export function whoCanHelp(blockedBy: keyof PriceChangeCapabilities): string {
  switch (blockedBy) {
    case 'approve':
      return 'A manager or owner needs to approve this price.';
    case 'boundary':
      return 'A manager or owner needs to record the pump readings.';
    case 'activate':
      return 'A manager or owner needs to switch this price on.';
    default:
      return 'A manager or owner needs to finish this change.';
  }
}

export type PriceCheck = { ok: true; value: string } | { ok: false; message: string };

/** A price per litre with up to 6 decimals, greater than zero, and not what is already in use. */
export function checkNewPrice(raw: string, currentPrice: string | null): PriceCheck {
  const value = raw.trim().replace(/,/g, '');
  if (value === '')
    return { ok: false, message: 'Enter the new price per litre, for example 1.65.' };
  if (!/^\d+(?:\.\d{1,6})?$/.test(value) || /^0*(?:\.0*)?$/.test(value)) {
    return {
      ok: false,
      message: 'Use a number above zero, with up to 6 digits after the point. For example 1.65.',
    };
  }
  const normalised = value.replace(/^0+(?=\d)/, '');
  if (currentPrice !== null && compareDecimalText(normalised, currentPrice) === 0) {
    return { ok: false, message: 'That is the price already in use. Enter a different price.' };
  }
  return { ok: true, value: normalised };
}

export type ReadingCheck = { ok: true; value: string } | { ok: false; message: string };

/** The number on the pump meter right now. It can never be lower than the last recorded reading. */
export function checkCutoverReading(raw: string, lastReading: string | null): ReadingCheck {
  const value = normaliseReadingText(raw);
  if (value === '') return { ok: false, message: 'Enter the number shown on the meter.' };
  if (!/^\d{1,12}(\.\d{1,3})?$/.test(value)) {
    return {
      ok: false,
      message: 'Use numbers only, with up to 3 digits after the point. For example 12345.678.',
    };
  }
  if (lastReading !== null && compareDecimalText(value, lastReading) < 0) {
    return {
      ok: false,
      message: `The reading cannot be lower than the last one recorded (${lastReading}). Check the meter and try again.`,
    };
  }
  return { ok: true, value };
}

/** Why the readings cannot be taken yet, or null when they can. */
export function readingsBlocker(data: PriceChangeData, product: PriceChangeProduct): string | null {
  if (!data.shift) {
    return 'There is no shift open. Start the shift first, then switch the price.';
  }
  if (data.attendants.length === 0) {
    return 'No attendant is set up for this station. Add an attendant first.';
  }
  if (product.nozzles.some((nozzle) => nozzle.meterInstallationId === null)) {
    return 'A pump for this fuel has no meter set up yet.';
  }
  return null;
}

export type QuickStep = 'DRAFT' | 'REQUEST' | 'APPROVE' | 'PREPARE';

/** The order a price travels in, the permission each step needs and the version it expects. */
const QUICK_STEPS: Array<{
  step: QuickStep;
  needs: keyof PriceChangeCapabilities;
  after: string | null;
  expectedVersion: number;
}> = [
  { step: 'DRAFT', needs: 'request', after: null, expectedVersion: 0 },
  { step: 'REQUEST', needs: 'request', after: 'DRAFT', expectedVersion: 0 },
  { step: 'APPROVE', needs: 'approve', after: 'PENDING_APPROVAL', expectedVersion: 1 },
  { step: 'PREPARE', needs: 'prepare', after: 'APPROVED', expectedVersion: 2 },
];

/**
 * The steps to run in one go for a price in `state` (null when there is no change yet), in order,
 * stopping at the first one this person is not allowed to do. `stoppedAt` names that permission.
 */
export function quickSteps(
  state: string | null,
  can: PriceChangeCapabilities,
): {
  run: Array<{ step: QuickStep; expectedVersion: number }>;
  stoppedAt?: keyof PriceChangeCapabilities;
} {
  const start = QUICK_STEPS.findIndex((entry) => entry.after === state);
  if (start === -1) return { run: [] };
  const run: Array<{ step: QuickStep; expectedVersion: number }> = [];
  for (const entry of QUICK_STEPS.slice(start)) {
    if (!can[entry.needs]) return { run, stoppedAt: entry.needs };
    run.push({ step: entry.step, expectedVersion: entry.expectedVersion });
  }
  return { run };
}
