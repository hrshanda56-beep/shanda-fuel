import { describe, expect, it } from 'vitest';

import type { ConfigurationSetupOverview } from './contracts';
import {
  BLANK_ADD,
  BLANK_SINCE,
  NEW_PUMP,
  addSteps,
  checkMeter,
  checkNewPump,
  checkNozzleNumber,
  checkPumpPick,
  checkRenumber,
  checkSinceDate,
  checkSincePick,
  checkWhen,
  isCalendarDay,
  nextNumber,
  planAddNozzle,
  planDeleteNozzle,
  planDeletePump,
  planRetireNozzle,
  planRetirePump,
  planRenumber,
  planSince,
  pumpLabel,
  renumberFrom,
  renumberIsUnchanged,
  type AddAnswers,
} from './pump-wizard';
import { applyStaged, describeStaged, isStandIn } from './staged-changes';

const add = (patch: Partial<AddAnswers>): AddAnswers => ({ ...BLANK_ADD, ...patch });
const where = { tenantId: 't', stationId: 's' };

describe('numbers', () => {
  it('suggests the next whole number', () => {
    expect(nextNumber([])).toBe('1');
    expect(nextNumber(['1', '2', '3'])).toBe('4');
    expect(nextNumber(['A', '7'])).toBe('8');
  });

  it('labels a pump with its name when it has one', () => {
    expect(pumpLabel({ number: '3', name: null })).toBe('Pump 3');
    expect(pumpLabel({ number: '3', name: 'Island 1' })).toBe('Pump 3 (Island 1)');
  });

  it('knows a real calendar day from a made-up one', () => {
    expect(isCalendarDay('2026-11-20')).toBe(true);
    expect(isCalendarDay('2026-02-30')).toBe(false);
    expect(isCalendarDay('20-11-2026')).toBe(false);
    expect(isCalendarDay('')).toBe(false);
  });
});

describe('adding a nozzle: the steps', () => {
  it('asks which pump only when the station has pumps', () => {
    expect(addSteps(add({}), true)).toEqual(['pump', 'nozzle', 'meter', 'when', 'review']);
    expect(addSteps(add({}), false)).toEqual(['newPump', 'nozzle', 'meter', 'when', 'review']);
  });

  it('asks for the new pump once "a new pump" is chosen', () => {
    expect(addSteps(add({ pump: NEW_PUMP }), true)).toEqual([
      'pump',
      'newPump',
      'nozzle',
      'meter',
      'when',
      'review',
    ]);
    expect(addSteps(add({ pump: 'p1' }), true)).not.toContain('newPump');
  });
});

describe('adding a nozzle: the checks', () => {
  it('needs a pump choice', () => {
    expect(checkPumpPick(add({}))).toHaveProperty('pump');
    expect(checkPumpPick(add({ pump: 'p1' }))).toEqual({});
  });

  it('keeps a new pump number unique and short', () => {
    expect(checkNewPump(add({ pumpNumber: '' }), [])).toHaveProperty('pumpNumber');
    expect(checkNewPump(add({ pumpNumber: '2' }), ['1', '2'])).toHaveProperty('pumpNumber');
    expect(checkNewPump(add({ pumpNumber: ' a ' }), ['A'])).toHaveProperty('pumpNumber');
    expect(checkNewPump(add({ pumpNumber: 'x'.repeat(17) }), [])).toHaveProperty('pumpNumber');
    expect(checkNewPump(add({ pumpNumber: '3', pumpName: 'x'.repeat(81) }), [])).toHaveProperty(
      'pumpName',
    );
    expect(checkNewPump(add({ pumpNumber: '3', pumpName: 'Island 1' }), ['1', '2'])).toEqual({});
  });

  it('keeps a nozzle number unique on its pump', () => {
    expect(checkNozzleNumber(add({ nozzleNumber: '' }), [])).toHaveProperty('nozzleNumber');
    expect(checkNozzleNumber(add({ nozzleNumber: '1' }), ['1', '2'])).toHaveProperty(
      'nozzleNumber',
    );
    expect(checkNozzleNumber(add({ nozzleNumber: '3' }), ['1', '2'])).toEqual({});
  });

  it('needs the meter serial number', () => {
    expect(checkMeter(add({ meter: '  ' }))).toHaveProperty('meter');
    expect(checkMeter(add({ meter: 'x'.repeat(81) }))).toHaveProperty('meter');
    expect(checkMeter(add({ meter: 'M-100' }))).toEqual({});
  });

  it('needs the day only for a meter fitted earlier', () => {
    expect(checkWhen(add({}))).toHaveProperty('since');
    expect(checkWhen(add({ since: 'today' }))).toEqual({});
    expect(checkWhen(add({ since: 'earlier' }))).toHaveProperty('sinceDate');
    expect(checkWhen(add({ since: 'earlier', sinceDate: '2026-11-01' }))).toEqual({});
  });
});

