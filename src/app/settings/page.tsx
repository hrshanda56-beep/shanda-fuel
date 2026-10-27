import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { AccessDeniedState } from '@/design-system/primitives';
import { PageContainer } from '@/design-system/layout';
import { AuthorizedAppShell as AppShell } from '@/design-system/authorized-app-shell';
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
  const request = buildSettingsRequest(await headers(), params);
  let view: SettingsView | undefined;
  let failure: unknown;

  try {
    view = await resolveSettings(request);
  } catch (error) {
    failure = error;
  }

  if (failure instanceof AppError && failure.code === 'UNAUTHENTICATED') {
    redirect('/login');
  }
  if (isAccessRefusal(failure)) {
    return (
      <AppShell pageSubtitle="Review the organisation, legal entities, stations, and account available to you.">
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
      />
    </AppShell>
  );
}
