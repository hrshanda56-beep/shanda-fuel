import { stationLocalToInstant } from '../../../platform/domain/business-time';
import { shiftOpensAt } from '../shift-schedule';

export type StepOverview = Readonly<{
  currentBusinessDate: string;
  station: Readonly<{ timezone: string }>;
  selectedBusinessDay?: Readonly<{ id: string; date: string; state: string; version: number }>;
  shifts: ReadonlyArray<
    Readonly<{
      id: string;
      state: string;
      plannedStartAt: string;
      plannedEndAt: string;
      version: number;
      /** The scheduled shift this one was opened from, when it came from one. */
      shiftTemplateId?: string | null;
    }>
  >;
  /** The station's scheduled shifts (for example Day and Night). */
  shiftTemplates?: ReadonlyArray<
    Readonly<{ id: string; name: string; startTime: string | null; durationMinutes: number }>
  >;
  reconciliations: ReadonlyArray<
    Readonly<{
      id: string;
      shiftId: string | null;
      state: string;
      /** Whether this person may approve it; the server applies the same rule as the approve command. */
      youMayApprove?: boolean;
    }>
  >;
  actions: Readonly<
    Record<
      'OpenBusinessDay' | 'CloseBusinessDay' | 'StartShift' | 'CloseMeters' | 'CompleteShift',
      Readonly<{ canExecute: boolean }>
    >
  >;
}>;

export type StepContext = Readonly<{ tenantId: string; stationId: string }>;

/** Where the person is in the day: start a shift (which opens the day), enter figures, close the shift, close the day. */
export const TRAIL = ['Start shift', 'Enter figures', 'Close shift', 'Close day'] as const;

export type PrecedingCommand = Readonly<{
  commandType: string;
  values: Record<string, unknown>;
  subjectId: string;
}>;

export type NextStep = Readonly<{
  /** Position in TRAIL, or null when nothing is left to do. */
  stage: number | null;
  title: string;
  detail: string;
  action:
    | Readonly<{
        kind: 'command';
        label: string;
        commandType: string;
        values: Record<string, unknown>;
        subjectId: string;
        /** Asked before running; omitted for routine, clearly named actions. */
        confirm?: string;
        /** Ask for a reason (and send it as this field) before running. */
        askReason?: { field: string; question: string };
        /** Runs first, and only this action is shown: opening the day is part of starting its first shift. */
        before?: PrecedingCommand;
      }>
    | Readonly<{ kind: 'link'; label: string; href: string }>
    | null;
}>;

function stationClock(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone }).format(
    instant,
  );
}

function timeRange(start: string, end: string, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  });
  return `${formatter.format(new Date(start))} – ${formatter.format(new Date(end))}`;
}

/** Shifts always come from the station's schedule; the person is never asked for a time or length. */
const NO_SCHEDULE: NextStep = {
  stage: 0,
  title: 'No shift schedule',
  detail: 'Ask a manager to set up the station’s shifts.',
  action: null,
};

const WAITING = new Set(['SUBMITTED', 'PENDING_APPROVAL']);

/** Asked before the shift is closed; the first sentence is the question, the rest what happens. */
const CLOSE_SHIFT_CONFIRM =
  'Close this shift? The pump readings you entered become the official meter records for the shift, and the shift is finished. This cannot be undone from here.';

/**
 * "Close Shift": close the meters, then complete the shift. Closing the meters raises the shift's
 * version by one, so the second command expects that.
 */
function closeShiftAction(
  shift: StepOverview['shifts'][number],
  shiftValues: (shift: StepOverview['shifts'][number]) => Record<string, unknown>,
): Extract<StepAction, { kind: 'command' }> {
  return {
    kind: 'command',
    label: 'Close Shift',
    commandType: 'CompleteShift',
    values: { ...shiftValues(shift), expectedVersion: shift.version + 1 },
    subjectId: shift.id,
    confirm: CLOSE_SHIFT_CONFIRM,
    before: {
      commandType: 'CloseMeters',
      values: shiftValues(shift),
      subjectId: shift.id,
    },
  };
}

