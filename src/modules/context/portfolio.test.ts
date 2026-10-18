import { describe, expect, it } from 'vitest';
import { portfolioStations, portfolioArea, readLimiter } from './portfolio';
import type { ContextResolution } from './contracts';
const resolution: ContextResolution = {
  current: { organisationId: 'owner', allStations: true },
  persistedContextInvalid: false,
  route: {
    pathname: '/cash',
    policy: { legalEntity: 'optional', station: 'optional', allStationsAllowed: true },
  },
  available: {
    organisations: [
      {
        id: 'owner',
        name: 'Owner',
        legalEntities: [
          {
            id: 'a',
            name: 'A',
            stations: [{ id: 's1', code: 'S1', name: 'One', timezone: 'UTC' }],
          },
          {
            id: 'b',
            name: 'B',
            stations: [{ id: 's2', code: 'S2', name: 'Two', timezone: 'UTC' }],
          },
        ],
      },
      {
        id: 'other',
        name: 'Other',
        legalEntities: [
          {
            id: 'c',
            name: 'C',
            stations: [{ id: 'foreign', code: 'F', name: 'Foreign', timezone: 'UTC' }],
          },
        ],
      },
    ],
  },
};
describe('portfolio scope', () => {
  it('includes only the selected authorized organisation and supplies station action scopes', () => {
    const rows = portfolioStations(resolution);
    expect(rows.map((row) => row.station.id)).toEqual(['s1', 's2']);
    expect(rows[0]?.selection).toEqual({
      organisationId: 'owner',
      legalEntityId: 'a',
      stationId: 's1',
      allStations: false,
    });
  });
  it('respects a legal entity filter and rejects unavailable or non-all contexts', () => {
    expect(
      portfolioStations({
        ...resolution,
        current: { organisationId: 'owner', legalEntityId: 'b', allStations: true },
      }).map((row) => row.station.id),
    ).toEqual(['s2']);
    expect(
      portfolioStations({
        ...resolution,
        current: { organisationId: 'unknown', allStations: true },
      }),
    ).toEqual([]);
    expect(
      portfolioStations({
        ...resolution,
        current: { organisationId: 'owner', stationId: 's1', allStations: false },
      }),
    ).toEqual([]);
  });
  it('only identifies supported overview routes', () => {
    expect(portfolioArea('/cash')).toBe('cash');
    expect(portfolioArea('/inventory/valuation')).toBe('valuation');
    expect(portfolioArea('/stations/s/cash')).toBeNull();
  });
});
it('bounds concurrent reads and releases a slot after a failed station', async () => {
  const run = readLimiter(2);
  let active = 0;
  let peak = 0;
  const results = await Promise.allSettled(
    Array.from({ length: 7 }, (_, index) =>
      run(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 2));
        active--;
        if (index === 0) throw new Error('unavailable');
        return index;
      }),
    ),
  );
  expect(peak).toBe(2);
  expect(results.filter((row) => row.status === 'fulfilled')).toHaveLength(6);
});

it('rejects invalid read concurrency instead of leaving reads queued forever', () => {
  expect(() => readLimiter(0)).toThrow(RangeError);
});
