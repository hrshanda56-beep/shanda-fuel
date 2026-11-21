import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { AccessDeniedState } from '@/design-system/primitives';
import { PageContainer } from '@/design-system/layout';
import { AuthorizedAppShell as AppShell } from '@/design-system/authorized-app-shell';
import { getServerShellAccess } from '@/design-system/navigation-server';
import { contextFromShellAccess } from '@/modules/context/page-context';
import { AppError, isAccessRefusal } from '@/platform/errors';
import { resolveSettings } from '@/modules/settings';
import type { SettingsView } from '@/modules/settings';
import { SettingsWorkspace } from '@/modules/settings/ui/settings-workspace';

export const metadata = {
  title: 'Settings',
};

const SETTINGS_ORIGIN = 'http://shanda-fuel.local';

function buildSettingsRequest(
  requestHeaders: Headers,
  params: Record<string, string | string[] | undefined>,
): Request {
  const url = new URL('/settings', SETTINGS_ORIGIN);
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, item);
    } else if (value !== undefined) {
      url.searchParams.set(key, value);
    }
  }
  return new Request(url, { headers: requestHeaders });
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const requestHeaders = await headers();
  const request = buildSettingsRequest(requestHeaders, params);
  let view: SettingsView | undefined;
  let failure: unknown;
  // The shell looks the person and their stations up for every page; the page reuses that result
  // for its own station choice instead of asking the database a second time, and hands the same
  // result back to the shell so it does not ask either.
  let shellAccess: Awaited<ReturnType<typeof getServerShellAccess>> | undefined;

  try {
    shellAccess = await getServerShellAccess(requestHeaders);
    const resolution = contextFromShellAccess(
      shellAccess,
      request,
      '/settings',
      new URL(request.url).searchParams,
    );
    view = await resolveSettings(
      request,
      resolution ? { resolveContext: async () => resolution } : {},
    );
  } catch (error) {
    failure = error;
  }

  if (failure instanceof AppError && failure.code === 'UNAUTHENTICATED') {
    redirect('/login');
  }
  if (isAccessRefusal(failure)) {
    return (
      <AppShell
        {...(shellAccess ? { shellAccess } : {})}
        pageSubtitle="Review the organisation, legal entities, stations, and account available to you."
      >
        <PageContainer width="narrow">
          <AccessDeniedState />
        </PageContainer>
      </AppShell>
    );
  }
  if (failure) throw failure;
  if (!view) throw new Error('Settings data was not loaded');

  return (
    <AppShell
      {...(shellAccess ? { shellAccess } : {})}
      userName={view.account.name}
      pageSubtitle={
        view.stationView
          ? "Your station's staff, its activity and your account."
          : 'Review the organisation, legal entities, stations, and account available to you.'
      }
    >
      <SettingsWorkspace
        view={view}
        initialTab={typeof params.tab === 'string' ? params.tab : undefined}
        initialSetupStation={typeof params.setup === 'string' ? params.setup : undefined}
        initialFocus={params.focus === 'meter-start' ? 'meter-start' : undefined}
      />
    </AppShell>
  );
}
