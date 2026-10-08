import { Suspense } from 'react';
import { AuthorizedAppShell as AppShell } from '@/design-system/authorized-app-shell';
import { ContextRequiredState } from '@/design-system/primitives';
import { ManagementReportDashboard } from '@/modules/reporting/ui/management-report-dashboard';

export const metadata = {
  title: 'Reports',
};

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ tenantId?: string }>;
}) {
  const { tenantId } = await searchParams;
  return (
    <AppShell pageSubtitle="Operational financial position">
      <p className="lede">
        A factual view across approved sales, custody, settlements, commercial exposure, and stock.
      </p>
      {tenantId ? (
        <Suspense>
          <ManagementReportDashboard tenantId={tenantId} />
        </Suspense>
      ) : (
        <ContextRequiredState
          title="Choose an organisation to view reports"
          message="Use Change above to choose an authorised organisation before loading reporting data."
        />
      )}
    </AppShell>
  );
}
