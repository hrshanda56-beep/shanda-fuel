import { describe, expect, it } from 'vitest';
import type { ConfigurationSetupOverview } from './contracts';
import { applyStaged, resolveStandIns } from './staged-changes';
import {
  NEW_PUMP,
  blankFuel,
  blankNozzle,
  blankTank,
  checkFuelName,
  checkNozzle,
  checkPrice,
  checkShift,
  checkTank,
  planSetupChanges,
  type FuelDraft,
} from './wizard-plan';

const data: ConfigurationSetupOverview = {
  tenantId: 't',
  stationId: 's',
  stationStatus: 'ONBOARDING',
  capabilities: {
    products: true,
    tanks: true,
    forecourt: true,
    shiftTemplates: true,
    priceRequest: true,
    priceApprove: true,
    priceActivate: true,
    suppliers: true,
  },
  products: [],
  tanks: [],
  pumps: [],
  nozzles: [],
  shiftTemplates: [],
  prices: [],
  suppliers: [],
  supervisors: [],
  responsibleSupervisorMembershipId: null,
  blockers: [],
};

const diesel = (): FuelDraft => ({
  ...blankFuel(),
  kind: 'DIESEL',
  name: 'Diesel',
  price: '1.65',
  tank: { ...blankTank('Tank 1'), capacity: '30000' },
  nozzle: {
    ...blankNozzle(),
    pump: NEW_PUMP,
    newPumpNumber: '1',
    number: '1',
    meter: 'MTR-1',
  },
});

const types = (changes: ReturnType<typeof planSetupChanges>) =>
  changes.map((c) => String(c.body.commandType));

describe('planSetupChanges', () => {
  it('orders a fuel before its price, tank, pump and nozzle', () => {
    const plan = planSetupChanges({
      tenantId: 't',
      stationId: 's',
      fuels: [diesel()],
      shift: null,
      data,
    });
    expect(types(plan)).toEqual([
      'CreateProduct',
      'DraftPriceChange',
      'AdvancePrice',
      'CreateTank',
      'CreatePump',
      'CreateNozzle',
    ]);
  });

  it('points later changes at the stand-in ids of what they depend on', () => {
    const plan = planSetupChanges({
      tenantId: 't',
      stationId: 's',
      fuels: [diesel()],
      shift: null,
      data,
    });
    const product = plan[0]!;
    const price = plan[1]!;
    const pump = plan[4]!;
    expect(price.body.productId).toBe(product.standIn);
    expect(plan[2]!.body.priceId).toBe(price.standIn);
    expect(plan[3]!.body.productId).toBe(product.standIn);
    expect(plan[5]!.body.pumpId).toBe(pump.standIn);
    expect(plan[5]!.body.productId).toBe(product.standIn);
  });

  it('adds a pump once when two fuels use the same new pump', () => {
    const second = {
      ...diesel(),
      key: 99,
      name: 'Petrol',
      kind: 'PETROL',
      price: '',
      tank: null,
      nozzle: { ...blankNozzle(), pump: 'new:1', number: '2', meter: 'MTR-2' },
    };
    const plan = planSetupChanges({
      tenantId: 't',
      stationId: 's',
      fuels: [diesel(), second],
      shift: null,
      data,
    });
    expect(types(plan).filter((t) => t === 'CreatePump')).toHaveLength(1);
    const pump = plan.find((c) => c.body.commandType === 'CreatePump')!;
    const nozzles = plan.filter((c) => c.body.commandType === 'CreateNozzle');
    expect(nozzles.map((n) => n.body.pumpId)).toEqual([pump.standIn, pump.standIn]);
  });

  it('uses a saved pump as it is and leaves out what was skipped', () => {
    const fuel = {
      ...diesel(),
      price: '',
      tank: null,
      nozzle: { ...blankNozzle(), pump: 'pump-7', number: '3', meter: 'M' },
    };
    const plan = planSetupChanges({
      tenantId: 't',
      stationId: 's',
      fuels: [fuel],
      shift: null,
      data,
    });
    expect(types(plan)).toEqual(['CreateProduct', 'CreateNozzle']);
    expect(plan[1]!.body.pumpId).toBe('pump-7');
  });

  it('adds a shift last, and only the parts the person may change', () => {
    const plan = planSetupChanges({
      tenantId: 't',
      stationId: 's',
      fuels: [diesel()],
      shift: { name: 'Day shift', start: '06:00', end: '14:00' },
      data: {
        ...data,
        capabilities: { ...data.capabilities, tanks: false, priceRequest: false },
      },
    });
    expect(types(plan)).toEqual([
      'CreateProduct',
      'CreatePump',
      'CreateNozzle',
      'DefineShiftTemplate',
    ]);
    expect(plan[plan.length - 1]!.body.durationMinutes).toBe(480);
  });

  it('shows on screen as the setup that will exist once saved', () => {
    const plan = planSetupChanges({
      tenantId: 't',
      stationId: 's',
      fuels: [diesel()],
      shift: null,
      data,
    });
    const shown = applyStaged(data, plan);
    expect(shown.products?.map((p) => p.name)).toEqual(['Diesel']);
    expect(shown.tanks).toHaveLength(1);
    expect(shown.pumps).toHaveLength(1);
    expect(shown.nozzles).toHaveLength(1);
    // Saving swaps each stand-in for the real id the server returns.
    const real = new Map([[plan[0]!.standIn!, 'real-product']]);
    expect(resolveStandIns(plan[3]!.body, real).productId).toBe('real-product');
  });
});

