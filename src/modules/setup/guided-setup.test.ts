import { describe, expect, it } from 'vitest';
import type { ConfigurationSetupOverview } from './contracts';
import {
  buildFuelCards,
  buildGuidedSteps,
  describeDuration,
  endTimeFrom,
  minutesBetween,
  firstOpenStep,
  friendlySetupError,
  hoursToMinutes,
  parsePositiveDecimal,
  progress,
  suggestCode,
} from './guided-setup';

type Data = Omit<ConfigurationSetupOverview, 'blockers'>;

const base: Data = {
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
};

const diesel = { id: 'p1', code: 'DIESEL', name: 'Diesel', status: 'ACTIVE' };
const byId = (steps: ReturnType<typeof buildGuidedSteps>, id: string) =>
  steps.find((s) => s.id === id)!;

describe('buildGuidedSteps', () => {
  it('starts by asking for fuel types and blocks the steps that need them', () => {
    const steps = buildGuidedSteps(base);
    expect(byId(steps, 'fuel').status).toBe('todo');
    for (const id of ['prices', 'tanks', 'pumps']) {
      expect(byId(steps, id).status).toBe('blocked');
      expect(byId(steps, id).blockedReason).toBe('Add at least one fuel type first.');
    }
    expect(byId(steps, 'supervisor').status).toBe('blocked');
    expect(firstOpenStep(steps)).toBe('fuel');
  });

  it('moves to prices once a fuel type exists and says what is waiting for approval', () => {
    const steps = buildGuidedSteps({
      ...base,
      products: [diesel],
      prices: [
        {
          id: 'x',
          productId: 'p1',
          unitPrice: '1.5',
          currency: 'USD',
          state: 'DRAFT',
          effectiveFrom: '2026-10-21T00:00:00Z',
          version: 0,
        },
      ],
    });
    expect(byId(steps, 'fuel').status).toBe('done');
    expect(byId(steps, 'prices').status).toBe('todo');
    expect(byId(steps, 'prices').summary).toBe(
      '1 price waiting for approval. Still needs a price: Diesel.',
    );
  });

  it('keeps tanks open until each has an acceptable difference', () => {
    const tank = {
      id: 'k1',
      code: 'T1',
      productId: 'p1',
      capacityLitres: '10000',
      reorderLevelLitres: null,
      acceptableVarianceLitres: null,
      varianceRedLitres: null,
      status: 'ACTIVE',
    };
    const open = byId(buildGuidedSteps({ ...base, products: [diesel], tanks: [tank] }), 'tanks');
    expect(open.status).toBe('todo');
    expect(open.summary).toBe('1 tank added. 1 tank still needs an acceptable difference.');
    const closed = byId(
      buildGuidedSteps({
        ...base,
        products: [diesel],
        tanks: [{ ...tank, acceptableVarianceLitres: '50' }],
      }),
      'tanks',
    );
    expect(closed.status).toBe('done');
  });

  it('requires a nozzle on every pump', () => {
    const pump = { id: 'u1', number: '1', name: null, status: 'ACTIVE' };
    const nozzle = {
      id: 'n1',
      pumpId: 'u1',
      number: '1',
      productId: 'p1',
      status: 'ACTIVE',
      meterSerialNumber: 'SN1',
    };
    const without = byId(buildGuidedSteps({ ...base, products: [diesel], pumps: [pump] }), 'pumps');
    expect(without.status).toBe('todo');
    expect(without.summary).toBe('1 pump added. 1 pump still needs a nozzle.');
    const withNozzle = byId(
      buildGuidedSteps({ ...base, products: [diesel], pumps: [pump], nozzles: [nozzle] }),
      'pumps',
    );
    expect(withNozzle.status).toBe('done');
    expect(withNozzle.summary).toBe('1 pump and 1 nozzle added.');
  });

  it('asks for a supervisor to be invited first, then to be chosen', () => {
    const none = byId(buildGuidedSteps(base), 'supervisor');
    expect(none.blockedReason).toBe('Invite a supervisor to this station under Staff first.');
    const supervisors = [{ membershipId: 'm1', name: 'Tendai' }];
    const todo = byId(buildGuidedSteps({ ...base, supervisors }), 'supervisor');
    expect(todo.status).toBe('todo');
    const done = byId(
      buildGuidedSteps({ ...base, supervisors, responsibleSupervisorMembershipId: 'm1' }),
      'supervisor',
    );
    expect(done).toMatchObject({ status: 'done', summary: 'Tendai' });
  });

  it('distinguishes reusable shift templates from operated shifts', () => {
    const step = byId(buildGuidedSteps(base), 'shifts');
    expect(step.title).toBe('Shift templates');
    expect(step.purpose).toContain('reusable patterns');
    expect(step.summary).toBe('No shift templates added yet.');
  });

  it('does not let a person without permission add anything', () => {
    const steps = buildGuidedSteps({
      ...base,
      capabilities: { ...base.capabilities, products: false },
    });
    expect(byId(steps, 'fuel').canEdit).toBe(false);
  });

  it('counts finished steps', () => {
    expect(progress(buildGuidedSteps(base))).toEqual({ done: 0, total: 6 });
  });
});

