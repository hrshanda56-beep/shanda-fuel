import { Suspense } from 'react';
import { getMyShiftFromRequest } from '@/modules/forecourt/my-shift';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { AuthorizedAppShell as AppShell } from '@/design-system/authorized-app-shell';
import {
  allowsE2ENavigationFixture,
  E2E_NAVIGATION_FIXTURE_HEADER,
} from '@/design-system/navigation-projection';
import { AccessDeniedState, ErrorState } from '@/design-system/primitives';
import { resolveCurrentContext } from '@/modules/context/server';
import { MyShiftWorkspace } from '@/modules/forecourt/ui/my-shift-workspace';
import { AppError, isAccessRefusal } from '@/platform/errors';

export const metadata = { title: 'My Shift' };
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
      {isAccessRefusal(failure) ? (
        <AccessDeniedState />
      ) : failure ? (
        <AccessDeniedState message="Your station could not be loaded. Try again, or tell your supervisor." />
      ) : tenantId && stationId ? (
        <Suspense
          key={`${tenantId}|${stationId}`}
          fallback={<p role="status">Loading your shift…</p>}
        >
          <ShiftContent request={request} tenantId={tenantId} stationId={stationId} />
        </Suspense>
      ) : (
        <AccessDeniedState message="No station is available to you yet. Tell your supervisor." />
      )}
    </AppShell>
  );
}

async function ShiftContent({
  request,
  tenantId,
  stationId,
}: {
  request: Request;
  tenantId: string;
  stationId: string;
}) {
  let initialData;
  try {
    initialData = await getMyShiftFromRequest(request, { tenantId, stationId });
  } catch (error) {
    if (isAccessRefusal(error) || (error instanceof AppError && error.code === 'UNAUTHENTICATED'))
      return <AccessDeniedState />;
    return (
      <ErrorState title="Your shift could not be loaded" message="Reload the page to try again." />
    );
  }
  return (
    <MyShiftWorkspace
      key={`${tenantId}|${stationId}`}
      tenantId={tenantId}
      stationId={stationId}
      initialData={initialData}
    />
  );
}