describe('checks', () => {
  it('asks for the type, then a name that is not already used', () => {
    expect(checkFuelName({ kind: '', blendPercent: '', name: 'x' }, []).kind).toBeTruthy();
    expect(checkFuelName({ kind: 'DIESEL', blendPercent: '', name: '' }, []).name).toBeTruthy();
    expect(
      checkFuelName({ kind: 'DIESEL', blendPercent: '', name: ' diesel ' }, ['Diesel']).name,
    ).toMatch(/already have/);
    expect(checkFuelName({ kind: 'DIESEL', blendPercent: '', name: 'Diesel' }, [])).toEqual({});
  });

  it('allows an empty price but not a wrong one', () => {
    expect(checkPrice('', 'LITRES')).toEqual({});
    expect(checkPrice('1.65', 'LITRES')).toEqual({});
    expect(checkPrice('abc', 'LITRES').price).toBeTruthy();
    expect(checkPrice('0', 'LITRES').price).toBeTruthy();
  });

  it('checks the tank and its optional limits', () => {
    expect(checkTank(blankTank(''), 'LITRES')).toMatchObject({
      name: expect.any(String),
      capacity: expect.any(String),
    });
    expect(checkTank({ ...blankTank('T'), capacity: '1000' }, 'LITRES')).toEqual({});
    expect(checkTank({ ...blankTank('T'), capacity: '1000', red: '50' }, 'LITRES').red).toMatch(
      /yellow/,
    );
    expect(
      checkTank({ ...blankTank('T'), capacity: '1000', difference: '50', red: '20' }, 'LITRES').red,
    ).toMatch(/lower/);
    expect(
      checkTank({ ...blankTank('T'), capacity: '1000', reorder: '2000' }, 'LITRES').reorder,
    ).toMatch(/more than the tank/);
  });

  it('checks the nozzle, including a pump number that is already taken', () => {
    const ok = { ...blankNozzle(), pump: 'p', number: '1', meter: 'M' };
    expect(checkNozzle(ok, ['1'])).toEqual({});
    expect(checkNozzle(blankNozzle(), [])).toMatchObject({
      pump: expect.any(String),
      number: expect.any(String),
      meter: expect.any(String),
    });
    expect(checkNozzle({ ...ok, pump: NEW_PUMP, newPumpNumber: '1' }, ['1']).newPumpNumber).toMatch(
      /already/,
    );
  });

  it('checks a shift', () => {
    expect(checkShift({ name: '', start: '', end: '' })).toMatchObject({
      name: expect.any(String),
      start: expect.any(String),
      end: expect.any(String),
    });
    expect(checkShift({ name: 'Day', start: '06:00', end: '06:00' }).end).toBeTruthy();
    expect(checkShift({ name: 'Day', start: '06:00', end: '14:00' })).toEqual({});
  });
});
