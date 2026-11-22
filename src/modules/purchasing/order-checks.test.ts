import { describe, expect, it } from 'vitest';
import { checkOrderDates, checkOrderFuel, checkOrderSupplier } from './order-checks';

describe('purchase order checks', () => {
  it('needs a supplier', () => {
    expect(checkOrderSupplier('')).toHaveProperty('po-supplier');
    expect(checkOrderSupplier('s1')).toEqual({});
  });

  it('needs an order date and an expected date that is not earlier', () => {
    expect(checkOrderDates('', '')).toHaveProperty('po-date');
    expect(checkOrderDates('2026-11-10', '2026-11-09')).toHaveProperty('po-expected');
    expect(checkOrderDates('2026-11-10', '')).toEqual({});
    expect(checkOrderDates('2026-11-10', '2026-11-10')).toEqual({});
  });

  it('puts each fuel problem on its own field', () => {
    expect(checkOrderFuel([])).toHaveProperty('po-add-line');
    expect(checkOrderFuel([{ productId: '', litres: '5', price: '' }])).toHaveProperty(
      'po-product-0',
    );
    expect(checkOrderFuel([{ productId: 'p', litres: '', price: '' }])).toHaveProperty(
      'po-litres-0',
    );
    expect(checkOrderFuel([{ productId: 'p', litres: '5', price: 'x' }])).toHaveProperty(
      'po-price-0',
    );
    expect(checkOrderFuel([{ productId: 'p', litres: '5000', price: '1.45' }])).toEqual({});
  });
});
