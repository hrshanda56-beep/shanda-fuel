import { describe, expect, it } from 'vitest';

import { previewLandedCost } from './landed-cost-preview';

const delivery = { id: 'd1', deliveryNoteNumber: 'DN-1', receivedLitres: '4983' };
const fuel = { lineType: 'FUEL' as const, quantity: '5000', unitPrice: '1.78', deliveryId: 'd1' };
const transport = {
  lineType: 'TRANSPORT' as const,
  quantity: '5000',
  unitPrice: '0.02',
  deliveryId: '',
};

describe('previewLandedCost', () => {
  it('divides purchase plus direct costs by the litres actually received', () => {
    // 5,000 L at 1.78 = 8,900, plus 0.02 a litre transport = 100, over 4,983 L received.
    const [result] = previewLandedCost([fuel, transport], [delivery]);
    expect(result).toEqual({
      deliveryId: 'd1',
      deliveryNoteNumber: 'DN-1',
      receivedLitres: '4983',
      purchaseCost: '8900.0000',
      directCosts: '100.0000',
      totalCost: '9000.0000',
      perLitre: '1.8061',
    });
  });

  it('shows nothing until a delivery is chosen for a fuel line', () => {
    expect(previewLandedCost([{ ...fuel, deliveryId: '' }, transport], [delivery])).toEqual([]);
  });

  it('leaves direct costs out when several deliveries are on the invoice', () => {
    const second = { id: 'd2', deliveryNoteNumber: 'DN-2', receivedLitres: '1000' };
    const results = previewLandedCost(
      [fuel, { ...fuel, quantity: '1000', deliveryId: 'd2' }, transport],
      [delivery, second],
    );
    expect(results.map((r) => r.directCosts)).toEqual(['0.0000', '0.0000']);
  });

  it('ignores lines that are not yet valid numbers', () => {
    expect(
      previewLandedCost([fuel, { ...transport, quantity: 'abc' }], [delivery])[0]?.directCosts,
    ).toBe('0.0000');
  });
});
