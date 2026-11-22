import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { toCompanyBrand } from './brand';

const PNG = 'iVBORw0KGgoAAAANSUhEUg==';

describe('toCompanyBrand', () => {
  it('is the plain truck when the company has set nothing', () => {
    expect(toCompanyBrand(undefined)).toEqual({ logo: null, colour: null });
    expect(toCompanyBrand({ app_logo_png_base64: null, brand_colour: null })).toEqual({
      logo: null,
      colour: null,
    });
  });

  it('turns a stored PNG into a data address and keeps a valid colour', () => {
    expect(toCompanyBrand({ app_logo_png_base64: PNG, brand_colour: '#237A3D' })).toEqual({
      logo: `data:image/png;base64,${PNG}`,
      colour: '#237A3D',
    });
  });

  it('drops values that are not a PNG or a hex colour, even if the database held them', () => {
    expect(
      toCompanyBrand({ app_logo_png_base64: '/9j/4AAQ', brand_colour: 'javascript:alert(1)' }),
    ).toEqual({ logo: null, colour: null });
    expect(
      toCompanyBrand({
        app_logo_png_base64: `iVBORw0KGgo${'A'.repeat(300000)}`,
        brand_colour: null,
      }).logo,
    ).toBeNull();
  });
});
