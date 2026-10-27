import type { Metadata } from 'next';

import { ManualActivationForm } from '@/design-system/entry/manual-activation';
import { EntryShell } from '@/design-system/entry/entry-shell';

export const metadata: Metadata = {
  title: 'Join Shanda Fuel',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export const dynamic = 'force-dynamic';

export default function JoinPage() {
  return (
    <EntryShell wide>
      <ManualActivationForm />
    </EntryShell>
  );
}
