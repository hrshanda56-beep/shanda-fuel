import { describe, expect, it } from 'vitest';

import { nextStep, type StepOverview } from './next-step';

const ctx = { tenantId: 't', stationId: 's' };
const allowed = { canExecute: true };
const base: StepOverview = {
  currentBusinessDate: '2026-10-15',
  station: { timezone: 'Africa/Harare' },
  selectedBusinessDay: { id: 'd', date: '2026-10-15', state: 'OPEN', version: 2 },
  shifts: [],
  reconciliations: [],
  actions: {
    OpenBusinessDay: allowed,
    CloseBusinessDay: allowed,
    StartShift: allowed,
    CloseMeters: allowed,
    CompleteShift: allowed,
  },
};
const shift = (state: string, id = 'sh') => ({
  id,
  state,
  plannedStartAt: '2026-10-15T06:00:00Z',
  plannedEndAt: '2026-10-15T14:00:00Z',
  version: 3,
});
const step = (o: Partial<StepOverview>) => nextStep({ ...base, ...o }, ctx, () => 'new-id');

describe('nextStep', () => {
  it('never asks for a start time or length: with no schedule it offers nothing to fill in', () => {
    const result = step({ selectedBusinessDay: undefined });
    expect(result.title).toBe('No shift schedule');
    expect(result.action).toBeNull();
    const open = step({ shifts: [] });
    expect(open.title).toBe('No shift schedule');
    expect(open.action).toBeNull();
  });

  it('only opens the day when the person cannot start a shift', () => {
    const result = step({
      selectedBusinessDay: undefined,
      actions: { ...base.actions, StartShift: { canExecute: false } },
    });
    expect(result.action).toMatchObject({ kind: 'command', commandType: 'OpenBusinessDay' });
  });

  it('waits when the supervisor cannot open the day', () => {
    const result = step({
      selectedBusinessDay: undefined,
      actions: { ...base.actions, OpenBusinessDay: { canExecute: false } },
    });
    expect(result.action).toBeNull();
  });

  it('starts a planned shift with its own version', () => {
    const result = step({ shifts: [shift('PLANNED')] });
    expect(result.stage).toBe(0);
    expect(result.action).toMatchObject({
      commandType: 'StartShift',
      values: { shiftId: 'sh', expectedVersion: 3, businessDayId: 'd' },
    });
  });

  it('sends an open shift without a reconciliation to figure entry', () => {
    const result = step({ shifts: [shift('OPEN')] });
    expect(result.action).toMatchObject({ kind: 'link' });
    expect((result.action as { href: string }).href).toContain('shiftId=sh');
  });

  it('continues an existing draft by its id', () => {
    const result = step({
      shifts: [shift('OPEN')],
      reconciliations: [{ id: 'r1', shiftId: 'sh', state: 'DRAFT' }],
    });
    expect((result.action as { href: string }).href).toContain('reconciliationId=r1');
  });

  it('puts a returned reconciliation ahead of everything else', () => {
    const result = step({
      shifts: [shift('PLANNED', 'a'), shift('OPEN', 'b')],
      reconciliations: [{ id: 'r9', shiftId: 'b', state: 'RETURNED' }],
    });
    expect(result.title).toBe('Fix and resubmit the figures');
  });

  it('offers one Close Shift button once figures are submitted, asking first', () => {
    const result = step({
      shifts: [shift('OPEN')],
      reconciliations: [{ id: 'r1', shiftId: 'sh', state: 'SUBMITTED' }],
    });
    expect(result.title).toBe('Close the shift');
    // The meters are closed first; that raises the shift's version, which the second step expects.
    expect(result.action).toMatchObject({
      kind: 'command',
      label: 'Close Shift',
      commandType: 'CompleteShift',
      values: { shiftId: 'sh', expectedVersion: 4 },
      before: { commandType: 'CloseMeters', values: { shiftId: 'sh', expectedVersion: 3 } },
    });
    expect((result.action as { confirm?: string }).confirm).toContain('Close this shift?');
  });

  it('offers only the meters step under the Close Shift label when the person may not complete the shift', () => {
    const result = step({
      shifts: [shift('OPEN')],
      reconciliations: [{ id: 'r1', shiftId: 'sh', state: 'SUBMITTED' }],
      actions: { ...base.actions, CompleteShift: { canExecute: false } },
    });
    expect(result.action).toMatchObject({ label: 'Close Shift', commandType: 'CloseMeters' });
    expect((result.action as { before?: unknown }).before).toBeUndefined();
  });

  it('finishes a shift whose meters are already closed with the same Close Shift button', () => {
    const result = step({ shifts: [shift('METER_CLOSED')] });
    expect(result.action).toMatchObject({
      label: 'Close Shift',
      commandType: 'CompleteShift',
      values: { expectedVersion: 3 },
    });
    expect((result.action as { before?: unknown }).before).toBeUndefined();
  });

  it('closes the day when every shift is complete', () => {
    const result = step({ shifts: [shift('COMPLETED')] });
    expect(result.stage).toBe(3);
    expect(result.action).toMatchObject({ commandType: 'CloseBusinessDay' });
  });

  it('asks why before closing a day whose figures are not approved yet, and not once they are', () => {
    const waiting = step({
      shifts: [shift('COMPLETED')],
      reconciliations: [{ id: 'r1', shiftId: 'sh', state: 'PENDING_APPROVAL' }],
    });
    expect(waiting.action).toMatchObject({
      commandType: 'CloseBusinessDay',
      askReason: { field: 'reasonWithoutReconciliation' },
    });
    const approved = step({
      shifts: [shift('COMPLETED')],
      reconciliations: [{ id: 'r1', shiftId: 'sh', state: 'APPROVED' }],
    });
    expect((approved.action as { askReason?: unknown }).askReason).toBeUndefined();
  });

  it('says so when the day is already closed', () => {
    const result = step({
      selectedBusinessDay: { id: 'd', date: '2026-10-15', state: 'CLOSED', version: 5 },
    });
    expect(result.stage).toBeNull();
    expect(result.action).toBeNull();
  });

  const closedDay = { id: 'd', date: '2026-10-15', state: 'CLOSED', version: 5 };

  it('after closing, sends the person to approve figures that are still waiting', () => {
    const result = step({
      selectedBusinessDay: closedDay,
      reconciliations: [
        { id: 'r1', shiftId: 'a', state: 'APPROVED' },
        { id: 'r2', shiftId: 'b', state: 'PENDING_APPROVAL', youMayApprove: true },
        { id: 'r3', shiftId: 'c', state: 'SUBMITTED', youMayApprove: true },
      ],
    });
    expect(result.title).toContain('Approve the figures');
    expect(result.detail).toContain('2 shifts');
    expect((result.action as { href: string }).href).toContain(
      '/operations/reconciliations/r2/review',
    );
  });

  it('after closing, offers no review button to someone who may not approve', () => {
    const result = step({
      selectedBusinessDay: closedDay,
      reconciliations: [
        { id: 'r2', shiftId: 'b', state: 'SUBMITTED', youMayApprove: false },
        { id: 'r3', shiftId: 'c', state: 'SUBMITTED' },
      ],
    });
    expect(result.title).toBe('Today is closed. Waiting for approval');
    expect(result.action).toBeNull();
  });

  it('after closing, only counts what this person may approve', () => {
    const result = step({
      selectedBusinessDay: closedDay,
      reconciliations: [
        { id: 'r2', shiftId: 'b', state: 'SUBMITTED', youMayApprove: false },
        { id: 'r3', shiftId: 'c', state: 'SUBMITTED', youMayApprove: true },
      ],
    });
    expect(result.detail).toContain('One shift');
    expect((result.action as { href: string }).href).toContain('/reconciliations/r3/review');
  });

  it('after closing with everything approved, points to the daily report', () => {
    const result = step({
      selectedBusinessDay: closedDay,
      reconciliations: [{ id: 'r1', shiftId: 'a', state: 'APPROVED' }],
    });
    expect(result.title).toBe('Today is closed and approved');
    expect((result.action as { href: string }).href).toContain(
      '/operations/reconciliations/r1/report',
    );
  });
});

