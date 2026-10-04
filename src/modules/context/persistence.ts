import 'server-only';

import { z } from 'zod';
import type { ContextSelection } from './contracts';

export const CONTEXT_COOKIE_NAME = 'shanda-fuel-context';
const CONTEXT_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

const persistedSelectionSchema = z
  .object({
    organisationId: z.string().uuid(),
    legalEntityId: z.string().uuid().optional(),
    stationId: z.string().uuid().optional(),
    allStations: z.boolean(),
  })
  .superRefine((selection, refinement) => {
    if (selection.allStations && selection.stationId) {
      refinement.addIssue({
        code: 'custom',
        path: ['stationId'],
        message: 'An all-stations selection cannot contain a station',
      });
    }
  });

export type PersistedContext = Readonly<{
  selection?: ContextSelection;
  invalid: boolean;
}>;

export type ContextCookieWriter = {
  cookies: {
    set: (
      name: string,
      value: string,
      options: {
        httpOnly: boolean;
        secure: boolean;
        sameSite: 'lax';
        path: string;
        maxAge: number;
      },
    ) => void;
    delete: (name: string) => void;
  };
};

export function readPersistedContext(request: Request): PersistedContext {
  const raw = readCookie(request.headers.get('cookie'), CONTEXT_COOKIE_NAME);
  if (!raw) return { invalid: false };

  try {
    const decoded = Buffer.from(raw, 'base64url').toString('utf8');
    const parsed = persistedSelectionSchema.safeParse(JSON.parse(decoded));
    return parsed.success ? { selection: parsed.data, invalid: false } : { invalid: true };
  } catch {
    return { invalid: true };
  }
}

export function writePersistedContext(
  response: ContextCookieWriter,
  selection: ContextSelection,
): void {
  response.cookies.set(CONTEXT_COOKIE_NAME, encodeSelection(selection), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: CONTEXT_COOKIE_MAX_AGE,
  });
}

export function clearPersistedContext(response: ContextCookieWriter): void {
  response.cookies.delete(CONTEXT_COOKIE_NAME);
}

export function encodeSelection(selection: ContextSelection): string {
  return Buffer.from(JSON.stringify(selection), 'utf8').toString('base64url');
}

function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const pair of header.split(';')) {
    const separator = pair.indexOf('=');
    if (separator < 0) continue;
    const key = pair.slice(0, separator).trim();
    if (key !== name) continue;
    return decodeCookieValue(pair.slice(separator + 1).trim());
  }
  return undefined;
}

function decodeCookieValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
