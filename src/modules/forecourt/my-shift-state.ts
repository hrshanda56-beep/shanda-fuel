/**
 * Pure presentation logic for the attendant "My shift" workspace.
 *
 * Nothing here grants access or decides business rules: the server read model
 * supplies authorised facts, the command API stays the authority for every
 * write. This module only decides what to show and which single step is next.
 * It is deliberately free of `server-only` so the browser can share it.
 */

export type MyShiftBoundaryReason = 'SHIFT_OPEN' | 'SHIFT_CLOSE';

export type MyShiftBoundary =
  | { status: 'RECORDED'; value: string; recordedAt: string }
  | { status: 'UNAVAILABLE'; recordedAt: string };

export type MyShiftMeter = {
  nozzleId: string;
  /** Null when no meter is installed for this shift window; capture is blocked. */
  meterInstallationId: string | null;
  pumpNumber: string;
  nozzleNumber: string;
  productName: string;
  /** Last sealed reading before this shift; the opening reading must match it. */
  previousReading: string | null;
  opening: MyShiftBoundary | null;
  closing: MyShiftBoundary | null;
};

export type MyShiftShift = {
  id: string;
  businessDayId: string;
  label: string | null;
  state: string;
  businessDayState: string;
  plannedStartAt: string;
  plannedEndAt: string;
  version: number;
};

export type MyShiftData = {
  station: { id: string; name: string; timezone: string };
  tenantId: string;
  legalEntityId: string;
  /** Server clock, so a wrong phone clock cannot change what is "due". */
  now: string;
  /** The signed-in attendant's own station membership; reported on every capture. */
  responsibleAttendantId: string;
  canCapture: boolean;
  shift: MyShiftShift | null;
  meters: MyShiftMeter[];
};

export type StepState = 'done' | 'due' | 'not_due' | 'waiting' | 'blocked' | 'needs_supervisor';

export type MeterView = {
  meter: MyShiftMeter;
  label: string;
  opening: { state: StepState; text: string; value?: string };
  closing: { state: StepState; text: string; value?: string };
};

export type NextAction =
  | { kind: 'record'; boundary: MyShiftBoundaryReason; nozzleId: string; label: string }
  | { kind: 'none'; message: string };

export type MyShiftView = {
  phase: 'no_shift' | 'waiting_to_start' | 'running' | 'finished';
  headline: string;
  meters: MeterView[];
  next: NextAction;
};

type ShiftRow = {
  id: string;
  state: string;
  businessDayState: string;
  plannedStartAt: string;
  plannedEndAt: string;
};

const ACTIVE_STATES = new Set(['OPEN']);
const WAITING_STATES = new Set(['PLANNED']);
const FINISHED_STATES = new Set(['METER_CLOSED', 'COMPLETED']);

/**
 * Resolve the current shift from the configured schedule, never from a manual
 * choice: the running shift wins, then the planned shift covering now, then the
 * next planned shift, then the most recently finished one.
 */
export function pickCurrentShift<T extends ShiftRow>(rows: readonly T[], nowMs: number): T | null {
  const startOf = (row: T) => Date.parse(row.plannedStartAt);
  const endOf = (row: T) => Date.parse(row.plannedEndAt);
  const usable = rows.filter(
    (row) => row.businessDayState === 'OPEN' || row.businessDayState === 'NOT_STARTED',
  );

  const running = usable.filter((row) => ACTIVE_STATES.has(row.state));
  if (running.length > 0) {
    return [...running].sort((a, b) => startOf(b) - startOf(a))[0] ?? null;
  }

  const planned = usable.filter((row) => WAITING_STATES.has(row.state));
  const covering = planned.filter((row) => startOf(row) <= nowMs && nowMs < endOf(row));
  if (covering.length > 0) return [...covering].sort((a, b) => startOf(a) - startOf(b))[0] ?? null;
  const upcoming = planned.filter((row) => startOf(row) > nowMs);
  if (upcoming.length > 0) return [...upcoming].sort((a, b) => startOf(a) - startOf(b))[0] ?? null;

  const finished = rows.filter((row) => FINISHED_STATES.has(row.state));
  return [...finished].sort((a, b) => endOf(b) - endOf(a))[0] ?? null;
}

export function meterLabel(meter: Pick<MyShiftMeter, 'pumpNumber' | 'nozzleNumber'>): string {
  return `Pump ${meter.pumpNumber} · Nozzle ${meter.nozzleNumber}`;
}

/** "06:00–18:00" in the station's own time zone. */
export function formatShiftWindow(startIso: string, endIso: string, timeZone: string): string {
  return `${formatClock(startIso, timeZone)}–${formatClock(endIso, timeZone)}`;
}

export function formatClock(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone,
    }).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(iso));
  }
}

