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

/** Where the person is in the day: open the day, start a shift, enter figures, close the shift, close the day. */
export const TRAIL = [
  'Open day',
  'Start shift',
  'Enter figures',
  'Close shift',
  'Close day',
] as const;

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
      }>
    | Readonly<{ kind: 'link'; label: string; href: string }>
    /** No shift exists yet: StartShift creates one from a start time and a length. */
    | Readonly<{ kind: 'newShift'; label: string; values: Record<string, unknown> }>
    | null;
}>;

function timeRange(start: string, end: string, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  });
  return `${formatter.format(new Date(start))} – ${formatter.format(new Date(end))}`;
}

function newShiftAction(
  base: Record<string, string>,
  businessDayId: string,
  newId: () => string,
): StepAction {
  return {
    kind: 'newShift',
    label: 'Start a shift',
    values: { ...base, businessDayId, shiftId: newId(), expectedVersion: 0 },
  };
}

const WAITING = new Set(['SUBMITTED', 'PENDING_APPROVAL']);

/**
 * The single thing a supervisor should do next, worked out only from states the
 * server returned. It never changes anything by itself; the action it names is a
 * normal command (or a link) that the server authorises again.
 */
export function nextStep(
  overview: StepOverview,
  context: StepContext,
  newId: () => string,
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
        stage: 2,
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
        stage: 2,
        title: reconciliation ? 'Continue entering the figures' : 'Enter the shift figures',
        detail: `Pump readings, payments, expenses and cash for the ${range} shift.`,
        action: {
          kind: 'link',
          label: reconciliation ? 'Continue' : 'Start entering figures',
          href: dayParams(open.id, reconciliation?.id),
        },
      };
    }
    if (actions.CloseMeters.canExecute) {
      return {
        stage: 3,
        title: 'Close the shift meters',
        detail: WAITING.has(reconciliation.state)
          ? `Figures for the ${range} shift are with a manager for review. Close the meters to finish the shift.`
          : `Figures for the ${range} shift are in. Close the meters to finish the shift.`,
        action: {
          kind: 'command',
          label: 'Close meters',
          commandType: 'CloseMeters',
          values: shiftValues(open),
          subjectId: open.id,
          confirm: 'Close meters for this shift? Meter readings must already be complete.',
        },
      };
    }
    return {
      stage: 3,
      title: 'Waiting for the shift to be closed',
      detail: 'A manager closes the meters for this shift.',
      action: null,
    };
  }

  const meterClosed = shifts.find((shift) => shift.state === 'METER_CLOSED');
  if (meterClosed && actions.CompleteShift.canExecute) {
    return {
      stage: 3,
      title: 'Complete the shift',
      detail: `Meters are closed for the ${timeRange(meterClosed.plannedStartAt, meterClosed.plannedEndAt, timezone)} shift.`,
      action: {
        kind: 'command',
        label: 'Complete shift',
        commandType: 'CompleteShift',
        values: shiftValues(meterClosed),
        subjectId: meterClosed.id,
        confirm: 'Complete this shift? This records the close boundary as complete.',
      },
    };
  }

  const planned = shifts.find((shift) => shift.state === 'PLANNED');
  if (planned) {
    const range = timeRange(planned.plannedStartAt, planned.plannedEndAt, timezone);
    if (actions.StartShift.canExecute) {
      return {
        stage: 1,
        title: `Start the ${range} shift`,
        detail: 'Do this when the shift begins, before the first sale.',
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
      stage: 1,
      title: 'Waiting for the shift to start',
      detail: 'You do not have permission to start this shift.',
      action: null,
    };
  }

  const allDone = shifts.length > 0 && shifts.every((shift) => shift.state === 'COMPLETED');
  if (allDone && actions.CloseBusinessDay.canExecute) {
    return {
      stage: 4,
      title: 'Close the business day',
      detail: 'Every shift is complete. Close the day to finish.',
      action: {
        kind: 'command',
        label: 'Close business day',
        commandType: 'CloseBusinessDay',
        values: { ...base, businessDayId: day.id, expectedVersion: day.version },
        subjectId: day.id,
        confirm: 'Close this business day? Every operated shift must have complete meter readings.',
      },
    };
  }

  if (shifts.length === 0) {
    if (actions.StartShift.canExecute) {
      return {
        stage: 1,
        title: 'Start today’s shift',
        detail:
          'Choose when the shift starts and how long it runs. You can then enter the figures.',
        action: newShiftAction(base, day.id, newId),
      };
    }
    return {
      stage: 1,
      title: 'No shift has been started',
      detail: 'You do not have permission to start a shift. Ask a manager.',
      action: null,
    };
  }

  return {
    stage: null,
    title: 'You are all caught up',
    detail: 'Nothing needs you right now.',
    action: null,
  };
}

export type StepAction = NonNullable<NextStep['action']>;

/** What each step of the day would do if pressed now; null when it cannot be done yet (or is already done). */
export function trailActions(
  overview: StepOverview,
  context: StepContext,
  newId: () => string,
): ReadonlyArray<StepAction | null> {
  const { actions } = overview;
  const day = overview.selectedBusinessDay;
  const base = { tenantId: context.tenantId, stationId: context.stationId };
  const none: Array<StepAction | null> = [null, null, null, null, null];

  if (!day || day.state === 'NOT_STARTED') {
    if (actions.OpenBusinessDay.canExecute) {
      const businessDayId = day?.id ?? newId();
      none[0] = {
        kind: 'command',
        label: 'Open business day',
        commandType: 'OpenBusinessDay',
        values: { ...base, businessDayId, expectedVersion: day?.version ?? 0 },
        subjectId: businessDayId,
      };
    }
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
    none[1] = {
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

  if (shifts.length === 0 && actions.StartShift.canExecute) {
    none[1] = newShiftAction(base, day.id, newId);
  }

  const open = shifts.find((shift) => shift.state === 'OPEN');
  if (open) {
    const reconciliation = reconciliationOf(open.id);
    const params = new URLSearchParams({ ...base, businessDayId: day.id, shiftId: open.id });
    if (reconciliation) params.set('reconciliationId', reconciliation.id);
    none[2] = {
      kind: 'link',
      label: 'Enter figures',
      href: `/operations/daily?${params.toString()}`,
    };
    if (reconciliation && reconciliation.state !== 'DRAFT' && actions.CloseMeters.canExecute) {
      none[3] = {
        kind: 'command',
        label: 'Close meters',
        commandType: 'CloseMeters',
        values: shiftValues(open),
        subjectId: open.id,
        confirm: 'Close meters for this shift? Meter readings must already be complete.',
      };
    }
  }

  const meterClosed = shifts.find((shift) => shift.state === 'METER_CLOSED');
  if (meterClosed && actions.CompleteShift.canExecute) {
    none[3] = {
      kind: 'command',
      label: 'Complete shift',
      commandType: 'CompleteShift',
      values: shiftValues(meterClosed),
      subjectId: meterClosed.id,
      confirm: 'Complete this shift? This records the close boundary as complete.',
    };
  }

  if (
    shifts.length > 0 &&
    shifts.every((shift) => shift.state === 'COMPLETED') &&
    actions.CloseBusinessDay.canExecute
  ) {
    none[4] = {
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