/** "Day" and "Day shift" both read as "Day shift", never "Day shift shift". */
function shiftName(name: string): string {
  const trimmed = name.trim();
  return /\bshift$/i.test(trimmed) ? trimmed : `${trimmed} shift`;
}

/** The button and heading wording: "Open Night Shift". */
function openShiftLabel(name: string): string {
  const words = shiftName(name).replace(/\b\w/g, (letter) => letter.toUpperCase());
  return `Open ${words}`;
}

type DueShift = Readonly<{
  id: string;
  name: string;
  startTime: string;
  startsAt: Date;
  /** False until the early-start window opens. */
  openNow: boolean;
}>;

/**
 * The scheduled shift to open next: among those not yet opened today, the latest one whose
 * window is open, otherwise the earliest still to come. Null when the station has no scheduled
 * shifts or all of them have been opened.
 */
function dueShift(overview: StepOverview, dayDate: string, now: Date): DueShift | null {
  const used = new Set(overview.shifts.map((shift) => shift.shiftTemplateId).filter(Boolean));
  const candidates = (overview.shiftTemplates ?? []).flatMap((template) => {
    if (used.has(template.id) || !template.startTime) return [];
    const startsAt = stationLocalToInstant(
      `${dayDate}T${template.startTime.slice(0, 5)}`,
      overview.station.timezone,
    );
    if (!startsAt) return [];
    return [
      {
        id: template.id,
        name: template.name,
        startTime: template.startTime.slice(0, 5),
        startsAt,
        openNow: now.getTime() >= shiftOpensAt(startsAt).getTime(),
      },
    ];
  });
  candidates.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const open = candidates.filter((candidate) => candidate.openNow);
  return open[open.length - 1] ?? candidates[0] ?? null;
}

function openShiftAction(
  base: Record<string, string>,
  businessDayId: string,
  due: DueShift,
  newId: () => string,
): Extract<StepAction, { kind: 'command' }> {
  const shiftId = newId();
  return {
    kind: 'command',
    label: openShiftLabel(due.name),
    commandType: 'StartShift',
    values: {
      ...base,
      businessDayId,
      shiftId,
      expectedVersion: 0,
      plannedStartAt: due.startsAt.toISOString(),
      shiftTemplateId: due.id,
    },
    subjectId: shiftId,
  };
}

/**
 * Starting the first shift of a day also opens the day, so the person never presses a separate
 * "Open day". Returns null when the person cannot start a shift (or cannot open the day).
 */
function firstShiftOfDay(
  overview: StepOverview,
  base: Record<string, string>,
  newId: () => string,
  now: Date,
): { due: DueShift | null; action: StepAction | null } | null {
  const { actions } = overview;
  const day = overview.selectedBusinessDay;
  if (!actions.StartShift.canExecute || !actions.OpenBusinessDay.canExecute) return null;
  const businessDayId = day?.id ?? newId();
  const before: PrecedingCommand = {
    commandType: 'OpenBusinessDay',
    values: { ...base, businessDayId, expectedVersion: day?.version ?? 0 },
    subjectId: businessDayId,
  };
  const due = dueShift(overview, day?.date ?? overview.currentBusinessDate, now);
  if (due) {
    return {
      due,
      action: due.openNow ? { ...openShiftAction(base, businessDayId, due, newId), before } : null,
    };
  }
  // No scheduled shift: the person is never asked for a time or length, so there is nothing to offer.
  return { due: null, action: null };
}

/**
 * The single thing a supervisor should do next, worked out only from states the
 * server returned. It never changes anything by itself; the action it names is a
 * normal command (or a link) that the server authorises again.
 */
