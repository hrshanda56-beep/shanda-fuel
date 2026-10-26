import { describe, expect, it } from 'vitest';
import {
  checkCutoverReading,
  checkNewPrice,
  nextPriceChangeStep,
  quickSteps,
  type PriceChangeCapabilities,
} from './price-change-state';

const all: PriceChangeCapabilities = {
  request: true,
  approve: true,
  prepare: true,
  boundary: true,
  activate: true,
};

describe('checkNewPrice', () => {
  it('accepts a price with up to six decimals and drops leading zeros', () => {
    expect(checkNewPrice('1.65', '1.5')).toEqual({ ok: true, value: '1.65' });
    expect(checkNewPrice('01.650000', '1.5')).toEqual({ ok: true, value: '1.650000' });
  });
  it('refuses empty, zero, text, too many decimals and the price already in use', () => {
    for (const bad of ['', '0', '0.00', 'abc', '1.1234567', '-1'])
      expect(checkNewPrice(bad, '1.5').ok).toBe(false);
    expect(checkNewPrice('1.50', '1.5').ok).toBe(false);
  });
});

describe('checkCutoverReading', () => {
  it('refuses a reading lower than the last one and accepts an equal or higher one', () => {
    expect(checkCutoverReading('8299.999', '8300.000').ok).toBe(false);
    expect(checkCutoverReading('8300', '8300.000').ok).toBe(true);
    expect(checkCutoverReading('8301.5', '8300.000')).toEqual({ ok: true, value: '8301.5' });
  });
  it('refuses empty and over-precise readings', () => {
    expect(checkCutoverReading('', null).ok).toBe(false);
    expect(checkCutoverReading('1.2345', null).ok).toBe(false);
  });
});

describe('quickSteps', () => {
  it('runs the whole approval chain for someone who may do every step', () => {
    expect(quickSteps(null, all).run.map((s) => s.step)).toEqual([
      'DRAFT',
      'REQUEST',
      'APPROVE',
      'PREPARE',
    ]);
  });
  it('continues from where the change has got to, with the version each step expects', () => {
    expect(quickSteps('PENDING_APPROVAL', all).run).toEqual([
      { step: 'APPROVE', expectedVersion: 1 },
      { step: 'PREPARE', expectedVersion: 2 },
    ]);
  });
  it('stops at the first step the person cannot do', () => {
    const manager = { ...all, approve: false };
    expect(quickSteps(null, manager)).toEqual({
      run: [
        { step: 'DRAFT', expectedVersion: 0 },
        { step: 'REQUEST', expectedVersion: 0 },
      ],
      stoppedAt: 'approve',
    });
  });
  it('has nothing to run once the pump readings stage is reached', () => {
    expect(quickSteps('PENDING_STATION_ACTIVATION', all).run).toEqual([]);
  });
});

describe('nextPriceChangeStep', () => {
  it('asks for pump readings, then activation', () => {
    const change = { state: 'PENDING_STATION_ACTIVATION' };
    expect(nextPriceChangeStep(change, [{ done: false }], all).step).toBe('READINGS');
    expect(nextPriceChangeStep(change, [{ done: true }], all).step).toBe('ACTIVATE');
  });
  it('reports who is needed when the person lacks the permission', () => {
    expect(
      nextPriceChangeStep({ state: 'PENDING_APPROVAL' }, [], { ...all, approve: false }),
    ).toEqual({
      step: 'APPROVE',
      blockedBy: 'approve',
    });
  });
});
