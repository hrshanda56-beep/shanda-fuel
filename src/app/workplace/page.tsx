import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { requestFromHeaders } from '@/design-system/navigation-server';
import { readPersistedContext, resolveCurrentContext } from '@/modules/context/server';
import { validateRequestedContext } from '@/modules/context/server';
import { AppError } from '@/platform/errors';
import { getAuthProviderName } from '@/platform/auth/provider';

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
    let rememberedIsValid = false;
    if (remembered) {
      try {
        await validateRequestedContext(request, remembered, { pathname: '/' });
        rememberedIsValid = true;
      } catch {
        rememberedIsValid = false;
      }
    }
    plan = planWorkplaceEntry(resolution.available, rememberedIsValid);
  } catch (error) {
    if (error instanceof AppError && error.code === 'UNAUTHENTICATED') redirect('/login');
    throw error;
  }

  if (plan.kind === 'continue') redirect('/');
  const provider = getAuthProviderName();

  return (
    <EntryShell>
      {plan.kind === 'none' ? (
        <NoWorkplace provider={provider} />
      ) : (
        <WorkplacePicker options={plan.options} />
      )}
    </EntryShell>
  );
}
