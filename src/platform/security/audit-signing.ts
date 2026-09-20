import { createHmac, timingSafeEqual } from 'node:crypto';

export type SignedSecurityEvent = {
  eventId: string;
  tenantId?: string;
  actorId?: string;
  eventCode: string;
  requestId: string;
  occurredAt: string;
  details: Record<string, unknown>;
  keyId: string;
  algorithm: 'hmac-sha256';
  signature: string;
};

type UnsignedSecurityEvent = Omit<SignedSecurityEvent, 'keyId' | 'algorithm' | 'signature'>;

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableValue(child)]),
    );
  }
  return value;
}

function canonicalize(value: UnsignedSecurityEvent): string {
  return JSON.stringify(
    stableValue({
      actorId: value.actorId ?? null,
      details: value.details,
      eventCode: value.eventCode,
      eventId: value.eventId,
      occurredAt: value.occurredAt,
      requestId: value.requestId,
      tenantId: value.tenantId ?? null,
    }),
  );
}

function signatureFor(value: UnsignedSecurityEvent, secret: string): string {
  return createHmac('sha256', secret).update(canonicalize(value), 'utf8').digest('base64url');
}

export function signSecurityEvent(
  value: UnsignedSecurityEvent,
  key: { keyId: string; secret: string },
): SignedSecurityEvent {
  return {
    ...value,
    keyId: key.keyId,
    algorithm: 'hmac-sha256',
    signature: signatureFor(value, key.secret),
  };
}

export function verifySecurityEvent(event: SignedSecurityEvent, secret: string): boolean {
  const expected = Buffer.from(signatureFor(event, secret));
  const actual = Buffer.from(event.signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
