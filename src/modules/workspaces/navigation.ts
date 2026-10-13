export function safeNextPath(next: string | null, origin: string): string {
  if (!next) return '/';

  try {
    const target = new URL(next, origin);
    if (target.origin !== new URL(origin).origin) return '/';
    if (decodeURIComponent(target.pathname).includes('\\')) return '/';
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return '/';
  }
}

export function buildLoginRedirectPath(requestUrl: string): string {
  const target = new URL(requestUrl);
  const next = `${target.pathname}${target.search}`;
  return `/login?next=${encodeURIComponent(next)}`;
}

export function stationReconciliationsPath(stationId: string, tenantId?: string): string {
  const path = `/stations/${encodeURIComponent(stationId)}/reconciliations`;
  return tenantId ? `${path}?tenantId=${encodeURIComponent(tenantId)}` : path;
}
