import 'server-only';

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import { getAuditSigningKey } from '../config/env';

export const CLERK_STEP_UP_COOKIE = 'shanda-fuel.clerk-step-up';
export const CLERK_STEP_UP_CHALLENGE_COOKIE = 'shanda-fuel.clerk-step-up-challenge';
export const CLERK_STEP_UP_ACTION = 'LOCK_BUSINESS_DAY' as const;
export const CLERK_DEACTIVATE_STAFF_ACTION = 'DEACTIVATE_STAFF_MEMBER' as const;
export type ClerkStepUpAction = typeof CLERK_STEP_UP_ACTION | typeof CLERK_DEACTIVATE_STAFF_ACTION;
export type ClerkReverificationLevel = 'strict' | 'strict_mfa';

const TOKEN_VERSION = 'v1';
const TOKEN_TTL_MS = 10 * 60_000;
const CHALLENGE_TTL_MS = 5 * 60_000;

type SignedToken = {
  providerSessionId: string;
  internalUserId: string;
  tenantId: string;
  action: ClerkStepUpAction;
  level: ClerkReverificationLevel;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
};

function signingSecret(): string {
  return getAuditSigningKey().secret;
}

function encodePayload(payload: SignedToken): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function sign(payload: string): string {
  return createHmac('sha256', signingSecret()).update(payload).digest('base64url');
}

function serialize(payload: SignedToken): string {
  const encoded = encodePayload(payload);
  return `${TOKEN_VERSION}.${encoded}.${sign(encoded)}`;
}

function parse(value: string | undefined, now = Date.now()): SignedToken | null {
  if (!value) return null;
  const parts = value.split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) return null;
  const [, encoded, signature] = parts;
  if (!encoded || !signature) return null;
  const expected = sign(encoded);
  const actualBuffer = Buffer.from(signature, 'base64url');
  const expectedBuffer = Buffer.from(expected, 'base64url');
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SignedToken;
    if (
      (payload.action !== CLERK_STEP_UP_ACTION &&
        payload.action !== CLERK_DEACTIVATE_STAFF_ACTION) ||
      !Number.isSafeInteger(payload.issuedAt) ||
      !Number.isSafeInteger(payload.expiresAt) ||
      payload.expiresAt <= now ||
      payload.issuedAt > now
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get('cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) {
      try {
        return decodeURIComponent(part.slice(separator + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

function cookieHeader(name: string, value: string, maxAgeSeconds: number): string {
  return `${name}=${encodeURIComponent(value)}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

function matchesContext(
  token: SignedToken,
  input: Omit<SignedToken, 'nonce' | 'issuedAt' | 'expiresAt'>,
): boolean {
  return (
    token.providerSessionId === input.providerSessionId &&
    token.internalUserId === input.internalUserId &&
    token.tenantId === input.tenantId &&
    token.action === input.action &&
    token.level === input.level
  );
}

export function issueClerkStepUpChallenge(input: {
  providerSessionId: string;
  internalUserId: string;
  tenantId: string;
  action: ClerkStepUpAction;
  level: ClerkReverificationLevel;
  now?: Date;
}): string {
  const now = input.now?.getTime() ?? Date.now();
  return cookieHeader(
    CLERK_STEP_UP_CHALLENGE_COOKIE,
    serialize({
      providerSessionId: input.providerSessionId,
      internalUserId: input.internalUserId,
      tenantId: input.tenantId,
      action: input.action,
      level: input.level,
      nonce: randomUUID(),
      issuedAt: now,
      expiresAt: now + CHALLENGE_TTL_MS,
    }),
    Math.floor(CHALLENGE_TTL_MS / 1000),
  );
}

export function readClerkStepUpChallenge(
  request: Request,
  input: {
    providerSessionId: string;
    internalUserId: string;
    tenantId: string;
    action: ClerkStepUpAction;
    level: ClerkReverificationLevel;
  },
  now?: Date,
): boolean {
  const token = parse(readCookie(request, CLERK_STEP_UP_CHALLENGE_COOKIE), now?.getTime());
  return token ? matchesContext(token, input) : false;
}

export function issueClerkStepUpAssertion(input: {
  providerSessionId: string;
  internalUserId: string;
  tenantId: string;
  action: ClerkStepUpAction;
  level: ClerkReverificationLevel;
  now?: Date;
}): string {
  const now = input.now?.getTime() ?? Date.now();
  return cookieHeader(
    CLERK_STEP_UP_COOKIE,
    serialize({
      providerSessionId: input.providerSessionId,
      internalUserId: input.internalUserId,
      tenantId: input.tenantId,
      action: input.action,
      level: input.level,
      nonce: randomUUID(),
      issuedAt: now,
      expiresAt: now + TOKEN_TTL_MS,
    }),
    Math.floor(TOKEN_TTL_MS / 1000),
  );
}

export function readClerkStepUpAssertion(
  request: Request,
  now?: Date,
): {
  providerSessionId: string;
  internalUserId: string;
  tenantId: string;
  action: ClerkStepUpAction;
  level: ClerkReverificationLevel;
  issuedAt: Date;
  expiresAt: Date;
} | null {
  const token = parse(readCookie(request, CLERK_STEP_UP_COOKIE), now?.getTime());
  if (!token) return null;
  return {
    ...token,
    issuedAt: new Date(token.issuedAt),
    expiresAt: new Date(token.expiresAt),
  };
}

export function clerkStepUpCookieClearHeaders(): string[] {
  return [`${CLERK_STEP_UP_CHALLENGE_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`];
}
