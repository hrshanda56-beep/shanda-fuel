import { describe, expect, it } from 'vitest';
import { roleFlags } from './add-supplier-wizard';

describe('roleFlags', () => {
  it('maps what a company does to the two flags the server stores', () => {
    expect(roleFlags('FUEL')).toEqual({ providesFuel: true, providesTransport: false });
    expect(roleFlags('TRANSPORT')).toEqual({ providesFuel: false, providesTransport: true });
    expect(roleFlags('BOTH')).toEqual({ providesFuel: true, providesTransport: true });
  });
});
