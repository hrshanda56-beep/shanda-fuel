import { Suspense } from 'react';
import { AuthorizedAppShell as AppShell } from '@/design-system/authorized-app-shell';
import { ContextRequiredState } from '@/design-system/primitives';
import { ReportsRail } from '@/modules/reporting/ui/reports-rail';
import { ReportList } from '@/modules/reporting/ui/report-list';

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
    <AppShell pageSubtitle="Operational Financial Position">
      {tenantId ? (
        <Suspense>
          <div className="reports-stack wide-workspace">
            <div className="reports-layout">
              <ReportList tenantId={tenantId} />
              <ReportsRail tenantId={tenantId} />
            </div>
          </div>
        </Suspense>
      ) : (
        <ContextRequiredState
          title="Choose an organisation to view reports"
          message="Use the work context selector above to choose an organisation."
        />
      )}
    </AppShell>
  );
}
