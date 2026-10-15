import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { AuthorizedAppShell as AppShell } from '@/design-system/authorized-app-shell';
import {
  allowsE2ENavigationFixture,
  E2E_NAVIGATION_FIXTURE_HEADER,
} from '@/design-system/navigation-projection';
import { AccessDeniedState } from '@/design-system/primitives';
import { resolveCurrentContext } from '@/modules/context/server';
import { MyShiftWorkspace } from '@/modules/forecourt/ui/my-shift-workspace';
import { AppError } from '@/platform/errors';

export const metadata = { title: 'My shift' };
export const dynamic = 'force-dynamic';

const MY_SHIFT_ORIGIN = 'http://shanda-fuel.local';

/**
 * The attendant's home. Station comes from the already-authorised context
 * (one station auto-selects; several use the shell's station selector). The
 * data route re-checks tenant, station and permissions on every request.
 */
export default async function MyShiftPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const url = new URL('/my-shift', MY_SHIFT_ORIGIN);
  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value === 'string') url.searchParams.set(key, value);
  }
  const requestHeaders = await headers();
  const request = new Request(url, { headers: requestHeaders });

  // The explicit non-production e2e fixture renders the screen against mocked
  // data routes; it never grants anything and is refused outside APP_ENV=test.
  if (
    allowsE2ENavigationFixture(
      process.env.APP_ENV,
      requestHeaders.get(E2E_NAVIGATION_FIXTURE_HEADER),
      process.env.NODE_ENV,
    )
  ) {
    return (
      <AppShell attendantHome>
        <MyShiftWorkspace tenantId="e2e-tenant" stationId="e2e-station" />
      </AppShell>
    );
  }

  let tenantId: string | undefined;
  let stationId: string | undefined;
  let failure: unknown;
  try {
    const resolution = await resolveCurrentContext(request);
    tenantId = resolution.current?.organisationId;
    stationId = resolution.current?.stationId;
  } catch (error) {
    failure = error;
  }
  if (failure instanceof AppError && failure.code === 'UNAUTHENTICATED') redirect('/login');

  return (
    <AppShell attendantHome>
      {failure instanceof AppError && failure.code === 'FORBIDDEN' ? (
        <AccessDeniedState />
      ) : failure ? (
        <AccessDeniedState message="Your station could not be loaded. Try again, or tell your supervisor." />
      ) : tenantId && stationId ? (
        <MyShiftWorkspace tenantId={tenantId} stationId={stationId} />
      ) : (
        <AccessDeniedState message="No station is available to you yet. Tell your supervisor." />
      )}
    </AppShell>
  );
}
