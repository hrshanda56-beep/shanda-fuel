import { describe, expect, it } from 'vitest';

import {
  CONTEXT_COOKIE_NAME,
  encodeSelection,
  readPersistedContext,
  writePersistedContext,
} from './persistence';

const selection = {
  organisationId: '11111111-1111-4111-8111-111111111111',
  legalEntityId: '22222222-2222-4222-8222-222222222222',
  stationId: '33333333-3333-4333-8333-333333333333',
  allStations: false,
} as const;

describe('HTTP context persistence', () => {
  it('round-trips an identifier-only, non-secret cookie value', () => {
    const request = new Request('https://fuel.example.test', {
      headers: { cookie: `${CONTEXT_COOKIE_NAME}=${encodeSelection(selection)}` },
    });
    expect(readPersistedContext(request)).toEqual({ selection, invalid: false });
  });

  it('marks malformed or structurally unsafe persisted values invalid', () => {
    const malformed = new Request('https://fuel.example.test', {
      headers: { cookie: `${CONTEXT_COOKIE_NAME}=not-base64-json` },
    });
    expect(readPersistedContext(malformed)).toEqual({ invalid: true });

    const unsafe = new Request('https://fuel.example.test', {
      headers: {
        cookie: `${CONTEXT_COOKIE_NAME}=${encodeSelection({
          ...selection,
          organisationId: 'not-an-id',
        })}`,
      },
    });
    expect(readPersistedContext(unsafe)).toEqual({ invalid: true });
  });

  it('writes an HTTP-only same-site cookie and never stores a secret', () => {
    const calls: unknown[][] = [];
    const response = {
      cookies: {
        set: (...args: unknown[]) => calls.push(args),
        delete: () => undefined,
      },
    };
    writePersistedContext(response, selection);
    expect(calls[0]?.[0]).toBe(CONTEXT_COOKIE_NAME);
    expect(calls[0]?.[2]).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/' });
    expect(String(calls[0]?.[1])).not.toContain('password');
  });
});
