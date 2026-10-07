import { AuthorizedAppShell as AppShell } from '@/design-system/authorized-app-shell';

import { ProductionSafeOverview } from './_overview/overview-dashboard';

export const metadata = {
  title: { absolute: 'Dashboard · Shanda Fuel' },
};

/** Owner/Finance overview. Live figures stay hidden until reporting data exists. */
export default function OverviewPage() {
  return (
    <AppShell
      searchPlacement="header"
      pageSubtitle="Live figures are not available for this work context yet."
    >
      <ProductionSafeOverview />
    </AppShell>
  );
}
