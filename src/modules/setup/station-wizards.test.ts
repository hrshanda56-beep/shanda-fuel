import { describe, expect, it } from 'vitest';

import type { ConfigurationSetupOverview, SetupShiftTemplate } from './contracts';
import { applyStaged, describeStaged, type StagedChange } from './staged-changes';
import {
  BLANK_FUEL,
  BLANK_SHIFT,
  addFuelSteps,
  afterKindPick,
  checkBlendPick,
  checkFuelName,
  checkInChargePick,
  checkKindPick,
  checkShiftName,
  checkShiftPick,
  checkShiftTimes,
  checkUnitPick,
  describeShiftTimes,
  fuelEditFrom,
  fuelEditSteps,
  fuelFlowsFor,
  planAddFuel,
  planFuelEdit,
  planInCharge,
  planShift,
  shiftFrom,
  shiftIsUnchanged,
  shiftSteps,
} from './station-wizards';

const where = { tenantId: 't', stationId: 's' };
const shift = (patch: Partial<SetupShiftTemplate> = {}) =>
  ({
    id: 'sh1',
    version: 3,
    code: 'DAY',
    name: 'Day shift',
    startTime: '06:00:00',
    durationMinutes: 720,
    active: true,
    ...patch,
  }) as SetupShiftTemplate;

/** Puts planned commands through the same list the page keeps, to check what the person would see. */
const asQueue = (planned: { url: string; body: Record<string, unknown> }[]): StagedChange[] =>
  planned.map((p, i) => ({ id: `c${i}`, ...p }));

describe('fuel names', () => {
  it('needs a name, of sensible length, that no other fuel has', () => {
    expect(checkFuelName('  ', [])).toHaveProperty('name');
    expect(checkFuelName('x'.repeat(121), [])).toHaveProperty('name');
    expect(checkFuelName(' diesel ', ['Diesel'])).toHaveProperty('name');
    expect(checkFuelName('Paraffin', ['Diesel'])).toEqual({});
  });

  it('asks for the name of an "other" fuel in its own words', () => {
    expect(checkFuelName('', [], 'OTHER').name).toContain('Paraffin');
  });
});

describe('adding a fuel', () => {
  it('asks for the blend only for a blend', () => {
    expect(addFuelSteps({ ...BLANK_FUEL, kind: 'DIESEL_50' })).toEqual([
      'kind',
      'name',
      'unit',
      'review',
    ]);
    expect(addFuelSteps({ ...BLANK_FUEL, kind: 'BLEND' })).toContain('blend');
  });

  it('checks the type, the blend and the unit', () => {
    expect(checkKindPick(BLANK_FUEL)).toHaveProperty('kind');
    expect(checkKindPick({ kind: 'GAS' })).toEqual({});
    expect(checkBlendPick({ blendPercent: null })).toHaveProperty('blendPercent');
    expect(checkBlendPick({ blendPercent: '10' })).toEqual({});
    expect(checkBlendPick({ blendPercent: '12' })).toHaveProperty('blendPercent');
    expect(checkUnitPick({ unit: null })).toHaveProperty('unit');
    expect(checkUnitPick({ unit: 'LITRES' })).toEqual({});
  });

  it('suggests a name and unit from the type, until the person types their own', () => {
    const gas = afterKindPick(BLANK_FUEL, 'GAS', null);
    expect(gas.unit).toBe('KILOGRAMS');
    expect(gas.name).not.toBe('');
    const own = afterKindPick({ ...BLANK_FUEL, name: 'My fuel', nameEdited: true }, 'GAS', null);
    expect(own.name).toBe('My fuel');
  });

  it('plans a new fuel with a code that no other fuel uses', () => {
    const planned = planAddFuel({
      ...where,
      takenCodes: ['DIESEL'],
      answers: { ...BLANK_FUEL, kind: 'GAS', name: ' Diesel ', unit: 'KILOGRAMS' },
    });
    expect(planned).toHaveLength(1);
    expect(planned[0]!.body).toMatchObject({
      commandType: 'CreateProduct',
      name: 'Diesel',
      code: 'DIESEL-2',
      kind: 'GAS',
      unit: 'KILOGRAMS',
    });
  });

  it('plans nothing without a valid type', () => {
    expect(planAddFuel({ ...where, takenCodes: [], answers: BLANK_FUEL })).toEqual([]);
  });

  it('shows on the station as though saved, in plain words', () => {
    const base = {
      capabilities: { products: true },
      products: [],
      tanks: [],
      pumps: [],
      nozzles: [],
    } as unknown as ConfigurationSetupOverview;
    const queue = asQueue(
      planAddFuel({
        ...where,
        takenCodes: [],
        answers: { ...BLANK_FUEL, kind: 'GAS', name: 'LPG', unit: 'KILOGRAMS' },
      }),
    );
    // A creation needs its stand-in id, which the page's own list adds; here only the wording.
    expect(describeStaged(queue[0]!, applyStaged(base, []))).toEqual({ title: 'Add fuel: LPG' });
  });
});

