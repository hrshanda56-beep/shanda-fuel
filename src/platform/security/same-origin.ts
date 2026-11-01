const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Defence in depth against cross-site request forgery. The session cookie is SameSite=Lax, which
 * already stops cross-site form posts; this makes the server refuse a browser write that says it
 * came from another site. Requests with no Origin header (scripts, server-to-server calls) are not
 * browser cross-site requests and pass.
 */
export function isCrossSiteWrite(request: Request): boolean {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return false;
  if (request.headers.get('sec-fetch-site') === 'cross-site') return true;
  const origin = request.headers.get('origin');
  if (!origin) return false;
  const allowed = new Set<string>();
  try {
    allowed.add(new URL(request.url).origin);
  } catch {
    // An unparseable request URL cannot match anything below.
  }
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  if (forwardedHost) allowed.add(`https://${forwardedHost}`);
  const appUrl = process.env.APP_URL;
  if (appUrl) {
    try {
      allowed.add(new URL(appUrl).origin);
    } catch {
      // A malformed APP_URL is reported by the environment check, not here.
    }
  }
  return !allowed.has(origin);
}

export function crossSiteRefusal(): Response {
  return new Response(JSON.stringify({ error: 'FORBIDDEN' }), {
    status: 403,
    headers: { 'cache-control': 'no-store', 'content-type': 'application/json' },
  });
}
