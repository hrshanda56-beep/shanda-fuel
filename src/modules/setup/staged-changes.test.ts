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
  products: [{ id: 'p1', code: 'D', name: 'Diesel', status: 'ACTIVE', unit: 'LITRES', kind: 'DIESEL' }],
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
      ...base, commandType: 'CreateTank', code: 'Tank 1', productId: 'p1', capacityLitres: '20000',
      reorderLevelLitres: null, acceptableVarianceLitres: null, varianceRedLitres: null,
    });
    q = addStaged(q, SETUP, { ...base, commandType: 'CreatePump', number: '1', name: null });
    const pumpStandIn = q[1]!.standIn!;
    expect(isStandIn(pumpStandIn)).toBe(true);
    q = addStaged(q, SETUP, {
      ...base, commandType: 'CreateNozzle', pumpId: pumpStandIn, number: '1', productId: 'p1', meterSerialNumber: 'M1',
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
    q = addStaged(q, SETUP, { ...base, commandType: 'UpdatePump', pumpId: pump, number: '7', name: 'Front' });
    expect(q).toHaveLength(1);
    expect(q[0]!.body).toMatchObject({ commandType: 'CreatePump', number: '7', name: 'Front' });
    q = addStaged(q, SETUP, { ...base, commandType: 'CreateNozzle', pumpId: pump, number: '1', productId: 'p1', meterSerialNumber: 'M' });
    q = addStaged(q, SETUP, { ...base, commandType: 'SetMeterWorkingSince', nozzleId: q[1]!.standIn!, meterWorkingSinceDate: '2026-10-29' });
    expect(q).toHaveLength(2);
    expect(q[1]!.body.meterWorkingSinceDate).toBe('2026-10-29');

    let k = addStaged([], SETUP, { ...base, commandType: 'SetMeterWorkingSince', nozzleId: 'n1', meterWorkingSinceDate: '2026-10-01' });
    k = addStaged(k, SETUP, { ...base, commandType: 'SetMeterWorkingSince', nozzleId: 'n1', meterWorkingSinceDate: '2026-10-02' });
    expect(k).toHaveLength(1);
    expect(k[0]!.body.meterWorkingSinceDate).toBe('2026-10-02');
  });

  it('adds then removes a shift without leaving anything to save', () => {
    const shift = { ...base, commandType: 'DefineShiftTemplate', shiftTemplateId: 'x', expectedVersion: 0, code: 'DAY', name: 'Day', startTime: '06:00', durationMinutes: 720, active: true };
    let q = addStaged([], '/api/forecourt/commands', shift);
    expect(applyStaged(empty, q).shiftTemplates).toHaveLength(1);
    q = addStaged(q, '/api/forecourt/commands', { ...shift, active: false });
    expect(q).toHaveLength(0);
  });

  it('discarding a waiting pump also discards its nozzles', () => {
    let q = addStaged([], SETUP, { ...base, commandType: 'CreatePump', number: '1', name: null });
    q = addStaged(q, SETUP, { ...base, commandType: 'CreateNozzle', pumpId: q[0]!.standIn!, number: '1', productId: 'p1', meterSerialNumber: 'M' });
    q = addStaged(q, SETUP, { ...base, commandType: 'CreatePump', number: '2', name: null });
    expect(discardStaged(q, q[0]!.id).map((c) => c.body.number)).toEqual(['2']);
  });

  it('describes changes in plain words with no ids', () => {
    const q = addStaged([], '/api/inventory/commands', {
      ...base, commandType: 'CreateTank', code: 'Tank 1', productId: 'p1', capacityLitres: '20000',
    });
    const line = describeStaged(q[0]!, empty);
    expect(line.title).toBe('Add tank: Tank 1');
    expect(line.detail).toBe('Diesel, holds 20,000');
    expect(JSON.stringify(line)).not.toContain('staged');
  });

  it('swaps stand-in ids for the real ones when saving, in order, and stops at a refusal', async () => {
    let q = addStaged([], SETUP, { ...base, commandType: 'CreatePump', number: '1', name: null });
    q = addStaged(q, SETUP, { ...base, commandType: 'CreateNozzle', pumpId: q[0]!.standIn!, number: '1', productId: 'p1', meterSerialNumber: 'M' });
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
    let q = addStaged([], SETUP, { ...base, commandType: 'DraftPriceChange', productId: 'p1', unitPrice: '1.20', currency: 'USD', effectiveFrom: 'x' });
    const priceId = q[0]!.standIn!;
    q = addStaged(q, '/api/forecourt/commands', { ...base, commandType: 'AdvancePrice', priceId, steps: ['RequestPriceChange'], expectedVersion: 0 });
    q = addStaged(q, '/api/forecourt/commands', { ...base, commandType: 'AdvancePrice', priceId, steps: ['ApprovePriceChange', 'ActivatePriceChange'], expectedVersion: 0 });
    expect(q).toHaveLength(2);
    expect(applyStaged(empty, q).prices?.[0]?.state).toBe('ACTIVE');
    expect(describeStaged(q[1]!, applyStaged(empty, q)).title).toBe('Approve and start using the price for Diesel');
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
    const q = addStaged([], '/api/forecourt/commands', { ...base, commandType: 'AdvancePrice', priceId: 'pr', steps: ['RequestPriceChange', 'ApprovePriceChange'], expectedVersion: 3 });
    let n = 0;
    const send = (async () => (n++ === 0 ? new Response('{}', { status: 200 }) : new Response('{"message":"no"}', { status: 403 }))) as unknown as typeof fetch;
    const result = await saveAllStaged(q, new Map(), send);
    expect(result.kind).toBe('stopped');
    if (result.kind === 'stopped') {
      expect(result.remaining[0]!.body).toMatchObject({ steps: ['ApprovePriceChange'], expectedVersion: 4 });
    }
  });
});