describe('nextStep with scheduled shifts', () => {
  // Harare is UTC+2: the Day shift starts 06:00 (04:00Z), the Night shift 18:00 (16:00Z).
  const templates = [
    { id: 'night', name: 'Night', startTime: '18:00:00', durationMinutes: 720 },
    { id: 'day', name: 'Day', startTime: '06:00:00', durationMinutes: 720 },
  ];
  const at = (time: string) => new Date(`2026-10-15T${time}Z`);
  const run = (o: Partial<StepOverview>, now: Date) =>
    nextStep({ ...base, shiftTemplates: templates, ...o }, ctx, () => 'new-id', now);
  const dayDone = { ...shift('COMPLETED', 'd1'), shiftTemplateId: 'day' };

  it('opens the due scheduled shift by its template, never a free-form one', () => {
    const result = run({ shifts: [] }, at('04:10'));
    expect(result.action).toMatchObject({
      commandType: 'StartShift',
      values: { shiftTemplateId: 'day', plannedStartAt: '2026-10-15T04:00:00.000Z' },
    });
  });

  it('does not say "shift" twice when the template name already ends in it', () => {
    const named = [{ id: 'day', name: 'Day shift', startTime: '06:00:00', durationMinutes: 720 }];
    const result = run({ shifts: [], shiftTemplates: named }, at('04:10'));
    expect(result.title).toBe('Open Day Shift');
    expect((result.action as { label: string }).label).toBe('Open Day Shift');
  });

  it('opens the day together with the first scheduled shift', () => {
    const result = run({ selectedBusinessDay: undefined, shifts: [] }, at('04:10'));
    expect(result.action).toMatchObject({
      commandType: 'StartShift',
      values: { shiftTemplateId: 'day' },
      before: { commandType: 'OpenBusinessDay' },
    });
  });

  it('waits, without a button, before the first shift of an unopened day is due', () => {
    const result = run({ selectedBusinessDay: undefined, shifts: [] }, at('01:00'));
    expect(result.title).toBe('Waiting for the Day shift');
    expect(result.action).toBeNull();
  });

  it('waits, without a button, before the first shift is due', () => {
    const result = run({ shifts: [] }, at('01:00'));
    expect(result.title).toBe('Waiting for the Day shift');
    expect(result.action).toBeNull();
  });

  it('opens a shift up to 30 minutes early, and not before', () => {
    expect(run({ shifts: [] }, at('03:31')).action).toMatchObject({ commandType: 'StartShift' });
    expect(run({ shifts: [] }, at('03:29')).action).toBeNull();
  });

  it('offers the next shift once the earlier one is complete and the next is due', () => {
    const result = run({ shifts: [dayDone] }, at('16:05'));
    expect(result.title).toBe('Open Night Shift');
    expect(result.action).toMatchObject({
      commandType: 'StartShift',
      values: { shiftTemplateId: 'night', expectedVersion: 0 },
    });
  });

  it('does not offer to close the day as the only choice while a shift is still to come', () => {
    const result = run({ shifts: [dayDone] }, at('12:00'));
    expect(result.title).toContain('Night shift at 18:00');
    expect(result.detail).toContain('17:30');
    expect(result.detail).toContain('only if no more shifts will run');
    expect(result.action).toMatchObject({ commandType: 'CloseBusinessDay' });
    expect((result.action as { confirm?: string }).confirm).toContain('No more shifts');
  });

  it('closes the day plainly once every scheduled shift has been opened and completed', () => {
    const nightDone = { ...shift('COMPLETED', 'd2'), shiftTemplateId: 'night' };
    const result = run({ shifts: [dayDone, nightDone] }, at('17:00'));
    expect(result.title).toBe('Close the business day');
  });

  it('never offers to open a shift to someone who may not start one', () => {
    const result = run(
      { shifts: [dayDone], actions: { ...base.actions, StartShift: { canExecute: false } } },
      at('16:05'),
    );
    expect(result.action).toMatchObject({ commandType: 'CloseBusinessDay' });
  });
});
