import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { requestFromHeaders } from '@/design-system/navigation-server';
import { readPersistedContext, resolveCurrentContext } from '@/modules/context/server';
import { validateRequestedContext } from '@/modules/context/server';
import { AppError } from '@/platform/errors';

import { planWorkplaceEntry } from '@/design-system/entry/entry-logic';
import { EntryShell } from '@/design-system/entry/entry-shell';
import { NoWorkplace, WorkplacePicker } from '@/design-system/entry/workplace-views';

export const metadata: Metadata = { title: 'Choose a station' };
export const dynamic = 'force-dynamic';

/**
 * Post-sign-in routing. The station list is the already-authorised context
 * tree; nothing is hard-coded and nothing from the browser is trusted.
 */
export default async function WorkplacePage() {
  const request = requestFromHeaders(await headers());
  if (!request) redirect('/login');

  let plan;
  try {
    const resolution = await resolveCurrentContext(request);
    const remembered = readPersistedContext(request).selection;
    let rememberedOrganisationId: string | undefined;
    if (remembered) {
      try {
        const validatedRemembered = await validateRequestedContext(request, remembered, {
          pathname: '/',
        });
        rememberedOrganisationId = validatedRemembered.organisationId;
      } catch {
        rememberedOrganisationId = undefined;
      }
    }
    plan = planWorkplaceEntry(resolution.available, rememberedOrganisationId);
  } catch (error) {
    if (error instanceof AppError && error.code === 'UNAUTHENTICATED') redirect('/login');
    throw error;
  }

  if (plan.kind === 'continue') redirect('/');

  return (
    <EntryShell>
      {plan.kind === 'none' ? (
        <NoWorkplace />
      ) : (
        <WorkplacePicker
          options={plan.options}
          allStationsOptions={plan.allStationsOptions}
          defaultAllStationsOrganisationId={plan.defaultAllStationsOrganisationId}
        />
      )}
    </EntryShell>
  );
}
