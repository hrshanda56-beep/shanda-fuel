import { expect, test } from '@playwright/test';
import { totpCode } from './totp';

// RFC 6238 appendix B test vectors (SHA-1 key "12345678901234567890", 8 digits) and the 6 digit
// form of the same codes, so the helper matches what authenticator apps show.
const key = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

test.describe('authenticator code helper', () => {
  test('matches the RFC 6238 test vectors', () => {
    expect(totpCode(key, 59_000, 8)).toBe('94287082');
    expect(totpCode(key, 1_111_111_109_000, 8)).toBe('07081804');
    expect(totpCode(key, 1_234_567_890_000, 8)).toBe('89005924');
    expect(totpCode(key, 59_000)).toBe('287082');
  });

  test('rejects a setup key that is not base32', () => {
    expect(() => totpCode('not-a-key!', 0)).toThrow(/base32/);
  });
});
