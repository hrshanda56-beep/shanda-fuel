import { describe, expect, it } from 'vitest';
import { serializeSafe } from './safe-serialization';

describe('safe serialization', () => {
  it('removes sensitive fields before data reaches a browser response', () => {
    const result = serializeSafe({
      name: 'Example customer',
      bankAccountNumber: 'secret-account',
      nested: { apiKey: 'secret-key', label: 'safe' },
    });
    expect(result).toEqual({ name: 'Example customer', nested: { label: 'safe' } });
  });

  it('allows an explicitly authorized server-side field path', () => {
    const result = serializeSafe(
      { bankAccountNumber: 'masked-or-authorized' },
      { allowSensitiveFields: ['bankAccountNumber'] },
    );
    expect(result.bankAccountNumber).toBe('masked-or-authorized');
  });
});