export function deriveMyShiftView(data: MyShiftData): MyShiftView {
  const nowMs = Date.parse(data.now);
  const shift = data.shift;

  if (!shift) {
    return {
      phase: 'no_shift',
      headline: 'There is no shift to work on right now.',
      meters: [],
      next: {
        kind: 'none',
        message: 'Your supervisor starts the shift. Nothing is needed from you yet.',
      },
    };
  }

  const running = ACTIVE_STATES.has(shift.state) && shift.businessDayState === 'OPEN';
  const finished = FINISHED_STATES.has(shift.state);
  const closingDue = running && nowMs >= Date.parse(shift.plannedEndAt);

  const meters: MeterView[] = data.meters.map((meter) => {
    const label = meterLabel(meter);
    const noMeter = meter.meterInstallationId === null;

    const opening: MeterView['opening'] = (() => {
      if (meter.opening?.status === 'RECORDED') {
        return { state: 'done', text: 'Completed', value: meter.opening.value };
      }
      if (meter.opening?.status === 'UNAVAILABLE') {
        return { state: 'needs_supervisor', text: 'Could not be read. Tell your supervisor.' };
      }
      if (noMeter) return { state: 'blocked', text: 'No meter is set up. Tell your supervisor.' };
      if (running) return { state: 'due', text: 'Due now' };
      if (finished) return { state: 'blocked', text: 'Not recorded' };
      return { state: 'waiting', text: 'Waiting for your supervisor to start the shift' };
    })();

    const closing: MeterView['closing'] = (() => {
      if (meter.closing?.status === 'RECORDED') {
        return { state: 'done', text: 'Completed', value: meter.closing.value };
      }
      if (meter.closing?.status === 'UNAVAILABLE') {
        return { state: 'needs_supervisor', text: 'Could not be read. Tell your supervisor.' };
      }
      if (noMeter) return { state: 'blocked', text: 'No meter is set up. Tell your supervisor.' };
      if (finished) return { state: 'blocked', text: 'Not recorded' };
      if (!running) return { state: 'waiting', text: 'Not yet due' };
      if (opening.state !== 'done') return { state: 'waiting', text: 'After the opening reading' };
      return closingDue
        ? { state: 'due', text: 'Due now' }
        : { state: 'not_due', text: 'Not yet due' };
    })();

    return { meter, label, opening, closing };
  });

  const phase: MyShiftView['phase'] = finished
    ? 'finished'
    : running
      ? 'running'
      : 'waiting_to_start';

  let next: NextAction = { kind: 'none', message: 'Nothing is needed from you right now.' };
  if (finished) {
    next = { kind: 'none', message: 'This shift is finished. Thank you.' };
  } else if (!running) {
    next = {
      kind: 'none',
      message: `Your supervisor starts the shift${
        Number.isFinite(nowMs)
          ? ` (planned ${formatClock(shift.plannedStartAt, data.station.timezone)})`
          : ''
      }. Nothing is needed from you yet.`,
    };
  } else if (!data.canCapture) {
    next = { kind: 'none', message: 'You can see this shift but cannot record readings.' };
  } else {
    const openingDue = meters.find((view) => view.opening.state === 'due');
    const closing = meters.find((view) => view.closing.state === 'due');
    if (openingDue) {
      next = {
        kind: 'record',
        boundary: 'SHIFT_OPEN',
        nozzleId: openingDue.meter.nozzleId,
        label: `Record the opening reading for ${openingDue.label}`,
      };
    } else if (closing) {
      next = {
        kind: 'record',
        boundary: 'SHIFT_CLOSE',
        nozzleId: closing.meter.nozzleId,
        label: `Record the closing reading for ${closing.label}`,
      };
    } else if (meters.every((view) => view.opening.state === 'done')) {
      next = {
        kind: 'none',
        message: `Opening readings are done. Closing readings are due at ${formatClock(shift.plannedEndAt, data.station.timezone)}.`,
      };
    }
  }

  const headline = finished
    ? 'This shift is finished.'
    : running
      ? 'Your shift is running.'
      : 'Your shift has not started yet.';

  return { phase, headline, meters, next };
}

/* Reading input ------------------------------------------------------------ */

const READING_PATTERN = /^\d{1,12}(\.\d{1,3})?$/;

export type ReadingCheck = { ok: true; value: string } | { ok: false; message: string };

/** Normalise what a person typed; no floating point is ever involved. */
export function normaliseReadingText(raw: string): string {
  return raw.trim().replace(/,/g, '').replace(/\s+/g, '');
}

export function compareDecimalText(a: string, b: string): number {
  const [aInt = '0', aFrac = ''] = a.split('.');
  const [bInt = '0', bFrac = ''] = b.split('.');
  const scale = Math.max(aFrac.length, bFrac.length);
  const left = BigInt(aInt + aFrac.padEnd(scale, '0'));
  const right = BigInt(bInt + bFrac.padEnd(scale, '0'));
  return left === right ? 0 : left < right ? -1 : 1;
}

export function checkReading(
  raw: string,
  context: {
    boundary: MyShiftBoundaryReason;
    openingValue?: string;
    previousReading?: string | null;
  },
): ReadingCheck {
  const value = normaliseReadingText(raw);
  if (value === '') return { ok: false, message: 'Enter the number shown on the meter.' };
  if (value.startsWith('-')) return { ok: false, message: 'A meter reading cannot be negative.' };
  if (!READING_PATTERN.test(value)) {
    return {
      ok: false,
      message: 'Use numbers only, with up to 3 digits after the point. For example 12345.678.',
    };
  }
  if (
    context.boundary === 'SHIFT_CLOSE' &&
    context.openingValue !== undefined &&
    compareDecimalText(value, context.openingValue) < 0
  ) {
    return {
      ok: false,
      message: `The closing reading cannot be lower than the opening reading (${context.openingValue}). Check the meter and try again.`,
    };
  }
  if (
    context.boundary === 'SHIFT_OPEN' &&
    context.previousReading &&
    compareDecimalText(value, context.previousReading) !== 0
  ) {
    return {
      ok: false,
      message: `The opening reading must match the last closing reading (${context.previousReading}). If the meter shows something else, tell your supervisor.`,
    };
  }
  return { ok: true, value };
}
