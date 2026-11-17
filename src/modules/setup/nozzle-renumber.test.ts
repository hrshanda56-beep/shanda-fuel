import { describe, expect, it } from 'vitest';
import { planNozzleRenumbering } from './nozzle-renumber';

const n = (id: string, number: string) => ({ id, number });

/** Replays the steps the way the database sees them and fails on any duplicate number. */
function replay(before: ReturnType<typeof n>[], steps: ReturnType<typeof n>[]) {
  const state = new Map(before.map((x) => [x.id, x.number]));
  for (const step of steps) {
    state.set(step.id, step.number);
    expect(new Set(state.values()).size).toBe(state.size);
  }
  return state;
}

describe('planNozzleRenumbering', () => {
  it('sends nothing when no number changed', () => {
    expect(planNozzleRenumbering([n('a', '1')], [n('a', '1')])).toEqual([]);
  });

  it('sends a plain rename as one step', () => {
    expect(planNozzleRenumbering([n('a', '1'), n('b', '2')], [n('a', '3'), n('b', '2')])).toEqual([
      n('a', '3'),
    ]);
  });

  it('orders a chain so no step lands on a number still in use', () => {
    const before = [n('a', '1'), n('b', '2')];
    const steps = planNozzleRenumbering(before, [n('a', '2'), n('b', '3')]);
    expect(steps).toEqual([n('b', '3'), n('a', '2')]);
    expect(replay(before, steps).get('a')).toBe('2');
  });

  it('swaps two nozzles through a temporary number', () => {
    const before = [n('a', '1'), n('b', '2')];
    const steps = planNozzleRenumbering(before, [n('a', '2'), n('b', '1')]);
    const end = replay(before, steps);
    expect([end.get('a'), end.get('b')]).toEqual(['2', '1']);
    expect(steps).toHaveLength(3);
  });

  it('rotates three nozzles', () => {
    const before = [n('a', '1'), n('b', '2'), n('c', '3')];
    const steps = planNozzleRenumbering(before, [n('a', '2'), n('b', '3'), n('c', '1')]);
    const end = replay(before, steps);
    expect([end.get('a'), end.get('b'), end.get('c')]).toEqual(['2', '3', '1']);
  });

  it('does not use a temporary number that is already taken', () => {
    const before = [n('a', '1'), n('b', '2'), n('c', 'tmp1')];
    const steps = planNozzleRenumbering(before, [n('a', '2'), n('b', '1'), n('c', 'tmp1')]);
    expect(steps.some((step) => step.number === 'tmp2')).toBe(true);
    expect(replay(before, steps).get('c')).toBe('tmp1');
  });

  it('still sends a number held by an unchanged nozzle, so the server refuses it', () => {
    expect(planNozzleRenumbering([n('a', '1'), n('b', '2')], [n('a', '2'), n('b', '2')])).toEqual([
      n('a', '2'),
    ]);
  });
});
