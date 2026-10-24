import { describe, expect, it } from 'vitest';
import { validateDeliveryAllocations } from './domain';

describe('delivery allocations must be greater than zero', () => {
  it('rejects a zero-litre tank allocation', () => {
    expect(() => validateDeliveryAllocations('1000.000', ['1000.000', '0.000'])).toThrow(
      /must be positive/,
    );
  });
});