export function nextStep(
  overview: StepOverview,
  context: StepContext,
  newId: () => string,
  now: Date = new Date(),
): NextStep {
  const { actions } = overview;
  const day = overview.selectedBusinessDay;
  const base = { tenantId: context.tenantId, stationId: context.stationId };

  if (!day || day.state === 'NOT_STARTED') {
    const first = firstShiftOfDay(overview, base, newId, now);
    if (first?.due && !first.action) {
      return {
        stage: 0,
        title: `Waiting for the ${shiftName(first.due.name)}`,
        detail: `Opens at ${stationClock(shiftOpensAt(first.due.startsAt), overview.station.timezone)}.`,
        action: null,
      };
    }
    if (first?.action && first.due) {
      return {
        stage: 0,
        title: openShiftLabel(first.due.name),
        detail: 'This also opens the business day.',
        action: first.action,
      };
    }
    if (first && !first.due) return NO_SCHEDULE;
    if (actions.OpenBusinessDay.canExecute) {
      // Able to open the day but not to start a shift: open it so whoever starts the shift can.
      const businessDayId = day?.id ?? newId();
      return {
        stage: 0,
        title: 'Open today’s business day',
        detail: 'Shifts are recorded against the day.',
        action: {
          kind: 'command',
          label: 'Open business day',
          commandType: 'OpenBusinessDay',
          values: { ...base, businessDayId, expectedVersion: day?.version ?? 0 },
          subjectId: businessDayId,
        },
      };
    }
    return {
      stage: 0,
      title: 'Waiting for the day to be opened',
      detail: 'Ask a manager to open the day.',
      action: null,
    };
  }

  if (day.state !== 'OPEN') {
    // The day is shut, but its figures still need a manager's approval before they are final.
    const waiting = overview.reconciliations.filter((item) => WAITING.has(item.state));
    // Only what this person may approve is offered to them; the server works that out.
    const mine = waiting.filter((item) => item.youMayApprove === true);
    const first = mine[0];
    if (first) {
      const params = new URLSearchParams({ ...base, businessDayId: day.id });
      if (first.shiftId) params.set('shiftId', first.shiftId);
      return {
        stage: null,
        title: 'Today is closed. Approve the figures',
        detail:
          mine.length === 1
            ? 'One shift is waiting for approval.'
            : `${mine.length} shifts are waiting for approval.`,
        action: {
          kind: 'link',
          label:
            mine.length === 1
              ? 'Review the figures'
              : `Review the figures (${mine.length} waiting)`,
          href: `/operations/reconciliations/${first.id}/review?${params.toString()}`,
        },
      };
    }
    if (waiting.length > 0) {
      return {
        stage: null,
        title: 'Today is closed. Waiting for approval',
        detail: 'Nothing more for you to do.',
        action: null,
      };
    }
    const approved = overview.reconciliations.find((item) => item.state === 'APPROVED');
    if (approved) {
      return {
        stage: null,
        title: 'Today is closed and approved',
        detail: 'The daily report is ready.',
        action: {
          kind: 'link',
          label: 'Open the daily report',
          href: `/operations/reconciliations/${approved.id}/report?${new URLSearchParams(base).toString()}`,
        },
      };
    }
    return {
      stage: null,
      title: 'Today is closed',
      detail: 'Nothing more to do.',
      action: null,
    };
  }

  const shifts = [...overview.shifts].sort((a, b) =>
    a.plannedStartAt.localeCompare(b.plannedStartAt),
  );
  const timezone = overview.station.timezone;
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
        stage: 1,
        title: 'Fix and resubmit the figures',
        detail: `The ${timeRange(shift.plannedStartAt, shift.plannedEndAt, timezone)} shift was sent back for changes.`,
        action: {
          kind: 'link',
          label: 'Fix and resubmit',
          href: dayParams(shift.id, reconciliation.id),
        },
      };
    }
  }

  const open = shifts.find((shift) => shift.state === 'OPEN');
  if (open) {
    const range = timeRange(open.plannedStartAt, open.plannedEndAt, timezone);
    const reconciliation = reconciliationOf(open.id);
    if (!reconciliation || reconciliation.state === 'DRAFT') {
      return {
        stage: 1,
        title: reconciliation ? 'Continue entering the figures' : 'Enter the shift figures',
        detail: `Pump readings, payments, expenses and cash.`,
        action: {
          kind: 'link',
          label: reconciliation ? 'Continue' : 'Start entering figures',
          href: dayParams(open.id, reconciliation?.id),
        },
      };
    }
    if (actions.CloseMeters.canExecute) {
      const detail = WAITING.has(reconciliation.state)
        ? `Figures are with a manager. Close the shift after the last sale.`
        : `Figures are in. Close the shift after the last sale.`;
      // One button for the person: the meters are closed, then the shift is completed.
      if (actions.CompleteShift.canExecute) {
        return {
          stage: 2,
          title: 'Close the shift',
          detail,
          action: closeShiftAction(open, shiftValues),
        };
      }
      return {
        stage: 2,
        title: 'Close the shift',
        detail,
        action: {
          kind: 'command',
          label: 'Close Shift',
          commandType: 'CloseMeters',
          values: shiftValues(open),
          subjectId: open.id,
          confirm: CLOSE_SHIFT_CONFIRM,
        },
      };
    }
    return {
      stage: 2,
      title: 'Waiting for the shift to be closed',
      detail: 'A manager closes this shift.',
      action: null,
    };
  }

  const meterClosed = shifts.find((shift) => shift.state === 'METER_CLOSED');
  if (meterClosed && actions.CompleteShift.canExecute) {
    return {
      stage: 2,
      title: 'Close the shift',
      detail: 'One more step finishes it.',
      action: {
        kind: 'command',
        label: 'Close Shift',
        commandType: 'CompleteShift',
        values: shiftValues(meterClosed),
        subjectId: meterClosed.id,
        confirm: CLOSE_SHIFT_CONFIRM,
      },
    };
  }

  const planned = shifts.find((shift) => shift.state === 'PLANNED');
  if (planned) {
    const range = timeRange(planned.plannedStartAt, planned.plannedEndAt, timezone);
    if (actions.StartShift.canExecute) {
      return {
        stage: 0,
        title: `Start the ${range} shift`,
        detail: 'Start it before the first sale.',
        action: {
          kind: 'command',
          label: 'Start shift',
          commandType: 'StartShift',
          values: {
            ...shiftValues(planned),
            plannedStartAt: planned.plannedStartAt,
            plannedEndAt: planned.plannedEndAt,
          },
          subjectId: planned.id,
        },
      };
    }
    return {
      stage: 0,
      title: 'Waiting for the shift to start',
      detail: 'You cannot start this shift.',
      action: null,
    };
  }

  const allDone = shifts.length > 0 && shifts.every((shift) => shift.state === 'COMPLETED');
  const due = actions.StartShift.canExecute ? dueShift(overview, day.date, now) : null;
  // Closing before any figures are approved is allowed, but the person must say why.
  const approvedFigures = overview.reconciliations.some((item) =>
    ['APPROVED', 'POSTED', 'LOCKED'].includes(item.state),
  );
  const closeDay: Extract<StepAction, { kind: 'command' }> = {
    kind: 'command',
    label: 'Close business day',
    commandType: 'CloseBusinessDay',
    values: { ...base, businessDayId: day.id, expectedVersion: day.version },
    subjectId: day.id,
    confirm: 'Close the business day? No more shifts can be opened for it afterwards.',
    ...(approvedFigures
      ? {}
      : {
          askReason: {
            field: 'reasonWithoutReconciliation',
            question:
              'No figures are approved yet. Why is the day being closed now? The reason is kept in the activity log.',
          },
        }),
  };
  if (allDone && due?.openNow) {
    return {
      stage: 0,
      title: openShiftLabel(due.name),
      detail: `Due at ${due.startTime}. No more shifts today? Close the day instead.`,
      action: openShiftAction(base, day.id, due, newId),
    };
  }
  if (allDone && due && actions.CloseBusinessDay.canExecute) {
    return {
      stage: 3,
      title: `Next: the ${shiftName(due.name)} at ${due.startTime}`,
      detail: `Opens at ${stationClock(shiftOpensAt(due.startsAt), overview.station.timezone)}. Close the day only if no more shifts will run.`,
      action: closeDay,
    };
  }
  if (allDone && actions.CloseBusinessDay.canExecute) {
    return {
      stage: 3,
      title: 'Close the business day',
      detail: 'Every shift is complete.',
      action: closeDay,
    };
  }

  if (shifts.length === 0) {
    if (actions.StartShift.canExecute) {
      if (due) {
        return {
          stage: 0,
          title: due.openNow ? openShiftLabel(due.name) : `Waiting for the ${shiftName(due.name)}`,
          detail: due.openNow
            ? 'Start it before the first sale.'
            : `Opens at ${stationClock(shiftOpensAt(due.startsAt), overview.station.timezone)}.`,
          action: due.openNow ? openShiftAction(base, day.id, due, newId) : null,
        };
      }
      return NO_SCHEDULE;
    }
    return {
      stage: 0,
      title: 'No shift has been started',
      detail: 'Ask a manager to start one.',
      action: null,
    };
  }

  return {
    stage: null,
    title: 'You are all caught up',
    detail: 'Nothing to do right now.',
    action: null,
  };
}

