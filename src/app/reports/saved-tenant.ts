import 'server-only';

import { headers } from 'next/headers';

import { requestFromHeaders } from '@/design-system/navigation-server';
import { resolveCurrentContext } from '@/modules/context/server';

/**
 * The organisation the person already chose, for a report address that arrives without one (a
 * bookmark, a typed link). Without this the page asks them to choose again although the work
 * context selector already shows one. Never grants anything: the data routes still authorise.
 */
export async function savedTenantId(pathname: string): Promise<string | undefined> {
  const base = requestFromHeaders(await headers());
  if (!base) return undefined;
  try {
    const request = new Request(new URL(pathname, base.url), { headers: base.headers });
    return (await resolveCurrentContext(request)).current?.organisationId;
  } catch {
    return undefined;
  }
}
