import { describe, expect, it } from 'vitest';
import { meterNotWorkingForShiftMessage } from './shift-close-messages';

describe('meterNotWorkingForShiftMessage', () => {
  it('tells the owner to set the Meter working since date for that nozzle', () => {
    const message = meterNotWorkingForShiftMessage('pump Petrol B nozzle 0003');
    expect(message).toContain('pump Petrol B nozzle 0003');
    expect(message).toContain('Meter working since');
    expect(message).toContain('Ask the owner');
  });

  it('names every nozzle at once when several are not set up', () => {
    const message = meterNotWorkingForShiftMessage([
      'pump A nozzle 1',
      'pump B nozzle 2',
      'pump C nozzle 3',
    ]);
    expect(message).toContain('pump A nozzle 1, pump B nozzle 2 and pump C nozzle 3');
    expect(message).toContain('not set up as working for this shift');
    expect(message).toContain('each of those nozzles');
  });
});
