import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { AuthorizedAppShell as AppShell } from '@/design-system/authorized-app-shell';
import { ContextRequiredState } from '@/design-system/primitives';
import { findReport } from '@/modules/reporting/catalog';
import { ManagementReportDashboard } from '@/modules/reporting/ui/management-report-dashboard';

export default async function ReportDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tenantId?: string }>;
}) {
  const { slug } = await params;
  const report = findReport(slug);
  if (!report) notFound();
  const { tenantId } = await searchParams;

  return (
    <AppShell pageSubtitle={report.title}>
      <p>
        <Link href={tenantId ? `/reports?tenantId=${encodeURIComponent(tenantId)}` : '/reports'}>
          ← All reports
        </Link>
      </p>
      <p className="lede">{report.description}</p>
      {tenantId ? (
        <Suspense>
          <ManagementReportDashboard tenantId={tenantId} view={report.slug} />
        </Suspense>
      ) : (
        <ContextRequiredState
          title="Choose an organisation to view this report"
          message="Use Change above to choose an authorised organisation before loading reporting data."
        />
      )}
    </AppShell>
  );
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const report = findReport((await params).slug);
  return { title: report?.title ?? 'Reports' };
}
