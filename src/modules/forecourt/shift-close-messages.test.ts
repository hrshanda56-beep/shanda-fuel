import { describe, expect, it } from 'vitest';
import { meterNotWorkingForShiftMessage } from './shift-close-messages';

describe('meterNotWorkingForShiftMessage', () => {
  it('tells the owner to set the Meter working since date for that nozzle', () => {
    const message = meterNotWorkingForShiftMessage('pump Petrol B nozzle 0003');
    expect(message).toContain('pump Petrol B nozzle 0003');
    expect(message).toContain('Meter working since');
    expect(message).toContain('Ask the owner');
  });
});
