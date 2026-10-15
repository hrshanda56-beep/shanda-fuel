import { Suspense } from 'react';
import { resolvePageContext } from '@/app/_context/page-context';
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
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await resolvePageContext('/reports', await searchParams);
  const tenantId = context?.tenantId;
  return (
    <AppShell pageSubtitle="Operational financial position">
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
