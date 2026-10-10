import { SCENARIO_COOKIE, SCENARIOS } from '../../my-shift-scenarios';

/** Pick a My Shift preview scenario (sets a cookie) and go back to the screen. */
export async function GET(request: Request, { params }: { params: Promise<{ name: string }> }) {
  if (process.env.NODE_ENV !== 'development') return new Response(null, { status: 404 });
  const { name } = await params;
  const id = SCENARIOS.some((s) => s.id === name) ? name : 'normal';
  const to = new URL('/my-shift', request.url);
  for (const key of ['tenantId', 'legalEntityId', 'stationId']) {
    const value = new URL(request.url).searchParams.get(key);
    if (value) to.searchParams.set(key, value);
  }
  return new Response(null, {
    status: 302,
    headers: { location: to.pathname + to.search, 'set-cookie': `${SCENARIO_COOKIE}=${id}; Path=/; Max-Age=86400` },
  });
}
