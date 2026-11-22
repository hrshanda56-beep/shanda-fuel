import { describe, expect, it } from 'vitest';

import type { ConfigurationSetupOverview } from './contracts';
import { NO_NEEDS, nextTask, sayTasks, stationTasks } from './complete-station';

const fuel = (id: string, name: string) => ({ id, name, status: 'ACTIVE' });
const data = (patch: Record<string, unknown>) =>
  ({
    products: [],
    prices: [],
    tanks: [],
    nozzles: [],
    shiftTemplates: [],
    ...patch,
  }) as unknown as Pick<
    ConfigurationSetupOverview,
    'products' | 'prices' | 'tanks' | 'nozzles' | 'shiftTemplates'
  >;

/** A station that has everything of its own: one fuel with a price, a tank, a nozzle, a shift. */
const finished = () =>
  data({
    products: [fuel('d', 'Diesel')],
    prices: [{ productId: 'd', state: 'ACTIVE' }],
    tanks: [{ productId: 'd', status: 'ACTIVE' }],
    nozzles: [{ productId: 'd', status: 'ACTIVE' }],
    shiftTemplates: [{ active: true }],
  });

describe('what a station still needs', () => {
  it('starts with a fuel when there is none, then the shifts', () => {
    expect(stationTasks(data({}), NO_NEEDS).map((t) => t.key)).toEqual(['fuel', 'shifts']);
  });

  it('asks for a price, a tank and a nozzle for each fuel, in that order', () => {
    const tasks = stationTasks(
      data({
        products: [fuel('d', 'Diesel'), fuel('p', 'Petrol')],
        shiftTemplates: [{ active: true }],
      }),
      NO_NEEDS,
    );
    expect(tasks.map((t) => t.key)).toEqual([
      'price:d',
      'tanks:d',
      'pumps:d',
      'price:p',
      'tanks:p',
      'pumps:p',
    ]);
    expect(tasks[0]).toMatchObject({
      label: 'A price for Diesel',
      part: { kind: 'price', productId: 'd' },
    });
  });

  it('is empty once everything is there', () => {
    expect(
      stationTasks(
        data({
          products: [fuel('d', 'Diesel')],
          prices: [{ productId: 'd', state: 'ACTIVE' }],
          tanks: [{ productId: 'd', status: 'ACTIVE' }],
          nozzles: [{ productId: 'd', status: 'ACTIVE' }],
          shiftTemplates: [{ active: true }],
        }),
        NO_NEEDS,
      ),
    ).toEqual([]);
  });

  it('does not ask for a price that is only waiting for approval', () => {
    const tasks = stationTasks(
      data({
        products: [fuel('d', 'Diesel')],
        prices: [{ productId: 'd', state: 'PENDING_APPROVAL' }],
        tanks: [{ productId: 'd', status: 'ACTIVE' }],
        nozzles: [{ productId: 'd', status: 'ACTIVE' }],
        shiftTemplates: [{ active: true }],
      }),
      NO_NEEDS,
    );
    expect(tasks).toEqual([]);
  });

  describe('a price a cut-off save left half way', () => {
    const half = (state: string, caps: Record<string, boolean>) =>
      stationTasks(
        data({
          products: [fuel('d', 'Diesel')],
          prices: [{ productId: 'd', state }],
          tanks: [{ productId: 'd', status: 'ACTIVE' }],
          nozzles: [{ productId: 'd', status: 'ACTIVE' }],
          shiftTemplates: [{ active: true }],
          capabilities: { priceRequest: true, priceApprove: true, priceActivate: true, ...caps },
        }),
        NO_NEEDS,
      ).map((t) => t.key);

    it('asks again when this person can still start it', () => {
      expect(half('PENDING_STATION_ACTIVATION', {})).toEqual(['price:d']);
      expect(half('APPROVED', {})).toEqual(['price:d']);
      expect(half('PENDING_APPROVAL', {})).toEqual(['price:d']);
      expect(half('DRAFT', {})).toEqual(['price:d']);
    });

    it('leaves it alone when only someone else can take it further', () => {
      expect(half('PENDING_STATION_ACTIVATION', { priceActivate: false })).toEqual([]);
      expect(half('PENDING_APPROVAL', { priceApprove: false })).toEqual([]);
    });

    it('never asks about a price already in use', () => {
      expect(half('ACTIVE', {})).toEqual([]);
    });
  });

  it('asks again for a price that was replaced, a hidden fuel not at all', () => {
    const tasks = stationTasks(
      data({
        products: [fuel('d', 'Diesel'), { id: 'x', name: 'Old', status: 'INACTIVE' }],
        prices: [{ productId: 'd', state: 'SUPERSEDED' }],
        tanks: [{ productId: 'd', status: 'ACTIVE' }],
        nozzles: [{ productId: 'd', status: 'ACTIVE' }],
        shiftTemplates: [{ active: true }],
      }),
      NO_NEEDS,
    );
    expect(tasks.map((t) => t.key)).toEqual(['price:d']);
  });

  it('counts a shift only when it is active', () => {
    expect(
      stationTasks(data({ shiftTemplates: [{ active: false }] }), NO_NEEDS).map((t) => t.key),
    ).toContain('shifts');
  });

  it('asks who works there, then payment accounts, then the opening stock', () => {
    const tasks = stationTasks(finished(), {
      staff: true,
      providerAccount: true,
      bankAccount: true,
      openingStock: true,
    });
    expect(tasks.map((t) => [t.key, t.part.kind])).toEqual([
      ['staff', 'invite'],
      ['provider', 'provider'],
      ['bank', 'bank'],
      ['opening', 'opening'],
    ]);
  });

  it('asks for the opening stock only once the changes are saved', () => {
    const tasks = stationTasks(finished(), {
      ...NO_NEEDS,
      bankAccount: true,
      openingStock: true,
    });
    expect(tasks.find((t) => t.key === 'opening')?.afterSave).toBe(true);
    expect(nextTask(tasks, new Set(), false)?.key).toBe('bank');
    expect(nextTask(tasks, new Set(['bank']), false)).toBeNull();
    expect(nextTask(tasks, new Set(['bank']), true)?.key).toBe('opening');
  });
});

describe('going through the jobs', () => {
  const tasks = stationTasks(data({}), { ...NO_NEEDS, staff: true });

  it('offers each job once, in order', () => {
    expect(nextTask(tasks, new Set())?.key).toBe('fuel');
    expect(nextTask(tasks, new Set(['fuel']))?.key).toBe('shifts');
    expect(nextTask(tasks, new Set(['fuel', 'shifts', 'staff']))).toBeNull();
  });

  it('says what is left in a sentence', () => {
    expect(sayTasks([])).toBe('');
    expect(sayTasks(tasks.slice(0, 1))).toBe('add a fuel');
    expect(sayTasks(tasks)).toBe('add a fuel, a shift and someone working at the station');
  });
});