describe('adding a nozzle: the waiting changes', () => {
  const ready = { meter: ' M-100 ', nozzleNumber: ' 1 ', since: 'today' as const };

  it('adds a nozzle to a pump that exists', () => {
    const [nozzle, ...rest] = planAddNozzle({
      ...where,
      productId: 'ulp',
      answers: add({ ...ready, pump: 'pump-1' }),
    });
    expect(rest).toEqual([]);
    expect(nozzle!.body).toEqual({
      commandType: 'CreateNozzle',
      ...where,
      pumpId: 'pump-1',
      number: '1',
      productId: 'ulp',
      meterSerialNumber: 'M-100',
    });
  });

  it('adds a new pump first, and the nozzle points at it', () => {
    const changes = planAddNozzle({
      ...where,
      productId: 'ulp',
      answers: add({ ...ready, pump: NEW_PUMP, pumpNumber: '3', pumpName: ' Island 1 ' }),
    });
    expect(changes.map((c) => c.body.commandType)).toEqual(['CreatePump', 'CreateNozzle']);
    expect(changes[0]!.body).toMatchObject({ number: '3', name: 'Island 1' });
    expect(isStandIn(changes[0]!.standIn)).toBe(true);
    expect(changes[1]!.body.pumpId).toBe(changes[0]!.standIn);
  });

  it('records an earlier meter day, and leaves the field out for today', () => {
    const earlier = planAddNozzle({
      ...where,
      productId: 'ulp',
      answers: add({ ...ready, pump: 'p', since: 'earlier', sinceDate: '2026-11-01' }),
    });
    expect(earlier[0]!.body.meterWorkingSinceDate).toBe('2026-11-01');
    const today = planAddNozzle({
      ...where,
      productId: 'ulp',
      answers: add({ ...ready, pump: 'p' }),
    });
    expect(today[0]!.body).not.toHaveProperty('meterWorkingSinceDate');
  });

  it('shows on the station as though saved, in plain words', () => {
    const base = {
      capabilities: { forecourt: true },
      products: [{ id: 'ulp', name: 'Unleaded', status: 'ACTIVE' }],
      pumps: [],
      nozzles: [],
    } as unknown as ConfigurationSetupOverview;
    const changes = planAddNozzle({
      ...where,
      productId: 'ulp',
      answers: add({ ...ready, pump: NEW_PUMP, pumpNumber: '3' }),
    });
    const shown = applyStaged(base, changes);
    expect((shown.pumps ?? []).map((p) => p.number)).toEqual(['3']);
    expect((shown.nozzles ?? []).map((n) => n.number)).toEqual(['1']);
    expect(describeStaged(changes[0]!, shown).title).toBe('Add pump 3');
    expect(describeStaged(changes[1]!, shown).title).toBe('Add nozzle 1 on pump 3');
  });
});

describe('changing numbers', () => {
  const pump = { id: 'p1', number: '1', name: null };
  const nozzles = [
    { id: 'a', number: '1' },
    { id: 'b', number: '2' },
  ];
  const from = () => renumberFrom(pump, nozzles);

  it('starts from what the pump has', () => {
    expect(from()).toEqual({
      pumpId: 'p1',
      pumpNumber: '1',
      pumpName: '',
      nozzles: { a: '1', b: '2' },
    });
  });

  it('refuses an empty or taken pump number', () => {
    expect(checkRenumber({ ...from(), pumpNumber: '' }, ['2'])).toHaveProperty('pumpNumber');
    expect(checkRenumber({ ...from(), pumpNumber: '2' }, ['2'])).toHaveProperty('pumpNumber');
    expect(checkRenumber(from(), ['2'])).toEqual({});
  });

  it('refuses two nozzles with one number, or a blank one', () => {
    const errors = checkRenumber({ ...from(), nozzles: { a: '2', b: '2' } }, []);
    expect(errors).toHaveProperty('nozzle-a');
    expect(errors).toHaveProperty('nozzle-b');
    expect(checkRenumber({ ...from(), nozzles: { a: '', b: '2' } }, [])).toHaveProperty('nozzle-a');
  });

  it('sends nothing for what did not change', () => {
    expect(planRenumber({ ...where, pump, nozzles, answers: from() })).toEqual([]);
    expect(renumberIsUnchanged({ pump, nozzles, answers: from() })).toBe(true);
    expect(renumberIsUnchanged({ pump, nozzles, answers: { ...from(), pumpNumber: '9' } })).toBe(
      false,
    );
  });

  it('changes only the pump, or only one nozzle', () => {
    const onlyPump = planRenumber({
      ...where,
      pump,
      nozzles,
      answers: { ...from(), pumpNumber: '5', pumpName: 'Island 1' },
    });
    expect(onlyPump).toHaveLength(1);
    expect(onlyPump[0]!.body).toMatchObject({
      commandType: 'UpdatePump',
      number: '5',
      name: 'Island 1',
    });
    const onlyNozzle = planRenumber({
      ...where,
      pump,
      nozzles,
      answers: { ...from(), nozzles: { a: '1', b: '3' } },
    });
    expect(onlyNozzle.map((c) => c.body)).toEqual([
      { commandType: 'UpdateNozzle', ...where, nozzleId: 'b', number: '3' },
    ]);
  });

  it('reads well in the review list, including a new name', () => {
    const [change] = planRenumber({
      ...where,
      pump,
      nozzles,
      answers: { ...from(), pumpName: 'Front island' },
    });
    const overview = { pumps: [], nozzles: [] } as unknown as ConfigurationSetupOverview;
    expect(describeStaged(change!, overview)).toEqual({
      title: 'Change pump 1',
      detail: 'Called Front island',
    });
  });

  it('keeps a swap in an order the database accepts, and ends where asked', () => {
    const changes = planRenumber({
      ...where,
      pump,
      nozzles,
      answers: { ...from(), nozzles: { a: '2', b: '1' } },
    });
    // Three steps: one nozzle parked on a free number, then both set. No step lands on a number
    // that another nozzle still holds.
    expect(changes).toHaveLength(3);
    const held = new Map(nozzles.map((n) => [n.id, n.number]));
    for (const change of changes) {
      const id = String(change.body.nozzleId);
      const number = String(change.body.number);
      expect([...held].some(([other, value]) => other !== id && value === number)).toBe(false);
      held.set(id, number);
    }
    expect(Object.fromEntries(held)).toEqual({ a: '2', b: '1' });
  });
});

