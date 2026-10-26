import { describe, expect, it } from 'vitest';

import type { StationSetupFacts } from './contracts';
import { computeStationReadiness, statusLabel } from './readiness';

const empty: StationSetupFacts = {
  stationId: 's1',
  stationCode: 'ST1',
  stationName: 'Station One',
  legalEntityId: 'le1',
  activeProducts: 0,
  pricedProducts: 0,
  activeTanks: 0,
  tanksMissingTolerance: 0,
  tanksMissingOpeningStock: 0,
  tanksMissingOpeningCost: 0,
  activePumps: 0,
  activeNozzles: 0,
  pumpsWithoutNozzle: 0,
  activeShiftTemplates: 0,
  providerAccounts: 0,
  bankAccounts: 0,
  assignedStaff: 0,
};

const complete: StationSetupFacts = {
  ...empty,
  activeProducts: 2,
  pricedProducts: 2,
  activeTanks: 2,
  activePumps: 2,
  activeNozzles: 4,
  activeShiftTemplates: 1,
  providerAccounts: 1,
  bankAccounts: 1,
  assignedStaff: 3,
};

function area(facts: StationSetupFacts, code: string) {
  return computeStationReadiness(facts).areas.find((item) => item.code === code)!;
}

describe('computeStationReadiness', () => {
  it('reports every area as not entered when nothing has been entered, never as zero', () => {
    const result = computeStationReadiness(empty);
    expect(result.ready).toBe(false);
    expect(result.areas.map((item) => item.status)).toEqual(Array(6).fill('NOT_ENTERED'));
    for (const item of result.areas) expect(item.detail).not.toMatch(/\b0\b/);
    expect(result.blockedSummary).toMatch(/^Blocked until setup is complete/);
  });

  it('is ready with no blocked summary when every area is entered', () => {
    const result = computeStationReadiness(complete);
    expect(result.ready).toBe(true);
    expect(result.blockedSummary).toBeNull();
    expect(result.areas.every((item) => item.status === 'READY')).toBe(true);
  });

  it('distinguishes products missing from prices missing', () => {
    expect(area(empty, 'PRICES').detail).toMatch(/No fuel products/);
    expect(area({ ...empty, activeProducts: 2 }, 'PRICES').detail).toBe(
      'Prices not entered for this station.',
    );
    const partial = area({ ...complete, pricedProducts: 1 }, 'PRICES');
    expect(partial.status).toBe('PARTIAL');
    expect(partial.detail).toBe('1 of 2 products priced here; the rest are not entered.');
  });

  it('flags tanks with no opening stock as incomplete', () => {
    const result = area({ ...complete, tanksMissingOpeningStock: 1 }, 'TANKS');
    expect(result.status).toBe('PARTIAL');
    expect(result.detail).toContain('opening stock not recorded for 1');
  });

  it('flags opening stock that has no cost as incomplete', () => {
    const result = area({ ...complete, tanksMissingOpeningCost: 2 }, 'TANKS');
    expect(result.status).toBe('PARTIAL');
    expect(result.detail).toContain('opening stock has no cost for 2');
  });

  it('flags tanks without a variance tolerance as incomplete', () => {
    const result = area({ ...complete, tanksMissingTolerance: 1 }, 'TANKS');
    expect(result.status).toBe('PARTIAL');
    expect(result.detail).toContain('variance tolerance not entered for 1');
  });

  it('treats pumps without nozzles as not entered or incomplete', () => {
    expect(area({ ...empty, activePumps: 2 }, 'PUMPS').detail).toBe('Nozzles not entered.');
    const partial = area({ ...complete, pumpsWithoutNozzle: 1 }, 'PUMPS');
    expect(partial.status).toBe('PARTIAL');
    expect(partial.detail).toContain('1 pump without a nozzle');
  });

  it('requires both a provider account and a bank account for payments', () => {
    expect(area({ ...complete, bankAccounts: 0 }, 'PAYMENTS')).toMatchObject({
      status: 'PARTIAL',
      blocks: 'Bank deposits',
    });
    expect(area({ ...complete, providerAccounts: 0 }, 'PAYMENTS')).toMatchObject({
      status: 'PARTIAL',
      blocks: 'Electronic payment settlements',
    });
  });

  it('only lists blocked work for areas that are not ready', () => {
    const result = computeStationReadiness({ ...complete, activeShiftTemplates: 0 });
    expect(result.blockedSummary).toBe(
      'Blocked until setup is complete: opening shifts from a template.',
    );
  });

  it('labels statuses in plain words', () => {
    expect(statusLabel('READY')).toBe('Ready');
    expect(statusLabel('PARTIAL')).toBe('Incomplete');
    expect(statusLabel('NOT_ENTERED')).toBe('Not entered');
  });
});
