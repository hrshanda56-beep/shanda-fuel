import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  chooseTank,
  loadBrand,
  recallBrand,
  resetBrandMemory,
  sanitiseBrand,
} from './brand-memory';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';

afterEach(() => resetBrandMemory());

describe('sanitiseBrand', () => {
  it('keeps a PNG data address and a hex colour', () => {
    expect(sanitiseBrand({ logo: PNG, colour: '#237a3d' })).toEqual({
      logo: PNG,
      colour: '#237a3d',
      tank: 'light',
    });
  });

  it('drops anything that is not a PNG data address or a hex colour', () => {
    expect(
      sanitiseBrand({ logo: 'https://example.com/x.png', colour: 'red; background:url(x)' }),
    ).toEqual({ logo: null, colour: null, tank: 'light' });
    expect(
      sanitiseBrand({ logo: 'data:image/svg+xml;base64,PHN2Zz4=', colour: null })?.logo,
    ).toBeNull();
    expect(sanitiseBrand('nope')).toBeNull();
    expect(sanitiseBrand(null)).toBeNull();
  });
});

describe('loadBrand', () => {
  const answer = (data: unknown, ok = true) =>
    vi.fn(async () => ({ ok, json: async () => ({ data }) }) as unknown as Response);

  it('remembers the brand and asks only once per company', async () => {
    const fetcher = answer({ logo: PNG, colour: '#fa7800' });
    await loadBrand('11111111-1111-4111-8111-111111111111', fetcher);
    await loadBrand('11111111-1111-4111-8111-111111111111', fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(recallBrand()).toEqual({ logo: PNG, colour: '#fa7800', tank: 'light' });
  });

  it('leaves the plain truck when the answer is an error or the call fails', async () => {
    await loadBrand('22222222-2222-4222-8222-222222222222', answer({}, false));
    expect(recallBrand()).toBeNull();
    resetBrandMemory();
    await loadBrand(
      '33333333-3333-4333-8333-333333333333',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    expect(recallBrand()).toBeNull();
  });

  it('forgets the old company brand when the company changes', async () => {
    await loadBrand('44444444-4444-4444-8444-444444444444', answer({ logo: PNG, colour: null }));
    expect(recallBrand()?.logo).toBe(PNG);
    await loadBrand('55555555-5555-4555-8555-555555555555', answer({ logo: null, colour: null }));
    expect(recallBrand()).toEqual({ logo: null, colour: null, tank: 'light' });
  });
});

describe('chooseTank', () => {
  const pixels = (...rows: Array<[number, number, number, number, number]>) =>
    rows.flatMap(([r, g, b, a, count]) => Array.from({ length: count }, () => [r, g, b, a]).flat());

  it('gives white lettering a dark tank', () => {
    expect(chooseTank(pixels([255, 255, 255, 255, 40], [35, 122, 61, 255, 20]))).toBe('dark');
  });

  it('gives black artwork a light tank', () => {
    expect(chooseTank(pixels([0, 0, 0, 255, 40], [250, 120, 0, 255, 20]))).toBe('light');
  });

  it('ignores transparent pixels and defaults to light when nothing is drawn', () => {
    expect(chooseTank(pixels([255, 255, 255, 0, 500]))).toBe('light');
    expect(chooseTank([])).toBe('light');
  });
});
