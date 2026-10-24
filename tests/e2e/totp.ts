import { createHmac } from 'node:crypto';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(input: string): Buffer {
  let bits = '';
  for (const char of input.replace(/[\s=-]/g, '').toUpperCase()) {
    const value = BASE32.indexOf(char);
    if (value < 0) throw new Error('The authenticator setup key is not valid base32.');
    bits += value.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/** RFC 6238 time-based one-time code (HMAC-SHA1, 30 second step), as authenticator apps compute it. */
export function totpCode(setupKey: string, nowMs = Date.now(), digits = 6): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(nowMs / 1000 / 30)));
  const hmac = createHmac('sha1', base32Decode(setupKey)).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary =
    ((hmac[offset]! & 0x7f) << 24) |
    (hmac[offset + 1]! << 16) |
    (hmac[offset + 2]! << 8) |
    hmac[offset + 3]!;
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/**
 * Authenticator setup keys for the privileged E2E users, keyed by email, from the E2E_TOTP_SECRETS
 * secret, for example {"e2e-owner+clerk_test@example.com":"JBSWY3DPEHPK3PXP"}. Test users on a
 * Clerk development instance only. Never log these values.
 */
export function totpSetupKeyFor(email: string): string | undefined {
  const keys = JSON.parse(process.env.E2E_TOTP_SECRETS ?? '{}') as Record<string, string>;
  return keys[email];
}
