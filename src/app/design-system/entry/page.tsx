import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { EntryShell } from '@/design-system/entry/entry-shell';
import { InviteUnavailable } from '@/design-system/entry/invite-views';
import { LoginForm } from '@/design-system/entry/login-form';
import { NoWorkplace, WorkplacePicker } from '@/design-system/entry/workplace-views';
import { isDesignSystemReferenceAvailable } from '@/design-system/reference/availability';

import { PreviewJoin } from './preview-join';

export const metadata: Metadata = {
  title: 'Entry states',
  robots: { index: false, follow: false },
};

const LONG = 'Tendai Chikwanha Fuel & Convenience Holdings (Private) Limited';

const stations = (long: boolean) =>
  ['Bindura', 'Maruta', 'Arcturus', long ? `${LONG} — Harare Road Forecourt` : 'Gazebo'].map(
    (stationName, index) => ({
      organisationId: 'o',
      legalEntityId: 'l',
      stationId: `s${index}`,
      stationName,
    }),
  );

/** Internal visual reference for the entry screens; synthetic data, 404 in production. */
export default async function EntryStatesPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; long?: string }>;
}) {
  if (!isDesignSystemReferenceAvailable()) notFound();
  const { state = 'login', long } = await searchParams;
  const isLong = long === '1';
  const email = isLong
    ? 'a.very.long.employee.address.for.testing@subdomain.very-long-company-name.example'
    : 'employee@example.com';

  return (
    <EntryShell>
      {state === 'invite-new' ? (
        <PreviewJoin organisationName={isLong ? LONG : 'T.E.I Oils'} email={email} />
      ) : state === 'invite-existing' ? (
        <LoginForm invited />
      ) : state === 'invite-unavailable' ? (
        <InviteUnavailable />
      ) : state === 'picker' ? (
        <WorkplacePicker options={stations(isLong)} />
      ) : state === 'no-workplace' ? (
        <NoWorkplace />
      ) : (
        <LoginForm />
      )}
    </EntryShell>
  );
}
