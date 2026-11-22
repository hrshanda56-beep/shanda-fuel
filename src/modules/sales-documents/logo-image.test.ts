import { describe, expect, it } from 'vitest';

import { fitWithin, isLogoFileType } from './logo-image';

describe('fitWithin', () => {
  it('shrinks a large picture to fit, keeping its shape', () => {
    expect(fitWithin(960, 480, { width: 480, height: 240 })).toEqual({ width: 480, height: 240 });
    expect(fitWithin(479, 335, { width: 360, height: 180 })).toEqual({ width: 257, height: 180 });
  });

  it('never makes a small picture larger', () => {
    expect(fitWithin(100, 50, { width: 480, height: 240 })).toEqual({ width: 100, height: 50 });
  });

  it('never returns a zero size', () => {
    expect(fitWithin(5000, 1, { width: 480, height: 240 }).height).toBe(1);
  });
});

describe('isLogoFileType', () => {
  it('accepts PNG, JPG and SVG only', () => {
    expect(isLogoFileType('image/png')).toBe(true);
    expect(isLogoFileType('image/jpeg')).toBe(true);
    expect(isLogoFileType('image/svg+xml')).toBe(true);
    expect(isLogoFileType('image/gif')).toBe(false);
    expect(isLogoFileType('text/html')).toBe(false);
  });
});
