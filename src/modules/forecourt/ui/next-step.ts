import { formatBusinessDate } from '../../../design-system/formatters';
import { shiftLabel } from './shift-labels';

export type StepOverview = Readonly<{
  currentBusinessDate: string;
  station: Readonly<{ timezone: string; name?: string }>;
  selectedBusinessDay?: Readonly<{ id: string; date: string; state: string; version: number }>;
  shifts: ReadonlyArray<
    Readonly<{
      id: string;
      state: string;
      plannedStartAt: string;
      plannedEndAt: string;
      version: number;
    }>
  >;
  reconciliations: ReadonlyArray<Readonly<{ id: string; shiftId: string | null; state: string }>>;
  actions: Readonly<
    Record<
      'OpenBusinessDay' | 'CloseBusinessDay' | 'StartShift' | 'CloseMeters' | 'CompleteShift',
      Readonly<{ canExecute: boolean }>
    >
  >;
}>;

export type StepContext = Readonly<{ tenantId: string; stationId: string }>;

/**
 * Whether the station has what a shift needs. `null` means "not known" (the person cannot read set-up
 * data), in which case nothing is blocked here and the server still has the final say.
 */
export type StationSetup = Readonly<{ hasPumps: boolean; hasAttendants: boolean }> | null;

/**
 * Where the person is in the day. Meters are closed before figures are entered, so the order is:
 * open the day, start the shift, close the shift, enter the figures, close the day.
 */
export const TRAIL = [
  'Open day',
  'Start shift',
  'Close shift',
  'Enter figures',
  'Close day',
] as const;

export const BLOCKED_REASONS = {
  STATION_NOT_SET_UP: 'Add pumps and attendants for this station in Settings before starting a shift.',
  DAY_HAS_OPEN_WORK: 'Close every shift and get every reconciliation approved first.',
} as const;

export type StepAction =
  | Readonly<{
      kind: 'command';
      label: string;
      commandType: string;
      values: Record<string, unknown>;
      subjectId: string;
      /** The confirmation dialog shown before the command is sent. */
      confirm: Readonly<{
        title: string;
        lines: ReadonlyArray<Readonly<{ label: string; value: string }>>;
        confirmLabel: string;
      }>;
      /** Toast shown when it worked. */
      success: string;
    }>
  | Readonly<{ kind: 'link'; label: string; href: string }>
  /** No shift exists yet: StartShift creates one from a start time and a length. */
  | Readonly<{ kind: 'newShift'; label: string; values: Record<string, unknown> }>
  /** Opens the Close meters sheet for this shift. */
  | Readonly<{
      kind: 'closeMeters';
      label: string;
      shiftId: string;
      businessDayId: string;
      version: number;
      plannedStartAt: string;
      plannedEndAt: string;
    }>
  /** The rule is not met yet: a disabled button with the reason under it. */
  | Readonly<{ kind: 'blocked'; label: string; reason: string }>;

export type NextStep = Readonly<{
  /** Position in TRAIL, or null when nothing is left to do. */
  stage: number | null;
  title: string;
  detail: string;
  action: StepAction | null;
}>;

const WAITING = new Set(['SUBMITTED', 'PENDING_APPROVAL']);
const SHIFT_CLOSED = new Set(['METER_CLOSED', 'COMPLETED', 'NOT_OPERATED']);

function newShiftAction(
  base: Record<string, string>,
  businessDayId: string,
  newId: () => string,
  setup: StationSetup,
): StepAction {
  if (setup && (!setup.hasPumps || !setup.hasAttendants)) {
    return { kind: 'blocked', label: 'Start shift', reason: BLOCKED_REASONS.STATION_NOT_SET_UP };
  }
  return {
    kind: 'newShift',
    label: 'Start shift',
    values: { ...base, businessDayId, shiftId: newId(), expectedVersion: 0 },
  };
}

function dayLines(date: string, station?: string) {
  return [
    ...(station ? [{ label: 'Station', value: station }] : []),
    { label: 'Date', value: formatBusinessDate(date) },
  ];
}

/**
 * The single thing a supervisor should do next, worked out only from states the server returned. It
 * never changes anything by itself; the action it names is a normal command (or a link) that the
 * server authorises again.
 */