describe('changing a fuel itself', () => {
  const product = { id: 'p1', status: 'ACTIVE' };
  const answers = fuelEditFrom({
    name: 'Diesel',
    kind: 'DIESEL_50',
    blendPercent: null,
    unit: 'LITRES',
  });

  it('starts from what the fuel is now', () => {
    expect(answers).toEqual({
      name: 'Diesel',
      kind: 'DIESEL_50',
      blendPercent: null,
      unit: 'LITRES',
    });
  });

  it('has the right screens for each job', () => {
    expect(fuelEditSteps('rename', answers)).toEqual(['name', 'review']);
    expect(fuelEditSteps('type', answers)).toEqual(['kind', 'review']);
    expect(fuelEditSteps('type', { ...answers, kind: 'BLEND' })).toEqual([
      'kind',
      'blend',
      'review',
    ]);
    expect(fuelEditSteps('unit', answers)).toEqual(['unit', 'review']);
    expect(fuelEditSteps('delete', answers)).toEqual(['review']);
  });

  it('offers hide or show by the fuel, and delete only when allowed', () => {
    const shown = fuelFlowsFor({ status: 'ACTIVE' }, false);
    expect(shown.map((f) => f.value)).toEqual(['rename', 'type', 'unit', 'visibility']);
    expect(shown.find((f) => f.value === 'visibility')!.label).toBe('Hide it');
    const hidden = fuelFlowsFor({ status: 'INACTIVE' }, true);
    expect(hidden.find((f) => f.value === 'visibility')!.label).toBe('Show it again');
    expect(hidden.map((f) => f.value)).toContain('delete');
  });

  it('plans each change', () => {
    const body = (flow: Parameters<typeof planFuelEdit>[0]['flow'], a = answers, p = product) =>
      planFuelEdit({ ...where, product: p, flow, answers: a })[0]?.body;
    expect(body('rename', { ...answers, name: ' Petrol ' })).toMatchObject({
      commandType: 'RenameProduct',
      productId: 'p1',
      name: 'Petrol',
    });
    expect(body('type', { ...answers, kind: 'GAS' })).toMatchObject({
      commandType: 'SetProductKind',
      kind: 'GAS',
      blendPercent: null,
    });
    expect(body('unit', { ...answers, unit: 'KILOGRAMS' })).toMatchObject({
      commandType: 'SetProductUnit',
      unit: 'KILOGRAMS',
    });
    expect(body('visibility')).toMatchObject({
      commandType: 'SetProductStatus',
      status: 'INACTIVE',
    });
    expect(body('visibility', answers, { id: 'p1', status: 'INACTIVE' })).toMatchObject({
      status: 'ACTIVE',
    });
    expect(body('delete')).toMatchObject({ commandType: 'DeleteProduct', productId: 'p1' });
  });

  it('plans nothing for a type that is not valid', () => {
    expect(
      planFuelEdit({ ...where, product, flow: 'type', answers: { ...answers, kind: 'BLEND' } }),
    ).toEqual([]);
  });
});

