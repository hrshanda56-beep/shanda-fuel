import { cookies } from 'next/headers';

import { findScenario, SCENARIO_COOKIE } from '../../my-shift-scenarios';

/** Preview-only stand-in for /api/forecourt/my-shift; never exists outside development. */
export async function GET() {
  if (process.env.NODE_ENV !== 'development') return new Response(null, { status: 404 });
  const jar = await cookies();
  const result = findScenario(jar.get(SCENARIO_COOKIE)?.value).build(Date.now());
  if (result.status === 'hang') {
    await new Promise((resolve) => setTimeout(resolve, 60_000));
    return new Response(null, { status: 504 });
  }
  if (result.status !== 200) return Response.json({ error: 'PREVIEW' }, { status: result.status });
  return Response.json(result.body);
}