export function nextStep(
  overview: StepOverview,
  context: StepContext,
  newId: () => string,
  setup: StationSetup = null,
): NextStep {
  const { actions } = overview;
  const day = overview.selectedBusinessDay;
  const base = { tenantId: context.tenantId, stationId: context.stationId };

  if (!day || day.state === 'NOT_STARTED') {
    if (actions.OpenBusinessDay.canExecute) {
      const businessDayId = day?.id ?? newId();
      return {
        stage: 0,
        title: 'Open today’s business day',
        detail: 'Do this first. Shifts and figures are recorded against the day.',
        action: {
          kind: 'command',
          label: 'Open business day',
          commandType: 'OpenBusinessDay',
          values: { ...base, businessDayId, expectedVersion: day?.version ?? 0 },
          subjectId: businessDayId,
          confirm: {
            title: 'Open business day?',
            lines: dayLines(day?.date ?? overview.currentBusinessDate, overview.station.name),
            confirmLabel: 'Open day',
          },
          success: 'Business day opened',
        },
      };
    }
    return {
      stage: 0,
      title: 'Waiting for the day to be opened',
      detail: 'Ask a manager to open today’s business day.',
      action: null,
    };
  }

  if (day.state !== 'OPEN') {
    return {
      stage: null,
      title: 'Today is closed',
      detail: 'Nothing more to do for this business day.',
      action: null,
    };
  }

  const shifts = [...overview.shifts].sort((a, b) =>
    a.plannedStartAt.localeCompare(b.plannedStartAt),
  );
  const timezone = overview.station.timezone;
  const label = (shift: StepOverview['shifts'][number]) =>
    shiftLabel(shift.plannedStartAt, shift.plannedEndAt, timezone);
  const dayParams = (shiftId: string, reconciliationId?: string) => {
    const params = new URLSearchParams({ ...base, businessDayId: day.id, shiftId });
    if (reconciliationId) params.set('reconciliationId', reconciliationId);
    return `/operations/daily?${params.toString()}`;
  };
  const shiftValues = (shift: StepOverview['shifts'][number]) => ({
    ...base,
    businessDayId: day.id,
    shiftId: shift.id,
    expectedVersion: shift.version,
  });
  const reconciliationOf = (shiftId: string) =>
    overview.reconciliations.find((item) => item.shiftId === shiftId);

  // A returned reconciliation is waiting on the supervisor before anything else.
  for (const shift of shifts) {
    const reconciliation = reconciliationOf(shift.id);
    if (reconciliation?.state === 'RETURNED') {
      return {
        stage: 3,
        title: 'Fix and resubmit the figures',
        detail: `The ${label(shift)} shift was sent back for changes.`,
        action: {
          kind: 'link',
          label: 'Fix and resubmit',
          href: dayParams(shift.id, reconciliation.id),
        },
      };
    }
  }

  const planned = shifts.find((shift) => shift.state === 'PLANNED');
  if (planned) {
    if (actions.StartShift.canExecute) {
      return {
        stage: 1,
        title: `Start the ${label(planned)} shift`,
        detail: 'Do this when the shift begins, before the first sale.',
        action:
          setup && (!setup.hasPumps || !setup.hasAttendants)
            ? { kind: 'blocked', label: 'Start shift', reason: BLOCKED_REASONS.STATION_NOT_SET_UP }
            : {
                kind: 'command',
                label: 'Start shift',
                commandType: 'StartShift',
                values: {
                  ...shiftValues(planned),
                  plannedStartAt: planned.plannedStartAt,
                  plannedEndAt: planned.plannedEndAt,
                },
                subjectId: planned.id,
                confirm: {
                  title: 'Start shift?',
                  lines: [{ label: 'Shift', value: label(planned) }],
                  confirmLabel: 'Start shift',
                },
                success: 'Shift started',
              },
      };
    }
    return {
      stage: 1,
      title: 'Waiting for the shift to start',
      detail: 'You do not have permission to start this shift.',
      action: null,
    };
  }

  // Meters come first: nothing can be submitted while the shift is still open.
  const open = shifts.find((shift) => shift.state === 'OPEN');
  if (open) {
    if (actions.CloseMeters.canExecute) {
      return {
        stage: 2,
        title: 'Close the shift meters',
        detail: `Enter the closing reading for every pump on the ${label(open)} shift.`,
        action: {
          kind: 'closeMeters',
          label: 'Close meters',
          shiftId: open.id,
          businessDayId: day.id,
          version: open.version,
          plannedStartAt: open.plannedStartAt,
          plannedEndAt: open.plannedEndAt,
        },
      };
    }
    return {
      stage: 2,
      title: 'Waiting for the shift to be closed',
      detail: 'A manager closes the meters for this shift.',
      action: null,
    };
  }

  const meterClosed = shifts.find((shift) => shift.state === 'METER_CLOSED');
  if (meterClosed && actions.CompleteShift.canExecute) {
    return {
      stage: 2,
      title: 'Finish closing the shift',
      detail: `Meters are closed for the ${label(meterClosed)} shift.`,
      action: {
        kind: 'command',
        label: 'Close shift',
        commandType: 'CompleteShift',
        values: shiftValues(meterClosed),
        subjectId: meterClosed.id,
        confirm: {
          title: 'Close shift?',
          lines: [{ label: 'Shift', value: label(meterClosed) }],
          confirmLabel: 'Close shift',
        },
        success: 'Shift closed',
      },
    };
  }

  // Shifts are closed: the figures come next.
  for (const shift of shifts) {
    if (!SHIFT_CLOSED.has(shift.state) || shift.state === 'NOT_OPERATED') continue;
    const reconciliation = reconciliationOf(shift.id);
    if (!reconciliation || reconciliation.state === 'DRAFT') {
      return {
        stage: 3,
        title: reconciliation ? 'Continue entering the figures' : 'Enter the shift figures',
        detail: `Payments, expenses and cash for the ${label(shift)} shift.`,
        action: {
          kind: 'link',
          label: reconciliation ? 'Continue' : 'Start entering figures',
          href: dayParams(shift.id, reconciliation?.id),
        },
      };
    }
  }

  const waiting = shifts.find((shift) => WAITING.has(reconciliationOf(shift.id)?.state ?? ''));
  if (waiting) {
    return {
      stage: 3,
      title: 'Waiting for a manager to approve',
      detail: `The ${label(waiting)} figures are with a manager. You’ll be told if anything needs fixing.`,
      action: null,
    };
  }

  if (shifts.length === 0) {
    if (actions.StartShift.canExecute) {
      return {
        stage: 1,
        title: 'Start today’s shift',
        detail: 'Choose the shift and when it starts. Then close the meters when it ends.',
        action: newShiftAction(base, day.id, newId, setup),
      };
    }
    return {
      stage: 1,
      title: 'No shift has been started',
      detail: 'You do not have permission to start a shift. Ask a manager.',
      action: null,
    };
  }

  const everyShiftClosed = shifts.every((shift) => ['COMPLETED', 'NOT_OPERATED'].includes(shift.state));
  const everyReconciliationApproved = overview.reconciliations.every((item) =>
    ['APPROVED', 'LOCKED', 'POSTED'].includes(item.state),
  );
  if (actions.CloseBusinessDay.canExecute) {
    if (everyShiftClosed && everyReconciliationApproved) {
      return {
        stage: 4,
        title: 'Close the business day',
        detail: 'Every shift is closed and approved. Close the day to finish.',
        action: {
          kind: 'command',
          label: 'Close business day',
          commandType: 'CloseBusinessDay',
          values: { ...base, businessDayId: day.id, expectedVersion: day.version },
          subjectId: day.id,
          confirm: {
            title: 'Close business day?',
            lines: [
              { label: 'Date', value: formatBusinessDate(day.date) },
              { label: 'Shifts', value: String(shifts.length) },
            ],
            confirmLabel: 'Close day',
          },
          success: 'Business day closed',
        },
      };
    }
    return {
      stage: 4,
      title: 'Close the business day',
      detail: 'Do this once every shift is closed and approved.',
      action: { kind: 'blocked', label: 'Close business day', reason: BLOCKED_REASONS.DAY_HAS_OPEN_WORK },
    };
  }

  return {
    stage: null,
    title: 'You are all caught up',
    detail: 'Nothing needs you right now.',
    action: null,
  };
}

