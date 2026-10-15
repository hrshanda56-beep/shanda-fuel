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
  it('opens the day first, with a fresh id when none exists', () => {
    const result = step({ selectedBusinessDay: undefined });
    expect(result.stage).toBe(0);
    expect(result.action).toMatchObject({
      kind: 'command',
      commandType: 'OpenBusinessDay',
      values: { businessDayId: 'new-id', expectedVersion: 0 },
    });
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
    expect(result.stage).toBe(1);
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

  it('closes meters once figures are submitted, asking first', () => {
    const result = step({
      shifts: [shift('OPEN')],
      reconciliations: [{ id: 'r1', shiftId: 'sh', state: 'SUBMITTED' }],
    });
    expect(result.action).toMatchObject({ commandType: 'CloseMeters' });
    expect((result.action as { confirm?: string }).confirm).toBeTruthy();
  });

  it('closes the day when every shift is complete', () => {
    const result = step({ shifts: [shift('COMPLETED')] });
    expect(result.stage).toBe(4);
    expect(result.action).toMatchObject({ commandType: 'CloseBusinessDay' });
  });

  it('says so when the day is already closed', () => {
    const result = step({
      selectedBusinessDay: { id: 'd', date: '2026-10-15', state: 'CLOSED', version: 5 },
    });
    expect(result.stage).toBeNull();
    expect(result.action).toBeNull();
  });
});