describe('buildFuelCards', () => {
  const petrol = { id: 'p2', code: 'PETROL', name: 'Petrol', status: 'ACTIVE' };
  const tank = (productId: string, tolerance: string | null) => ({
    id: `k-${productId}`,
    code: 'T',
    productId,
    capacityLitres: '1000',
    reorderLevelLitres: null,
    acceptableVarianceLitres: tolerance,
    varianceRedLitres: null,
    status: 'ACTIVE',
  });
  const nozzle = (productId: string) => ({
    id: `n-${productId}`,
    pumpId: 'u1',
    number: '1',
    productId,
    status: 'ACTIVE',
    meterSerialNumber: 'SN',
  });
  const price = (productId: string) => ({
    id: `x-${productId}`,
    productId,
    unitPrice: '1.5',
    currency: 'USD',
    state: 'ACTIVE',
    effectiveFrom: '2026-10-21T00:00:00Z',
    version: 1,
  });

  it('judges each fuel on its own', () => {
    const cards = buildFuelCards({
      ...base,
      products: [diesel, petrol],
      prices: [price('p1')],
      tanks: [tank('p1', '50'), tank('p2', null)],
      nozzles: [nozzle('p1')],
    });
    expect(cards.map((c) => [c.name, c.status])).toEqual([
      ['Diesel', 'done'],
      ['Petrol', 'todo'],
    ]);
    expect(cards[0]!.summary).toBe('Price in use, 1 tank, 1 nozzle.');
    expect(cards[1]!.summary).toBe('Needs a price, an acceptable difference on 1 tank, a nozzle.');
  });

  it('says when a price is waiting for approval', () => {
    const cards = buildFuelCards({
      ...base,
      products: [diesel],
      prices: [{ ...price('p1'), state: 'DRAFT' }],
      tanks: [tank('p1', '50')],
      nozzles: [nozzle('p1')],
    });
    expect(cards[0]!.summary).toBe('Needs price approval.');
  });
});

describe('suggestCode', () => {
  it('builds a short code from the name and keeps it unique', () => {
    expect(suggestCode('Unleaded 95', [])).toBe('UNLEADED95');
    expect(suggestCode('Unleaded 95', ['UNLEADED95'])).toBe('UNLEADED95-2');
    expect(suggestCode('Unleaded 95', ['unleaded95', 'UNLEADED95-2'])).toBe('UNLEADED95-3');
    expect(suggestCode('!!!', [])).toBe('ITEM');
    expect(suggestCode('A'.repeat(60), []).length).toBeLessThanOrEqual(32);
  });
});

describe('number entry', () => {
  it('accepts positive decimals within the allowed places', () => {
    expect(parsePositiveDecimal('10,000', 3)).toBe('10000');
    expect(parsePositiveDecimal(' 1.250 ', 6)).toBe('1.250');
    expect(parsePositiveDecimal('007', 3)).toBe('7');
    expect(parsePositiveDecimal('0', 3)).toBeNull();
    expect(parsePositiveDecimal('0.000', 3)).toBeNull();
    expect(parsePositiveDecimal('1.2345', 3)).toBeNull();
    expect(parsePositiveDecimal('-5', 3)).toBeNull();
    expect(parsePositiveDecimal('abc', 3)).toBeNull();
  });

  it('turns hours into minutes and back into words', () => {
    expect(hoursToMinutes('8')).toBe(480);
    expect(hoursToMinutes('8.5')).toBe(510);
    expect(hoursToMinutes('0')).toBeNull();
    expect(hoursToMinutes('25')).toBeNull();
    expect(hoursToMinutes('eight')).toBeNull();
    expect(describeDuration(480)).toBe('8 hours');
    expect(describeDuration(510)).toBe('8 hours 30 minutes');
    expect(describeDuration(60)).toBe('1 hour');
  });
});

describe('shift times', () => {
  it('works out how long a shift runs from its start and end', () => {
    expect(minutesBetween('06:00', '18:00')).toBe(720);
    expect(minutesBetween('18:00', '06:00')).toBe(720);
    expect(minutesBetween('22:00', '02:30')).toBe(270);
    expect(minutesBetween('06:00', '06:00')).toBeNull();
    expect(minutesBetween('', '06:00')).toBeNull();
  });

  it('shows where a shift ends', () => {
    expect(endTimeFrom('06:00:00', 720)).toBe('18:00');
    expect(endTimeFrom('18:00', 720)).toBe('06:00');
    expect(endTimeFrom('', 60)).toBe('');
  });
});

describe('friendlySetupError', () => {
  it('speaks plainly and never leaks a server failure', () => {
    expect(friendlySetupError(403)).toContain('permission');
    expect(friendlySetupError(409, 'A pump with this number already exists at the station')).toBe(
      'A pump with this number already exists at the station',
    );
    expect(friendlySetupError(500, 'stack trace')).toBe(
      'Something went wrong on our side. Nothing was saved. Try again.',
    );
  });
});