/** What each step of the day would do if pressed now; null when it cannot be done yet (or is already done). */
export function trailActions(
  overview: StepOverview,
  context: StepContext,
  newId: () => string,
  setup: StationSetup = null,
): ReadonlyArray<StepAction | null> {
  const day = overview.selectedBusinessDay;
  const none: Array<StepAction | null> = [null, null, null, null, null];
  const step = nextStep(overview, context, newId, setup);
  if (step.stage === null || !step.action || step.action.kind === 'blocked') return none;

  // Only the step that is actually due can be pressed; the others wait their turn.
  none[step.stage] = step.action;

  // A returned or in-progress reconciliation can also be opened from "Enter figures" at any time
  // after the shift is closed.
  if (day?.state === 'OPEN') {
    const closedShift = overview.shifts.find((shift) => SHIFT_CLOSED.has(shift.state));
    if (closedShift && !none[3]) {
      const reconciliation = overview.reconciliations.find((item) => item.shiftId === closedShift.id);
      const params = new URLSearchParams({
        tenantId: context.tenantId,
        stationId: context.stationId,
        businessDayId: day.id,
        shiftId: closedShift.id,
      });
      if (reconciliation) params.set('reconciliationId', reconciliation.id);
      none[3] = {
        kind: 'link',
        label: 'Enter figures',
        href: `/operations/daily?${params.toString()}`,
      };
    }
  }
  return none;
}