describe('when a meter started working', () => {
  it('needs a nozzle and a real day', () => {
    expect(checkSincePick(BLANK_SINCE)).toHaveProperty('nozzle');
    expect(checkSincePick({ nozzleId: 'n', date: '' })).toEqual({});
    expect(checkSinceDate({ nozzleId: 'n', date: '' })).toHaveProperty('date');
    expect(checkSinceDate({ nozzleId: 'n', date: '2026-13-01' })).toHaveProperty('date');
    expect(checkSinceDate({ nozzleId: 'n', date: '2026-11-01' })).toEqual({});
  });

  it('corrects the day for that nozzle', () => {
    expect(
      planSince({ ...where, answers: { nozzleId: 'n', date: '2026-11-01' } })[0]!.body,
    ).toEqual({
      commandType: 'SetMeterWorkingSince',
      ...where,
      nozzleId: 'n',
      meterWorkingSinceDate: '2026-11-01',
    });
  });
});

describe('adding a pump first, then its nozzles (#317)', () => {
  it('starts with the pump itself, with no "which pump" question', () => {
    expect(addSteps(add({ pump: NEW_PUMP }), false)).toEqual([
      'newPump',
      'nozzle',
      'meter',
      'when',
      'review',
    ]);
  });

  it('creates the pump before the nozzle on it, linked by a stand-in', () => {
    const plan = planAddNozzle({
      tenantId: 't',
      stationId: 's',
      productId: 'p',
      answers: add({
        pump: NEW_PUMP,
        pumpNumber: '3',
        nozzleNumber: '1',
        meter: 'M',
        since: 'today',
      }),
    });
    expect(plan.map((c) => c.body.commandType)).toEqual(['CreatePump', 'CreateNozzle']);
    expect(plan[1]!.body.pumpId).toBe(plan[0]!.standIn);
  });
});

describe('removing a pump or nozzle (#315)', () => {
  it('plans the deletes', () => {
    expect(planDeletePump({ tenantId: 't', stationId: 's', pumpId: 'u1' })[0]!.body).toEqual({
      commandType: 'DeletePump',
      tenantId: 't',
      stationId: 's',
      pumpId: 'u1',
    });
    expect(planDeleteNozzle({ tenantId: 't', stationId: 's', nozzleId: 'n1' })[0]!.body).toEqual({
      commandType: 'DeleteNozzle',
      tenantId: 't',
      stationId: 's',
      nozzleId: 'n1',
    });
  });
});

describe('stopping use of a pump or nozzle that has history (#316)', () => {
  it('plans the retires', () => {
    expect(planRetirePump({ tenantId: 't', stationId: 's', pumpId: 'p1' })[0]!.body).toEqual({
      commandType: 'RetirePump',
      tenantId: 't',
      stationId: 's',
      pumpId: 'p1',
    });
    expect(planRetireNozzle({ tenantId: 't', stationId: 's', nozzleId: 'n1' })[0]!.body).toEqual({
      commandType: 'RetireNozzle',
      tenantId: 't',
      stationId: 's',
      nozzleId: 'n1',
    });
  });
});
