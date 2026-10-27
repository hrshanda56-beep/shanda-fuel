import type { AppErrorCode } from './index';

/**
 * Converts the structured API error into the one plain-language message shown by a client.
 * Server messages remain visible when they contain the actionable validation detail; connection
 * wording is reserved for an actual failed request rather than an HTTP error response.
 */
export function clientErrorMessage(input: {
  status?: number;
  code?: string | AppErrorCode;
  message?: string | null;
  fallback: string;
  network?: boolean;
}): string {
  const message = input.message?.trim() ?? '';
  if (input.network) return 'We could not reach the server. Check your connection and try again.';
  if (input.code === 'STEP_UP_REQUIRED') {
    return 'Please confirm it’s you before continuing. Nothing was changed.';
  }
  if (
    input.status === 409 &&
    /deposit reference|bank deposit.*reference|reference.*deposit|already used/i.test(message)
  ) {
    return 'This deposit reference is already used.';
  }
  if (input.status === 409 && /payment.*reference|reference.*payment/i.test(message)) {
    return 'A payment with this reference already exists for this supplier.';
  }
  if (message) return message;
  if (input.status === 401) return 'Your session has expired. Sign in again to continue.';
  if (input.status === 403) return 'You do not have permission to do this action.';
  if (input.status && input.status >= 500) {
    return 'Something went wrong on our side. Nothing was changed. Try again.';
  }
  return input.fallback;
}