describe('shifts', () => {
  it('has the right screens for each job', () => {
    expect(shiftSteps('add')).toEqual(['name', 'times', 'review']);
    expect(shiftSteps('change')).toEqual(['pick', 'name', 'times', 'review']);
    expect(shiftSteps('remove')).toEqual(['pick', 'review']);
  });

  it('needs a shift to be picked', () => {
    expect(checkShiftPick(BLANK_SHIFT)).toHaveProperty('shift');
    expect(checkShiftPick({ ...BLANK_SHIFT, shiftId: 'sh1' })).toEqual({});
  });

  it('keeps shift names present, short and different', () => {
    expect(checkShiftName(BLANK_SHIFT, [])).toHaveProperty('name');
    expect(checkShiftName({ ...BLANK_SHIFT, name: 'x'.repeat(81) }, [])).toHaveProperty('name');
    expect(checkShiftName({ ...BLANK_SHIFT, name: 'day SHIFT' }, ['Day shift'])).toHaveProperty(
      'name',
    );
    expect(checkShiftName({ ...BLANK_SHIFT, name: 'Night' }, ['Day shift'])).toEqual({});
  });

  it('needs two different times', () => {
    expect(checkShiftTimes(BLANK_SHIFT)).toHaveProperty('start');
    expect(checkShiftTimes({ ...BLANK_SHIFT, start: '06:00', end: '06:00' })).toHaveProperty('end');
    expect(checkShiftTimes({ ...BLANK_SHIFT, start: '06:00', end: '18:00' })).toEqual({});
    expect(checkShiftTimes({ ...BLANK_SHIFT, start: '18:00', end: '06:00' })).toEqual({});
  });

  it('says when a shift ends the next day', () => {
    expect(describeShiftTimes({ start: '06:00', end: '18:00' })).toBe('06:00 to 18:00');
    expect(describeShiftTimes({ start: '18:00', end: '06:00' })).toBe(
      '18:00 to 06:00 (ends the next day)',
    );
  });

  it('starts a change from what the shift is now', () => {
    expect(shiftFrom(shift())).toEqual({
      shiftId: 'sh1',
      name: 'Day shift',
      start: '06:00',
      end: '18:00',
    });
    expect(shiftIsUnchanged(shift(), shiftFrom(shift()))).toBe(true);
    expect(shiftIsUnchanged(shift(), { ...shiftFrom(shift()), end: '17:00' })).toBe(false);
  });

  it('plans a new shift with a new id, a code and its length', () => {
    const [added] = planShift({
      ...where,
      flow: 'add',
      answers: { ...BLANK_SHIFT, name: ' Night ', start: '18:00', end: '06:00' },
      shifts: [shift()],
      newId: () => 'new-id',
    });
    expect(added!.body).toEqual({
      commandType: 'DefineShiftTemplate',
      ...where,
      shiftTemplateId: 'new-id',
      expectedVersion: 0,
      code: 'NIGHT',
      name: 'Night',
      startTime: '18:00',
      durationMinutes: 720,
      active: true,
    });
  });

  it('plans a change on the saved version, and keeps its code', () => {
    const [changed] = planShift({
      ...where,
      flow: 'change',
      answers: { shiftId: 'sh1', name: 'Early', start: '05:00', end: '13:30' },
      shifts: [shift()],
    });
    expect(changed!.body).toMatchObject({
      shiftTemplateId: 'sh1',
      expectedVersion: 3,
      code: 'DAY',
      name: 'Early',
      startTime: '05:00',
      durationMinutes: 510,
      active: true,
    });
  });

  it('plans a removal as turning the shift off', () => {
    const [removed] = planShift({
      ...where,
      flow: 'remove',
      answers: { ...BLANK_SHIFT, shiftId: 'sh1' },
      shifts: [shift()],
    });
    expect(removed!.body).toMatchObject({
      shiftTemplateId: 'sh1',
      expectedVersion: 3,
      name: 'Day shift',
      startTime: '06:00',
      active: false,
    });
  });

  it('plans nothing for a shift that is not there or times that are wrong', () => {
    expect(
      planShift({
        ...where,
        flow: 'remove',
        answers: { ...BLANK_SHIFT, shiftId: 'zzz' },
        shifts: [shift()],
      }),
    ).toEqual([]);
    expect(
      planShift({ ...where, flow: 'add', answers: { ...BLANK_SHIFT, name: 'A' }, shifts: [] }),
    ).toEqual([]);
  });

  it('reads well in the review list, and a shift added then removed is never sent', () => {
    const added = planShift({
      ...where,
      flow: 'add',
      answers: { ...BLANK_SHIFT, name: 'Night', start: '18:00', end: '06:00' },
      shifts: [],
      newId: () => 'n1',
    })[0]!;
    const overview = { shiftTemplates: [] } as unknown as ConfigurationSetupOverview;
    expect(describeStaged({ id: 'x', ...added }, overview).title).toBe('Add shift: Night');
  });
});

describe('who is in charge', () => {
  it('needs someone to be chosen', () => {
    expect(checkInChargePick(null)).toHaveProperty('supervisor');
    expect(checkInChargePick('m1')).toEqual({});
  });

  it('plans the choice', () => {
    expect(planInCharge({ ...where, membershipId: 'm1' })[0]!.body).toEqual({
      commandType: 'SetResponsibleSupervisor',
      ...where,
      membershipId: 'm1',
    });
  });
});
