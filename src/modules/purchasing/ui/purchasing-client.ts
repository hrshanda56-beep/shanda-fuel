/** Browser helpers for the Purchasing screens: plain-language errors and command posting. */

export class PurchasingRequestError extends Error {
  readonly status: number;
  readonly raw: string;
  constructor(message: string, status: number, raw: string) {
    super(message);
    this.status = status;
    this.raw = raw;
  }
}

const FRIENDLY: ReadonlyArray<readonly [RegExp, string]> = [
  [
    /changed since it was loaded/i,
    'Someone else changed this order while you were looking. Reload the page and try again.',
  ],
  [
    /cannot be approved by the person who submitted/i,
    'You sent this order for approval, so another approver has to approve it.',
  ],
  [/cannot be amended/i, 'This order can no longer be edited.'],
  [
    /already (?:been )?received|close it instead of cancelling/i,
    'Fuel has already arrived on this order, so it cannot be cancelled. Close it instead.',
  ],
  [
    /different supplier|supplier differs/i,
    'That delivery is from a different supplier than this order.',
  ],
  [/product differs/i, 'That delivery is a different fuel than this order line.'],
  [/already linked/i, 'That delivery is already linked to an order.'],
  [/only be linked to an approved/i, 'Deliveries can only be linked once the order is approved.'],
  [/The actor is not authorized/i, 'You do not have permission to do this.'],
  [
    /The purchasing command is invalid/i,
    'Some of the details are not valid. Check them and try again.',
  ],
  [
    /Someone else changed the purchasing policy/i,
    'Someone else changed these settings. Reload the page and try again.',
  ],
];

export function friendlyMessage(message: string, fallback: string): string {
  const text = message.trim();
  if (!text) return fallback;
  for (const [pattern, replacement] of FRIENDLY) if (pattern.test(text)) return replacement;
  return text;
}

function messageOf(result: unknown): string {
  if (typeof result === 'object' && result !== null && 'message' in result) {
    const message = (result as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return '';
}

export async function getJson<T>(url: string, fallback: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { cache: 'no-store', credentials: 'same-origin', signal });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new PurchasingRequestError(
      'The connection was lost. Check your internet and try again.',
      0,
      '',
    );
  }
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const raw = messageOf(result);
    throw new PurchasingRequestError(
      response.status === 403
        ? 'You do not have access to see this.'
        : friendlyMessage(raw, fallback),
      response.status,
      raw,
    );
  }
  return result as T;
}

export async function postJson<T>(
  url: string,
  body: Record<string, unknown>,
  idempotencyKey: string,
  fallback: string,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
      body: JSON.stringify(body),
    });
  } catch {
    throw new PurchasingRequestError(
      'The connection was lost, so we cannot tell if this was saved. Reload the page to check before trying again.',
      0,
      '',
    );
  }
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const raw = messageOf(result);
    throw new PurchasingRequestError(friendlyMessage(raw, fallback), response.status, raw);
  }
  return result as T;
}

/** True when a refused command only needs the person to confirm their identity. */
export function needsIdentityCheck(error: unknown): boolean {
  return (
    error instanceof PurchasingRequestError &&
    error.status === 403 &&
    /not authorized|strong authentication|step-up/i.test(error.raw)
  );
}

export function newKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

/** Link to one order. The station travels in the link because an order belongs to one station. */
export function orderHref(
  purchaseOrderId: string,
  scope: { tenantId: string; legalEntityId: string | null; stationId: string },
): string {
  const params = new URLSearchParams({ tenantId: scope.tenantId, stationId: scope.stationId });
  if (scope.legalEntityId) params.set('legalEntityId', scope.legalEntityId);
  return `/purchasing/${encodeURIComponent(purchaseOrderId)}?${params.toString()}`;
}

export function ordersHref(scope: {
  tenantId: string;
  legalEntityId: string | null;
  stationId: string | null;
}): string {
  const params = new URLSearchParams({ tenantId: scope.tenantId });
  if (scope.legalEntityId) params.set('legalEntityId', scope.legalEntityId);
  if (scope.stationId) params.set('stationId', scope.stationId);
  return `/purchasing?${params.toString()}`;
}
