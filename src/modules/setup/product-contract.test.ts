import { describe, expect, it } from 'vitest';
import { createProductPayload, setProductKindPayload, toSetupProduct } from './product-contract';

const base = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  stationId: '22222222-2222-4222-8222-222222222222',
  code: 'DSL',
  name: 'Diesel',
};

describe('createProductPayload', () => {
  it('accepts a legacy payload without a kind', () => {
    expect(createProductPayload.parse(base).kind).toBeUndefined();
  });

  it('accepts each named kind and a blend with a valid percentage', () => {
    for (const kind of ['DIESEL', 'D50', 'PETROL', 'GAS', 'OTHER'] as const) {
      expect(createProductPayload.parse({ ...base, kind }).kind).toBe(kind);
    }
    for (const blendPercent of [5, 10, 15, 20]) {
      const parsed = createProductPayload.parse({
        ...base,
        name: `Blend E${blendPercent}`,
        kind: 'BLEND',
        blendPercent,
      });
      expect(parsed.blendPercent).toBe(blendPercent);
    }
  });

  it('rejects a blend without a percentage or with one outside 5, 10, 15, 20', () => {
    expect(() => createProductPayload.parse({ ...base, kind: 'BLEND' })).toThrow();
    expect(() =>
      createProductPayload.parse({ ...base, kind: 'BLEND', blendPercent: 12 }),
    ).toThrow();
  });

  it('rejects a percentage on anything that is not a blend', () => {
    expect(() =>
      createProductPayload.parse({ ...base, kind: 'PETROL', blendPercent: 10 }),
    ).toThrow();
    expect(() => createProductPayload.parse({ ...base, blendPercent: 10 })).toThrow();
  });

  it('rejects an unknown kind and a blank name (Others needs a typed name)', () => {
    expect(() => createProductPayload.parse({ ...base, kind: 'KEROSENE' })).toThrow();
    expect(() => createProductPayload.parse({ ...base, kind: 'OTHER', name: '   ' })).toThrow();
  });
});

describe('setProductKindPayload', () => {
  const kindBase = { ...base, productId: '33333333-3333-4333-8333-333333333333' };

  it('sets a kind on an existing product without a code or name', () => {
    const parsed = setProductKindPayload.parse({ ...kindBase, kind: 'D50' });
    expect(parsed.kind).toBe('D50');
    expect('name' in parsed).toBe(false);
    expect('code' in parsed).toBe(false);
  });

  it('accepts a blend with 5, 10, 15 or 20 percent', () => {
    for (const blendPercent of [5, 10, 15, 20]) {
      expect(
        setProductKindPayload.parse({ ...kindBase, kind: 'BLEND', blendPercent }).blendPercent,
      ).toBe(blendPercent);
    }
  });

  it('requires a kind and a product id', () => {
    expect(() => setProductKindPayload.parse({ ...kindBase })).toThrow();
    expect(() => setProductKindPayload.parse({ ...base, kind: 'GAS' })).toThrow();
    expect(() => setProductKindPayload.parse({ ...kindBase, kind: 'KEROSENE' })).toThrow();
  });

  it('rejects a blend without a valid percentage and a percentage on other kinds', () => {
    expect(() => setProductKindPayload.parse({ ...kindBase, kind: 'BLEND' })).toThrow();
    expect(() =>
      setProductKindPayload.parse({ ...kindBase, kind: 'BLEND', blendPercent: 25 }),
    ).toThrow();
    expect(() =>
      setProductKindPayload.parse({ ...kindBase, kind: 'GAS', blendPercent: 10 }),
    ).toThrow();
  });
});

describe('toSetupProduct', () => {
  it('returns the kind and blend percentage per product, null for legacy rows', () => {
    const row = {
      id: 'a',
      code: 'D',
      name: 'Diesel 50',
      status: 'ACTIVE',
      display_order: null,
      unit: 'LITRES',
    };
    expect(toSetupProduct({ ...row, kind: null, blend_percent: null })).toMatchObject({
      name: 'Diesel 50',
      kind: null,
      blendPercent: null,
    });
    expect(toSetupProduct({ ...row, kind: 'BLEND', blend_percent: 10 })).toMatchObject({
      kind: 'BLEND',
      blendPercent: 10,
    });
  });
});
