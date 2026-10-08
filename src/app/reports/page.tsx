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
    <AppShell>
      {tenantId ? (
        <ManagementReportDashboard tenantId={tenantId} />
      ) : (
        <ContextRequiredState
          title="Choose an organisation"
          message="Pick an organisation at the top of the page to see its reports."
        />
      )}
    </AppShell>
  );
}
