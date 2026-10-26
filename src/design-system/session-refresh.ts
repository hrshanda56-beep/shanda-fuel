/**
 * Keeps a person signed in across a long idle spell. Clerk's short session token is refreshed in
 * the background, but a tab left open for a while can send a command before that has happened, and
 * the server then answers "Authentication is required". Before a command is sent the token is made
 * fresh, and if the server still says 401 the token is forced fresh and the command is sent once
 * more. Nothing is retried unless the request body can safely be sent again.
 */
export type ClerkLike =
  | {
      session?: {
        getToken: (options?: { skipCache?: boolean }) => Promise<string | null>;
      } | null;
    }
  | null
  | undefined;

async function refresh(clerk: ClerkLike, force: boolean): Promise<void> {
  try {
    await clerk?.session?.getToken(force ? { skipCache: true } : undefined);
  } catch {
    // Offline or already signed out: the request below reports it in its own words.
  }
}

/** A body that can be read again for the retry (a stream cannot). */
function canResend(input: RequestInfo | URL, init?: RequestInit): boolean {
  if (typeof Request !== 'undefined' && input instanceof Request) return false;
  const body = init?.body;
  return (
    body === undefined || body === null || typeof body === 'string' || body instanceof FormData
  );
}

export async function fetchWithFreshSession(
  send: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  clerk: ClerkLike,
): Promise<Response> {
  await refresh(clerk, false);
  const response = await send(input, init);
  if (response.status !== 401 || !canResend(input, init)) return response;
  await refresh(clerk, true);
  return send(input, init);
}
