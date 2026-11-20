import { describe, expect, it } from 'vitest';

import {
  nextRepeat,
  popTrail,
  previousRepeat,
  pushTrail,
  repeatLabel,
  returnsToSummary,
  stepPosition,
} from './wizard-nav';

const SEQUENCE = ['what', 'pumps', 'review'] as const;

describe('wizard trail', () => {
  it('remembers each screen left, including which repeat it was on', () => {
    let trail = pushTrail<string>([], { step: 'what', index: 0 });
    trail = pushTrail(trail, { step: 'pumps', index: 2 });
    const { previous, rest } = popTrail(trail);
    expect(previous).toEqual({ step: 'pumps', index: 2 });
    expect(rest).toEqual([{ step: 'what', index: 0 }]);
  });

  it('does not change the trail it was given', () => {
    const trail = [{ step: 'what', index: 0 }];
    pushTrail(trail, { step: 'pumps', index: 0 });
    expect(trail).toHaveLength(1);
  });

  it('asks to cancel when there is nothing to go back to', () => {
    expect(popTrail([])).toEqual({ previous: null, rest: [] });
  });
});

describe('wizard position', () => {
  it('counts from 1 and never shows step 0 for a step outside the sequence', () => {
    expect(stepPosition(SEQUENCE, 'what')).toBe(1);
    expect(stepPosition(SEQUENCE, 'review')).toBe(3);
    expect(stepPosition(SEQUENCE, 'elsewhere')).toBe(1);
  });

  it('knows when Back lands on the summary', () => {
    expect(returnsToSummary(SEQUENCE, { step: 'review', index: 0 })).toBe(true);
    expect(returnsToSummary(SEQUENCE, { step: 'pumps', index: 0 })).toBe(false);
  });
});

describe('repeating steps', () => {
  it('walks "one pump at a time" and stops after the last', () => {
    expect(nextRepeat(0, 3)).toBe(1);
    expect(nextRepeat(1, 3)).toBe(2);
    expect(nextRepeat(2, 3)).toBeNull();
  });

  it('stops immediately when there is one repeat or none', () => {
    expect(nextRepeat(0, 1)).toBeNull();
    expect(nextRepeat(0, 0)).toBeNull();
  });

  it('goes back one repeat at a time and stops at the first', () => {
    expect(previousRepeat(2)).toBe(1);
    expect(previousRepeat(0)).toBeNull();
  });

  it('labels the repeat only when there is more than one', () => {
    expect(repeatLabel('Pump', 1, 4)).toBe('Pump 2 of 4');
    expect(repeatLabel('Pump', 0, 1)).toBe('');
  });
});