export type StepAction = NonNullable<NextStep['action']>;

/** What each step of the day would do if pressed now; null when it cannot be done yet (or is already done). */
export function trailActions(
  overview: StepOverview,
  context: StepContext,
  newId: () => string,
  now: Date = new Date(),
): ReadonlyArray<StepAction | null> {
  const { actions } = overview;
  const day = overview.selectedBusinessDay;
  const base = { tenantId: context.tenantId, stationId: context.stationId };
  const none: Array<StepAction | null> = [null, null, null, null];

  if (!day || day.state === 'NOT_STARTED') {
    none[0] = firstShiftOfDay(overview, base, newId, now)?.action ?? null;
    return none;
  }
  if (day.state !== 'OPEN') return none;

  const shifts = [...overview.shifts].sort((a, b) =>
    a.plannedStartAt.localeCompare(b.plannedStartAt),
  );
  const shiftValues = (shift: StepOverview['shifts'][number]) => ({
    ...base,
    businessDayId: day.id,
    shiftId: shift.id,
    expectedVersion: shift.version,
  });
  const reconciliationOf = (shiftId: string) =>
    overview.reconciliations.find((item) => item.shiftId === shiftId);

  const planned = shifts.find((shift) => shift.state === 'PLANNED');
  if (planned && actions.StartShift.canExecute) {
    none[0] = {
      kind: 'command',
      label: 'Start shift',
      commandType: 'StartShift',
      values: {
        ...shiftValues(planned),
        plannedStartAt: planned.plannedStartAt,
        plannedEndAt: planned.plannedEndAt,
      },
      subjectId: planned.id,
    };
  }

  if (actions.StartShift.canExecute && !planned) {
    const due = dueShift(overview, day.date, now);
    if (due?.openNow) none[0] = openShiftAction(base, day.id, due, newId);
  }

  const open = shifts.find((shift) => shift.state === 'OPEN');
  if (open) {
    const reconciliation = reconciliationOf(open.id);
    const params = new URLSearchParams({ ...base, businessDayId: day.id, shiftId: open.id });
    if (reconciliation) params.set('reconciliationId', reconciliation.id);
    none[1] = {
      kind: 'link',
      label: 'Enter figures',
      href: `/operations/daily?${params.toString()}`,
    };
    if (reconciliation && reconciliation.state !== 'DRAFT' && actions.CloseMeters.canExecute) {
      none[2] = actions.CompleteShift.canExecute
        ? closeShiftAction(open, shiftValues)
        : {
            kind: 'command',
            label: 'Close Shift',
            commandType: 'CloseMeters',
            values: shiftValues(open),
            subjectId: open.id,
            confirm: CLOSE_SHIFT_CONFIRM,
          };
    }
  }

  const meterClosed = shifts.find((shift) => shift.state === 'METER_CLOSED');
  if (meterClosed && actions.CompleteShift.canExecute) {
    none[2] = {
      kind: 'command',
      label: 'Close Shift',
      commandType: 'CompleteShift',
      values: shiftValues(meterClosed),
      subjectId: meterClosed.id,
      confirm: CLOSE_SHIFT_CONFIRM,
    };
  }

  if (
    shifts.length > 0 &&
    shifts.every((shift) => shift.state === 'COMPLETED') &&
    actions.CloseBusinessDay.canExecute
  ) {
    none[3] = {
      kind: 'command',
      label: 'Close business day',
      commandType: 'CloseBusinessDay',
      values: { ...base, businessDayId: day.id, expectedVersion: day.version },
      subjectId: day.id,
      confirm: 'Close this business day? Every operated shift must have complete meter readings.',
    };
  }
  return none;
}
