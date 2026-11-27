import { describe, expect, it, vi } from 'vitest';
import type { ConfigurationSetupOverview } from './contracts';
import {
  addStaged,
  applyStaged,
  describeStaged,
  discardStaged,
  isStandIn,
  resolveStandIns,
  saveAllStaged,
} from './staged-changes';

const empty = {
  tenantId: 't',
  stationId: 's',
  stationStatus: 'ONBOARDING',
  capabilities: {},
  products: [
    { id: 'p1', code: 'D', name: 'Diesel', status: 'ACTIVE', unit: 'LITRES', kind: 'DIESEL' },
  ],
  tanks: [],
  pumps: [],
  nozzles: [],
  shiftTemplates: [],
  prices: [],
  suppliers: [],
  supervisors: [],
  responsibleSupervisorMembershipId: null,
  blockers: [],
} as unknown as ConfigurationSetupOverview;

const base = { tenantId: 't', stationId: 's' };
const SETUP = '/api/setup/commands';

describe('staged setup changes', () => {
  it('shows a waiting tank, pump and nozzle as though saved, and links them', () => {
    let q = addStaged([], '/api/inventory/commands', {
      ...base,
      commandType: 'CreateTank',
      code: 'Tank 1',
      productId: 'p1',
      capacityLitres: '20000',
      reorderLevelLitres: null,
      acceptableVarianceLitres: null,
      varianceRedLitres: null,
    });
    q = addStaged(q, SETUP, { ...base, commandType: 'CreatePump', number: '1', name: null });
    const pumpStandIn = q[1]!.standIn!;
    expect(isStandIn(pumpStandIn)).toBe(true);
    q = addStaged(q, SETUP, {
      ...base,
      commandType: 'CreateNozzle',
      pumpId: pumpStandIn,
      number: '1',
      productId: 'p1',
      meterSerialNumber: 'M1',
    });
    const view = applyStaged(empty, q);
    expect(view.tanks).toHaveLength(1);
    expect(view.pumps?.[0]?.id).toBe(pumpStandIn);
    expect(view.nozzles?.[0]).toMatchObject({ pumpId: pumpStandIn, productId: 'p1' });
    expect(applyStaged(empty, [])).toBe(empty);
  });

  it('folds edits of a waiting item into it, and replaces repeat edits of a saved one', () => {
    let q = addStaged([], SETUP, { ...base, commandType: 'CreatePump', number: '1', name: null });
    const pump = q[0]!.standIn!;
    q = addStaged(q, SETUP, {
      ...base,
      commandType: 'UpdatePump',
      pumpId: pump,
      number: '7',
      name: 'Front',
    });
    expect(q).toHaveLength(1);
    expect(q[0]!.body).toMatchObject({ commandType: 'CreatePump', number: '7', name: 'Front' });
    q = addStaged(q, SETUP, {
      ...base,
      commandType: 'CreateNozzle',
      pumpId: pump,
      number: '1',
      productId: 'p1',
      meterSerialNumber: 'M',
    });
    q = addStaged(q, SETUP, {
      ...base,
      commandType: 'SetMeterWorkingSince',
      nozzleId: q[1]!.standIn!,
      meterWorkingSinceDate: '2026-10-29',
    });
    expect(q).toHaveLength(2);
    expect(q[1]!.body.meterWorkingSinceDate).toBe('2026-10-29');

    let k = addStaged([], SETUP, {
      ...base,
      commandType: 'SetMeterWorkingSince',
      nozzleId: 'n1',
      meterWorkingSinceDate: '2026-10-01',
    });
    k = addStaged(k, SETUP, {
      ...base,
      commandType: 'SetMeterWorkingSince',
      nozzleId: 'n1',
      meterWorkingSinceDate: '2026-10-02',
    });
    expect(k).toHaveLength(1);
    expect(k[0]!.body.meterWorkingSinceDate).toBe('2026-10-02');
  });

  it('adds then removes a shift without leaving anything to save', () => {
    const shift = {
      ...base,
      commandType: 'DefineShiftTemplate',
      shiftTemplateId: 'x',
      expectedVersion: 0,
      code: 'DAY',
      name: 'Day',
      startTime: '06:00',
      durationMinutes: 720,
      active: true,
    };
    let q = addStaged([], '/api/forecourt/commands', shift);
    expect(applyStaged(empty, q).shiftTemplates).toHaveLength(1);
    q = addStaged(q, '/api/forecourt/commands', { ...shift, active: false });
    expect(q).toHaveLength(0);
  });

  it('discarding a waiting pump also discards its nozzles', () => {
    let q = addStaged([], SETUP, { ...base, commandType: 'CreatePump', number: '1', name: null });
    q = addStaged(q, SETUP, {
      ...base,
      commandType: 'CreateNozzle',
      pumpId: q[0]!.standIn!,
      number: '1',
      productId: 'p1',
      meterSerialNumber: 'M',
    });
    q = addStaged(q, SETUP, { ...base, commandType: 'CreatePump', number: '2', name: null });
    expect(discardStaged(q, q[0]!.id).map((c) => c.body.number)).toEqual(['2']);
  });

  it('describes changes in plain words with no ids', () => {
    const q = addStaged([], '/api/inventory/commands', {
      ...base,
      commandType: 'CreateTank',
      code: 'Tank 1',
      productId: 'p1',
      capacityLitres: '20000',
    });
    const line = describeStaged(q[0]!, empty);
    expect(line.title).toBe('Add tank: Tank 1');
    expect(line.detail).toBe('Diesel, holds 20,000');
    expect(JSON.stringify(line)).not.toContain('staged');
  });

  it('swaps stand-in ids for the real ones when saving, in order, and stops at a refusal', async () => {
    let q = addStaged([], SETUP, { ...base, commandType: 'CreatePump', number: '1', name: null });
    q = addStaged(q, SETUP, {
      ...base,
      commandType: 'CreateNozzle',
      pumpId: q[0]!.standIn!,
      number: '1',
      productId: 'p1',
      meterSerialNumber: 'M',
    });
    const sent: Array<Record<string, unknown>> = [];
    const send = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      sent.push(body);
      return body.commandType === 'CreatePump'
        ? new Response(JSON.stringify({ pumpId: 'real-pump' }), { status: 200 })
        : new Response(JSON.stringify({ message: 'no' }), { status: 409 });
    }) as unknown as typeof fetch;
    const real = new Map<string, string>();
    const result = await saveAllStaged(q, real, send);
    expect(sent[1]!.pumpId).toBe('real-pump');
    expect(result).toMatchObject({ kind: 'stopped', status: 409 });
    if (result.kind === 'stopped') expect(result.remaining).toHaveLength(1);
    expect(resolveStandIns({ a: [q[0]!.standIn] }, real)).toEqual({ a: ['real-pump'] });
  });

  it('a new price and its approval wait together, then go out in order on the real price', async () => {
    let q = addStaged([], SETUP, {
      ...base,
      commandType: 'DraftPriceChange',
      productId: 'p1',
      unitPrice: '1.20',
      currency: 'USD',
      effectiveFrom: 'x',
    });
    const priceId = q[0]!.standIn!;
    q = addStaged(q, '/api/forecourt/commands', {
      ...base,
      commandType: 'AdvancePrice',
      priceId,
      steps: ['RequestPriceChange'],
      expectedVersion: 0,
    });
    q = addStaged(q, '/api/forecourt/commands', {
      ...base,
      commandType: 'AdvancePrice',
      priceId,
      steps: ['ApprovePriceChange', 'ActivatePriceChange'],
      expectedVersion: 0,
    });
    expect(q).toHaveLength(2);
    expect(applyStaged(empty, q).prices?.[0]?.state).toBe('ACTIVE');
    expect(describeStaged(q[1]!, applyStaged(empty, q)).title).toBe(
      'Approve and start using the price for Diesel',
    );
    const sent: Array<Record<string, unknown>> = [];
    const send = vi.fn(async (_u: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      sent.push(body);
      return new Response(JSON.stringify({ priceId: 'real-price' }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await saveAllStaged(q, new Map(), send)).toEqual({ kind: 'saved' });
    expect(sent.map((b) => [b.commandType, b.priceId, b.expectedVersion])).toEqual([
      ['DraftPriceChange', undefined, undefined],
      ['RequestPriceChange', 'real-price', 0],
      ['ApprovePriceChange', 'real-price', 1],
      ['ActivatePriceChange', 'real-price', 2],
    ]);
  });

  it('keeps the unsent steps of a price when the server stops part-way', async () => {
    const q = addStaged([], '/api/forecourt/commands', {
      ...base,
      commandType: 'AdvancePrice',
      priceId: 'pr',
      steps: ['RequestPriceChange', 'ApprovePriceChange'],
      expectedVersion: 3,
    });
    let n = 0;
    const send = (async () =>
      n++ === 0
        ? new Response('{}', { status: 200 })
        : new Response('{"message":"no"}', { status: 403 })) as unknown as typeof fetch;
    const result = await saveAllStaged(q, new Map(), send);
    expect(result.kind).toBe('stopped');
    if (result.kind === 'stopped') {
      expect(result.remaining[0]!.body).toMatchObject({
        steps: ['ApprovePriceChange'],
        expectedVersion: 4,
      });
    }
  });
});

describe('deleting tanks, pumps and nozzles (#315)', () => {
  const saved = {
    ...empty,
    tanks: [
      {
        id: 'tank-1',
        code: 'PETROL1',
        productId: 'p1',
        capacityLitres: '10000',
        reorderLevelLitres: null,
        acceptableVarianceLitres: null,
        varianceRedLitres: null,
        status: 'ACTIVE',
        unused: true,
      },
    ],
    pumps: [{ id: 'pump-1', number: '1', name: null, status: 'ACTIVE', unused: true }],
    nozzles: [
      {
        id: 'nozzle-1',
        pumpId: 'pump-1',
        number: '1',
        productId: 'p1',
        status: 'ACTIVE',
        meterSerialNumber: 'M1',
        meterWorkingSince: null,
        meterWorkingSinceEditable: true,
        unused: true,
      },
    ],
  } as unknown as ConfigurationSetupOverview;

  it('drops a waiting pump, and the nozzles on it, instead of deleting it', () => {
    let q = addStaged([], SETUP, { ...base, commandType: 'CreatePump', number: '2', name: null });
    const pump = q[0]!.standIn!;
    q = addStaged(q, SETUP, {
      ...base,
      commandType: 'CreateNozzle',
      pumpId: pump,
      number: '1',
      productId: 'p1',
      meterSerialNumber: 'M2',
    });
    expect(addStaged(q, SETUP, { ...base, commandType: 'DeletePump', pumpId: pump })).toEqual([]);
  });

  it('replaces waiting changes to a saved tank with its delete, and hides it', () => {
    let q = addStaged([], '/api/inventory/commands', {
      ...base,
      commandType: 'UpdateTank',
      tankId: 'tank-1',
      code: 'P1',
      capacityLitres: '10000',
    });
    q = addStaged(q, '/api/inventory/commands', {
      ...base,
      commandType: 'DeleteTank',
      tankId: 'tank-1',
    });
    expect(q.map((c) => c.body.commandType)).toEqual(['DeleteTank']);
    expect(applyStaged(saved, q).tanks).toEqual([]);
    expect(describeStaged(q[0]!, applyStaged(saved, q), saved).title).toBe('Delete tank: PETROL1');
  });

  it('hides a deleted pump with its nozzles, and says so', () => {
    const q = addStaged([], SETUP, { ...base, commandType: 'DeletePump', pumpId: 'pump-1' });
    const view = applyStaged(saved, q);
    expect(view.pumps).toEqual([]);
    expect(view.nozzles).toEqual([]);
    expect(describeStaged(q[0]!, view, saved)).toEqual({
      title: 'Delete pump 1',
      detail: 'And its nozzle',
    });
  });

  it('shows a tank moved to another fuel', () => {
    const withPetrol = {
      ...saved,
      products: [
        ...(saved.products ?? []),
        { id: 'p2', code: 'P', name: 'Petrol', status: 'ACTIVE', unit: 'LITRES', kind: 'PETROL' },
      ],
    } as unknown as ConfigurationSetupOverview;
    const q = addStaged([], '/api/inventory/commands', {
      ...base,
      commandType: 'UpdateTank',
      tankId: 'tank-1',
      code: 'PETROL1',
      capacityLitres: '10000',
      productId: 'p2',
    });
    expect(applyStaged(withPetrol, q).tanks?.[0]?.productId).toBe('p2');
    expect(describeStaged(q[0]!, withPetrol).detail).toBe('Now holds Petrol (was Diesel), 10,000');
  });

  it('marks a waiting tank, pump and nozzle as unused', () => {
    let q = addStaged([], SETUP, { ...base, commandType: 'CreatePump', number: '2', name: null });
    q = addStaged(q, SETUP, {
      ...base,
      commandType: 'CreateNozzle',
      pumpId: q[0]!.standIn!,
      number: '1',
      productId: 'p1',
      meterSerialNumber: 'M2',
    });
    const view = applyStaged(empty, q);
    expect(view.pumps?.[0]?.unused).toBe(true);
    expect(view.nozzles?.[0]?.unused).toBe(true);
  });
});

describe('stopping use of a pump or nozzle with history (#316)', () => {
  const saved = {
    ...empty,
    pumps: [{ id: 'pump-1', number: '1', name: null, status: 'ACTIVE', unused: false }],
    nozzles: [
      {
        id: 'nozzle-1',
        pumpId: 'pump-1',
        number: '1',
        productId: 'p1',
        status: 'ACTIVE',
        meterSerialNumber: 'M1',
        meterWorkingSince: null,
        meterWorkingSinceEditable: false,
        unused: false,
      },
    ],
  } as unknown as ConfigurationSetupOverview;

  it('marks a retired nozzle as no longer in use and says what is kept', () => {
    const q = addStaged([], SETUP, { ...base, commandType: 'RetireNozzle', nozzleId: 'nozzle-1' });
    const view = applyStaged(saved, q);
    expect(view.nozzles?.[0]?.status).toBe('INACTIVE');
    expect(view.pumps?.[0]?.status).toBe('ACTIVE');
    expect(describeStaged(q[0]!, view, saved)).toEqual({
      title: 'Stop using nozzle 1',
      detail: 'Diesel, on pump 1. Past records are kept.',
    });
  });

  it('retires a pump together with its nozzles', () => {
    const q = addStaged([], SETUP, { ...base, commandType: 'RetirePump', pumpId: 'pump-1' });
    const view = applyStaged(saved, q);
    expect(view.pumps?.[0]?.status).toBe('INACTIVE');
    expect(view.nozzles?.[0]?.status).toBe('INACTIVE');
    expect(describeStaged(q[0]!, view, saved).title).toBe('Stop using pump 1');
  });
});

describe('stopping use of a tank with history (#316)', () => {
  const saved = {
    ...empty,
    tanks: [
      {
        id: 'tank-1',
        code: 'DIESEL1',
        productId: 'p1',
        capacityLitres: '10000',
        reorderLevelLitres: null,
        acceptableVarianceLitres: null,
        varianceRedLitres: null,
        status: 'ACTIVE',
        unused: false,
      },
    ],
  } as unknown as ConfigurationSetupOverview;

  it('marks the tank retired, drops waiting edits to it, and says what is kept', () => {
    let q = addStaged([], '/api/inventory/commands', {
      tenantId: 't',
      stationId: 's',
      commandType: 'UpdateTank',
      tankId: 'tank-1',
      code: 'D1',
      capacityLitres: '9000',
    });
    q = addStaged(q, '/api/inventory/commands', {
      tenantId: 't',
      stationId: 's',
      commandType: 'RetireTank',
      tankId: 'tank-1',
    });
    expect(q.map((c) => c.body.commandType)).toEqual(['RetireTank']);
    const view = applyStaged(saved, q);
    expect(view.tanks?.[0]?.status).toBe('RETIRED');
    expect(describeStaged(q[0]!, view, saved)).toEqual({
      title: 'Stop using tank: DIESEL1',
      detail: 'Diesel. Past records are kept.',
    });
  });
});
