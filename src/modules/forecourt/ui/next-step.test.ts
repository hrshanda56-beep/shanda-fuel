import { describe, expect, it } from 'vitest';

import { nextStep, trailActions, TRAIL, type StationSetup, type StepOverview } from './next-step';

const ctx = { tenantId: 't', stationId: 's' };
const allowed = { canExecute: true };
const base: StepOverview = {
  currentBusinessDate: '2026-10-15',
  station: { timezone: 'Africa/Harare', name: 'Dev Station' },
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
  plannedStartAt: '2026-10-15T04:00:00Z',
  plannedEndAt: '2026-10-15T12:00:00Z',
  version: 3,
});
const step = (o: Partial<StepOverview>, setup: StationSetup = null) =>
  nextStep({ ...base, ...o }, ctx, () => 'new-id', setup);

describe('nextStep', () => {
  it('puts closing the shift before entering the figures', () => {
    expect(TRAIL).toEqual(['Open day', 'Start shift', 'Close shift', 'Enter figures', 'Close day']);
  });

  it('opens the day first, with a fresh id and a confirmation', () => {
    const result = step({ selectedBusinessDay: undefined });
    expect(result.stage).toBe(0);
    expect(result.action).toMatchObject({
      kind: 'command',
      commandType: 'OpenBusinessDay',
      values: { businessDayId: 'new-id', expectedVersion: 0 },
      confirm: { title: 'Open business day?', confirmLabel: 'Open day' },
      success: 'Business day opened',
    });
  });

  it('hides the action when the supervisor cannot open the day', () => {
    const result = step({
      selectedBusinessDay: undefined,
      actions: { ...base.actions, OpenBusinessDay: { canExecute: false } },
    });
    expect(result.action).toBeNull();
  });

  it('starts a planned shift with its own version and names it by time of day', () => {
    const result = step({ shifts: [shift('PLANNED')] });
    expect(result.stage).toBe(1);
    expect(result.title).toContain('Morning · 06:00–14:00');
    expect(result.action).toMatchObject({
      commandType: 'StartShift',
      values: { shiftId: 'sh', expectedVersion: 3, businessDayId: 'd' },
      confirm: { title: 'Start shift?' },
    });
  });

  it('explains why a shift cannot start when the station has no pumps or attendants', () => {
    const result = step({ shifts: [] }, { hasPumps: false, hasAttendants: true });
    expect(result.action).toMatchObject({ kind: 'blocked', label: 'Start shift' });
    expect((result.action as { reason: string }).reason).toContain('Settings');
  });

  it('offers the new-shift form when the station is ready', () => {
    const result = step({ shifts: [] }, { hasPumps: true, hasAttendants: true });
    expect(result.action).toMatchObject({ kind: 'newShift' });
  });

  it('closes the meters of an open shift before any figures', () => {
    const result = step({ shifts: [shift('OPEN')] });
    expect(result.stage).toBe(2);
    expect(result.action).toMatchObject({ kind: 'closeMeters', shiftId: 'sh', version: 3 });
  });

  it('closes meters first even if a draft already exists', () => {
    const result = step({
      shifts: [shift('OPEN')],
      reconciliations: [{ id: 'r1', shiftId: 'sh', state: 'DRAFT' }],
    });
    expect(result.stage).toBe(2);
    expect(result.action).toMatchObject({ kind: 'closeMeters' });
  });

  it('finishes closing a shift whose meters are closed', () => {
    const result = step({ shifts: [shift('METER_CLOSED')] });
    expect(result.stage).toBe(2);
    expect(result.action).toMatchObject({ commandType: 'CompleteShift', success: 'Shift closed' });
  });

  it('sends a closed shift without a reconciliation straight to figure entry', () => {
    const result = step({ shifts: [shift('COMPLETED')] });
    expect(result.stage).toBe(3);
    expect(result.action).toMatchObject({ kind: 'link', label: 'Start entering figures' });
    expect((result.action as { href: string }).href).toContain('shiftId=sh');
  });

  it('continues an existing draft by its id', () => {
    const result = step({
      shifts: [shift('COMPLETED')],
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

  it('waits for approval once the figures are submitted', () => {
    const result = step({
      shifts: [shift('COMPLETED')],
      reconciliations: [{ id: 'r1', shiftId: 'sh', state: 'SUBMITTED' }],
    });
    expect(result.title).toBe('Waiting for a manager to approve');
    expect(result.action).toBeNull();
  });

  it('asks for the missing figures before the day can close', () => {
    const result = step({
      shifts: [shift('COMPLETED', 'a'), shift('COMPLETED', 'b')],
      reconciliations: [
        { id: 'r1', shiftId: 'a', state: 'APPROVED' },
        { id: 'r2', shiftId: 'b', state: 'APPROVED' },
      ].slice(0, 1),
    });
    // The second shift has no reconciliation yet, so figures come first.
    expect(result.stage).toBe(3);
  });

  it('closes the day only when every shift is closed and every reconciliation approved', () => {
    const result = step({
      shifts: [shift('COMPLETED')],
      reconciliations: [{ id: 'r1', shiftId: 'sh', state: 'APPROVED' }],
    });
    expect(result.stage).toBe(4);
    expect(result.action).toMatchObject({
      commandType: 'CloseBusinessDay',
      confirm: { title: 'Close business day?', confirmLabel: 'Close day' },
    });
  });

  it('says so when the day is already closed', () => {
    const result = step({
      selectedBusinessDay: { id: 'd', date: '2026-10-15', state: 'CLOSED', version: 5 },
    });
    expect(result.stage).toBeNull();
    expect(result.action).toBeNull();
  });
});

describe('trailActions', () => {
  it('only lets the step that is due be pressed', () => {
    const actions = trailActions({ ...base, shifts: [shift('OPEN')] }, ctx, () => 'x');
    expect(actions[2]).toMatchObject({ kind: 'closeMeters' });
    expect(actions[0]).toBeNull();
    expect(actions[3]).toBeNull();
    expect(actions[4]).toBeNull();
  });
});
